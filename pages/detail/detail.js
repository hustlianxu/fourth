// pages/detail/detail.js
const storage = require('../../utils/storage.js');
const templates = require('../../utils/templates.js');
const watermark = require('../../utils/watermark.js');
const cloud = require('../../utils/cloud.js');

Page({
  data: {
    record: null,
    fields: [],
    timeText: '',
    editing: false,
    editValues: {},
    editScale: 1,
    editOpacity: 0.85,
    editWidthRatio: 0.42,
    scaleLabel: '100%',
    opacityLabel: '85%',
    widthLabel: '42%',
    // 水印拖拽
    editWmX: 0,
    editWmY: 0,
    imgDisplayW: 0,
    imgDisplayH: 0,
    displayPhoto: '',
    showWmOverlay: false,
    displayFields: [],
    ocrResult: null,
    verifyIssues: [],
    // 浮层菜单
    showActionMenu: false,
    autoSaveEditAlbum: false,
    _syncStatus: 'off',
    authorizedCount: 0
  },

  recordId: '',
  screenWidth: 0,
  isDragging: false,
  isPinching: false,
  lastPinchDist: 0,
  dragStartX: 0,
  dragStartY: 0,
  wmStartX: 0,
  wmStartY: 0,
  wmWidth: 0,
  wmHeight: 60,
  wmMeasuredHeight: 0, // 水印层实际渲染高度（未含 scale）
  _wmPosFromString: false, // 当前水印位置是否来自字符串估算（需测量后修正）

  onLoad(options) {
    this.recordId = options.id;

    this.screenWidth = wx.getWindowInfo().windowWidth;

    // 检测是否为分享授权打开（好友从分享卡片点进来）
    if (options._authPerm) {
      this.setData({ autoSaveEditAlbum: storage.getAutoSaveEditAlbum() });
      // 先处理授权，再加载记录
      this._handleAuthShare(options._authPerm);
      return;
    }

    this.setData({ autoSaveEditAlbum: storage.getAutoSaveEditAlbum() });
  },

  onReady() {},

  // 页面卸载：清理悬挂的测量定时器，防止对已销毁页面 setData
  onUnload() {
    if (this._measureTimer) {
      clearTimeout(this._measureTimer);
      this._measureTimer = null;
    }
  },

  // ===== 分享授权处理（好友打开分享卡片时自动授权） =====

  /**
   * 处理从分享卡片打开的授权请求
   */
  _handleAuthShare(permission) {
    var that = this;
    var recordId = this.recordId;

    wx.showModal({
      title: '照片授权',
      content: '好友与您分享了一张水印照片，是否接受授权？',
      success: function (modalRes) {
        if (!modalRes.confirm) {
          wx.navigateBack();
          return;
        }

        wx.showLoading({ title: '授权中...', mask: true });

        cloud.callAuthorizeByShare(recordId, permission).then(function (res) {
          wx.hideLoading();

          if (res && res.success && res.record) {
            var cloudData = res.record;
            // 授权成功，检查本地是否已有该记录（可能之前同步已下载）
            var existingRecord = storage.getById(cloudData.recordId);
            if (!existingRecord) {
              // 本地无记录 → 写入本地
              var localRecord = {
                id: cloudData.recordId,
                templateId: cloudData.templateId,
                templateName: cloudData.templateName,
                values: cloudData.values || {},
                imagePath: '',
                originalPath: '',
                width: cloudData.width,
                height: cloudData.height,
                folderId: null,
                customName: cloudData.customName || '',
                createdAt: cloudData.createdAt,
                _cloudOwner: cloudData.owner,
                _permission: permission,
                _syncStatus: 'synced'
              };
              storage.add(localRecord);

              // 下载水印图
              if (cloudData.imageFileID) {
                cloud.downloadFile(cloudData.imageFileID).then(function (localPath) {
                  if (localPath) {
                    storage.update(localRecord.id, { imagePath: localPath });
                    if (that && that.load) {
                      that.setData({
                        autoSaveEditAlbum: storage.getAutoSaveEditAlbum()
                      });
                      that.load();
                    }
                  }
                });
              }
            } else {
              // 本地已有 → 更新权限和同步状态
              storage.update(cloudData.recordId, {
                _permission: permission,
                _cloudOwner: cloudData.owner,
                _syncStatus: 'synced'
              });
            }

            wx.showToast({ title: '授权成功！', icon: 'success', duration: 2000 });
            // 授权成功后加载该记录
            setTimeout(function () {
              if (that && that.load) {
                that.setData({
                  autoSaveEditAlbum: storage.getAutoSaveEditAlbum()
                });
                that.load();
              }
            }, 800);
          } else {
            wx.showToast({ title: '授权失败: ' + ((res && res.error) || '未知错误'), icon: 'none' });
          }
        }).catch(function (err) {
          wx.hideLoading();
          wx.showToast({ title: '授权失败', icon: 'none' });
          console.error('[Detail] 分享授权失败:', err);
        });
      }
    });
  },

  // 浮层菜单
  onToggleActionMenu() {
    this.setData({ showActionMenu: !this.data.showActionMenu });
  },

  onDeleteFromMenu() {
    this.setData({ showActionMenu: false });
    this.onDelete();
  },


  onGoShare() {
    this.setData({ showActionMenu: false });
    wx.navigateTo({ url: '/pages/share/share?id=' + this.recordId });
  },

  onGoTimeline() {
    this.setData({ showActionMenu: false });
    wx.navigateTo({ url: '/pages/timeline/timeline?id=' + this.recordId });
  },

  onShow() {
    this.load();
  },

  load() {
    const record = storage.getById(this.recordId);
    if (!record) {
      wx.showToast({ title: '记录不存在', icon: 'none' });
      return;
    }
    const tpl = templates.getTemplateById(record.templateId);
    const fields = (tpl ? tpl.fields : []).map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      value: (record.values && record.values[f.key]) || ''
    }));
    const displayFields = fields.filter(f => f.value).map(f => ({
      key: f.key,
      label: f.label,
      value: f.value
    }));

    // 计算图片显示尺寸
    // 容器 .container 有 padding:24rpx，左右共 48rpx，需正确换算为 px
    // （screenWidth 是 px，不能直接减 48，否则在不同设备上会偏小导致 aspectFit 留黑）
    const imgW = record.width || 1080;
    const imgH = record.height || 1440;
    const rpxToPx = this.screenWidth / 750;
    const displayW = this.screenWidth - 48 * rpxToPx; // 与 .card / .img-area 实际撑满宽度一致
    const displayH = displayW * (imgH / imgW);

    const date = new Date(record.createdAt);
    this.setData({
      record,
      fields,
      displayFields,
      displayPhoto: record.imagePath,
      timeText: templates.formatDateTime(date),
      imgDisplayW: displayW,
      imgDisplayH: displayH,
      ocrResult: record.ocr || null,
      verifyIssues: record.verifyIssues || [],
      _syncStatus: record._syncStatus || 'off'
    });
    // 异步获取已授权人数
    var that = this;
    cloud.getAuthorizedList(this.recordId).then(function (list) {
      if (list) {
        that.setData({ authorizedCount: list.length });
      }
    });
  },

  // 计算水印在图片显示尺寸下的位置
  _calcWmDisplayPos(record) {
    const imgW = record.width || 1080;
    const imgH = record.height || 1440;

    // 已有精确坐标（编辑保存过的记录）→ 直接换算为显示坐标
    if (record.watermarkX != null && record.watermarkY != null) {
      this._wmPosFromString = false;
      return {
        x: record.watermarkX * (this.data.imgDisplayW / imgW),
        y: record.watermarkY * (this.data.imgDisplayH / imgH)
      };
    }

    // 无精确坐标（拍照入库的新记录）→ 根据位置字符串计算，镜像 watermark.js 的定位逻辑
    this._wmPosFromString = true;
    return this._calcPosFromString(record);
  },

  // 根据位置字符串计算水印显示坐标（镜像 watermark.js 的定位逻辑）
  // blockHKnown 为已测量的水印块高度（含 scale 后的视觉高度），缺省时用估算值
  _calcPosFromString(record, blockHKnown) {
    const imgW = record.width || 1080;
    const tpl = templates.getTemplateById(record.templateId);
    const position = (tpl && tpl.position) || record.watermarkPosition || 'bottom-left';
    const style = (tpl && tpl.style) || {};
    const scale = record.watermarkScale || 1;
    const widthRatio = record.watermarkWidthRatio || 0.42;

    // 镜像 watermark.js 的尺寸计算（display 坐标系，与原图等比例）
    const dW = this.data.imgDisplayW;
    const dH = this.data.imgDisplayH;
    const ratioD = dW / 750;
    const fontSizeD = Math.max(14, Math.round((style.fontSize || 22) * ratioD * scale));
    const lineHeightD = Math.round(fontSizeD * (style.lineHeight || 1.7));
    const paddingD = Math.round((style.padding || 14) * ratioD * scale);
    const blockWD = Math.round(dW * widthRatio * scale);

    // 水印块高度：优先用测量值，否则按字段数估算（宽模式每字段~1.5行，窄模式~2行）
    let blockHD;
    if (blockHKnown != null) {
      blockHD = blockHKnown;
    } else {
      const fieldCount = (this.data.displayFields || []).length;
      const estLines = Math.max(1, Math.round(fieldCount * (widthRatio >= 0.5 ? 1.5 : 2)));
      blockHD = paddingD * 2 + estLines * lineHeightD;
    }

    const marginD = Math.round(dW * 0.04);
    const cxD = (dW - blockWD) / 2;

    let x = marginD, y = marginD;
    // X：与 watermark.js 一致
    if (position.endsWith('left')) x = marginD;
    else if (position.endsWith('center')) x = cxD;
    else if (position.endsWith('right')) x = dW - blockWD - marginD;
    // Y：与 watermark.js 一致
    if (position.startsWith('top')) y = marginD;
    else if (position.startsWith('center')) y = (dH - blockHD) / 2;
    else y = dH - blockHD - marginD; // bottom

    return { x: Math.max(0, x), y: Math.max(0, y) };
  },

  onPreview() {
    if (!this.data.record) return;
    wx.previewImage({
      urls: [this.data.record.imagePath],
      current: this.data.record.imagePath
    });
  },

  onSaveAlbum() {
    if (!this.data.record) return;
    wx.saveImageToPhotosAlbum({
      filePath: this.data.record.imagePath,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: () => wx.showToast({ title: '保存失败', icon: 'none' })
    });
  },

  // === 触摸拖拽 + 双指缩放 ===
  onTouchStart(e) {
    if (!this.data.editing) return;
    // 点击浮层按钮时不启动水印拖拽
    if (e.target && e.target.id === 'actionFab') return;
    if (e.touches.length === 1) {
      this.isDragging = true;
      this.isPinching = false;
      this.dragStartX = e.touches[0].clientX;
      this.dragStartY = e.touches[0].clientY;
      this.wmStartX = this.data.editWmX;
      this.wmStartY = this.data.editWmY;
    } else if (e.touches.length === 2) {
      this.isDragging = false;
      this.isPinching = true;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      this.lastPinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    }
  },

  onTouchMove(e) {
    if (!this.data.editing) return;
    if (this.isDragging && e.touches.length === 1) {
      const dx = e.touches[0].clientX - this.dragStartX;
      const dy = e.touches[0].clientY - this.dragStartY;
      let newX = this.wmStartX + dx;
      let newY = this.wmStartY + dy;
      // 基于实际水印尺寸限制边界，确保水印不拖出图片范围
      const bounds = this._getDragBounds();
      newX = Math.max(bounds.minX, Math.min(newX, bounds.maxX));
      newY = Math.max(bounds.minY, Math.min(newY, bounds.maxY));
      this.setData({ editWmX: newX, editWmY: newY });
    } else if (this.isPinching && e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      if (this.lastPinchDist > 0) {
        const scale = dist / this.lastPinchDist;
        let newScale = this.data.editScale * scale;
        newScale = Math.max(0.5, Math.min(newScale, 1.5));
        this.setData({ editScale: newScale, scaleLabel: Math.round(newScale * 100) + '%' });
      }
      this.lastPinchDist = dist;
    }
  },

  // 计算水印拖拽边界：水印必须完全包含在图片实际显示区域内
  _getDragBounds() {
    const record = this.data.record;
    const imgW = record.width || 1080;
    const imgH = record.height || 1440;
    // 图片实际显示尺寸（aspectFit 等比缩放居中）
    const containerW = this.data.imgDisplayW;
    const containerH = this.data.imgDisplayH;
    const imgRatio = imgW / imgH;
    const containerRatio = containerW / containerH;
    let imgDisplayW, imgDisplayH, imgOffsetX, imgOffsetY;
    if (imgRatio > containerRatio) {
      // 图片更宽，以容器宽度为准，上下留黑
      imgDisplayW = containerW;
      imgDisplayH = containerW / imgRatio;
      imgOffsetX = 0;
      imgOffsetY = (containerH - imgDisplayH) / 2;
    } else {
      // 图片更高，以容器高度为准，左右留黑
      imgDisplayH = containerH;
      imgDisplayW = containerH * imgRatio;
      imgOffsetX = (containerW - imgDisplayW) / 2;
      imgOffsetY = 0;
    }
    // 水印层实际尺寸（widthRatio 相对容器宽度，再经 scale 缩放）
    const wmWidth = containerW * this.data.editWidthRatio * this.data.editScale;
    // 水印高度用测量的实际值（含 scale 后的视觉高度），无测量值时用估算
    const wmHeight = (this.wmMeasuredHeight || 60) * this.data.editScale;
    return {
      minX: imgOffsetX,
      maxX: imgOffsetX + imgDisplayW - wmWidth,
      minY: imgOffsetY,
      maxY: imgOffsetY + imgDisplayH - wmHeight
    };
  },

  // 测量水印层实际渲染高度（用于精确计算拖拽边界）
  _measureWmHeight() {
    if (!this.data.showWmOverlay) return;
    wx.createSelectorQuery()
      .in(this)
      .select('#wmLayer')
      .boundingClientRect((rect) => {
        if (rect && rect.height > 0) {
          this.wmMeasuredHeight = rect.height / this.data.editScale;
          // 若初始位置来自字符串估算，用实测高度修正位置，使预览与实际水印更精准对齐
          if (this._wmPosFromString) {
            const corrected = this._calcPosFromString(this.data.record, rect.height);
            this.setData({ editWmX: corrected.x, editWmY: corrected.y });
            this._wmPosFromString = false;
          }
        }
      })
      .exec();
  },

  onTouchEnd() {
    this.isDragging = false;
    this.isPinching = false;
    this.lastPinchDist = 0;
  },

  // === 编辑切换 ===
  async onEditToggle() {
    // 防重入：保存或测量进行中时忽略再次点击，避免 setTimeout/异步重渲染竞态
    if (this._toggling) return;
    if (this.data.editing) {
      this._toggling = true;
      wx.showLoading({ title: '保存中...', mask: true });

      try {
        // 将显示坐标转回原图坐标
        const record = this.data.record;
        const imgW = record.width || 1080;
        const imgH = record.height || 1440;
        const actualX = Math.round(this.data.editWmX * (imgW / this.data.imgDisplayW));
        const actualY = Math.round(this.data.editWmY * (imgH / this.data.imgDisplayH));

        // 更新 record 中的水印位置（供 render 使用）
        record.watermarkX = actualX;
        record.watermarkY = actualY;

        const newImagePath = await this._rerenderWatermark();

        const patch = {
          values: this.data.editValues,
          imagePath: newImagePath,
          watermarkScale: this.data.editScale,
          watermarkOpacity: this.data.editOpacity,
          watermarkWidthRatio: this.data.editWidthRatio,
          watermarkX: actualX,
          watermarkY: actualY
        };
        storage.update(this.recordId, patch);

        // 云同步：同步开启时上传到云端
        if (cloud.isSyncEnabled()) {
          var updatedRecord = storage.getById(this.recordId);
          if (updatedRecord) {
            var that = this;
            cloud.getOpenid().then(function (oid) {
              if (oid) {
                return cloud.syncRecord(updatedRecord, oid, true);
              }
            }).then(function (res) {
              if (res && res.success) {
                storage.update(that.recordId, { _syncStatus: 'synced' });
              }
            }).catch(function (err) {
              console.warn('[Detail] 云同步失败:', err);
            });
          }
        }

        wx.hideLoading();

        // 若开启"自动保存修改到相册"，则把修改后的水印图存入系统相册，防止小程序数据丢失
        if (this.data.autoSaveEditAlbum) {
          wx.saveImageToPhotosAlbum({
            filePath: newImagePath,
            success: () => wx.showToast({ title: '已更新并保存到相册', icon: 'success' }),
            fail: () => wx.showToast({ title: '已更新（相册保存失败）', icon: 'none' })
          });
        } else {
          wx.showToast({ title: '已更新', icon: 'success' });
        }

        this.load();
        // 退出编辑前清理悬挂的测量定时器
        if (this._measureTimer) {
          clearTimeout(this._measureTimer);
          this._measureTimer = null;
        }
        this.setData({ editing: false, editValues: {}, showWmOverlay: false, displayPhoto: newImagePath });
      } catch (e) {
        wx.hideLoading();
        console.error('[Detail] 重新渲染水印失败:', e);
        const errMsg = e.message || String(e);
        wx.showToast({ title: '更新失败: ' + errMsg.slice(0, 20), icon: 'none', duration: 3000 });
      } finally {
        this._toggling = false;
      }
    } else {
      const rec = this.data.record;
      const wmPos = this._calcWmDisplayPos(rec);
      this.wmWidth = this.data.imgDisplayW * (rec.watermarkWidthRatio || 0.42);

      // 切换到原始照片（无水印），避免看到两个水印
      const cleanPhoto = rec.originalPath || rec.imagePath;
      this.setData({
        editing: true,
        showWmOverlay: true,
        displayPhoto: cleanPhoto,
        editValues: Object.assign({}, rec.values),
        editScale: rec.watermarkScale || 1,
        editOpacity: rec.watermarkOpacity || 0.85,
        editWidthRatio: rec.watermarkWidthRatio || 0.42,
        editWmX: wmPos.x,
        editWmY: wmPos.y,
        scaleLabel: Math.round((rec.watermarkScale || 1) * 100) + '%',
        opacityLabel: Math.round((rec.watermarkOpacity || 0.85) * 100) + '%',
        widthLabel: Math.round((rec.watermarkWidthRatio || 0.42) * 100) + '%'
      });
      // 等待水印层渲染完成后测量实际高度
      setTimeout(() => this._measureWmHeight(), 50);
    }
  },

  // 检查文件是否存在（同步检测，不触发 10s 超时）
  _fileExists(path) {
    if (!path) return false;
    try {
      wx.getFileSystemManager().accessSync(path);
      return true;
    } catch (e) {
      return false;
    }
  },

  // 获取可用的源图路径，优先原图→水印图→云存储下载
  async _getSourceImagePath(record) {
    // 1. 原图存在且有效
    if (record.originalPath && this._fileExists(record.originalPath)) {
      return { path: record.originalPath, isOriginal: true };
    }
    // 2. 水印图存在且有效
    if (record.imagePath && this._fileExists(record.imagePath)) {
      return { path: record.imagePath, isOriginal: false };
    }
    // 3. 原图路径有值但文件被清 → 尝试从云存储下载
    if (cloud.isSyncEnabled()) {
      try {
        var cloudRecord = await cloud.fetchCloudRecord(record.id);
        if (cloudRecord && cloudRecord.imageFileID) {
          var localPath = await cloud.downloadFile(cloudRecord.imageFileID);
          if (localPath) {
            console.log('[Detail] 从云存储下载图片成功:', localPath);
            return { path: localPath, isOriginal: false, isCloud: true };
          }
        }
      } catch (e) {
        console.warn('[Detail] 云存储下载失败:', e);
      }
    }
    throw new Error('源图文件已丢失（可能被系统清理），且云端无备份');
  },

  async _rerenderWatermark() {
    const record = this.data.record;
    const tpl = templates.getTemplateById(record.templateId);
    if (!tpl) throw new Error('模板不存在');

    // 快速检测可用源图（不等待 10s canvas 超时）
    var src = await this._getSourceImagePath(record);
    console.log('[Detail] 重新渲染, 源图:', src.path, 'isOriginal:', src.isOriginal);

    try {
      const outPath = await watermark.renderWatermarkedImage({
        imagePath: src.path,
        template: tpl,
        values: this.data.editValues,
        imgW: record.width || 1080,
        imgH: record.height || 1440,
        customX: record.watermarkX,
        customY: record.watermarkY,
        customScale: this.data.editScale,
        opacity: this.data.editOpacity,
        widthRatio: this.data.editWidthRatio,
        maxEdge: 4096
      });

      const persistentWmPath = await this._persistWmPhoto(outPath);
      console.log('[Detail] 水印图重渲并持久化:', persistentWmPath);
      if (!persistentWmPath) throw new Error('水印图持久化失败');
      return persistentWmPath;

    } catch (e) {
      // 非原始图时尝试降级
      if (src.isOriginal && record.imagePath && this._fileExists(record.imagePath)) {
        console.warn('[Detail] 原图渲染失败，降级到已水印图:', e.message);
        const outPath = await watermark.renderWatermarkedImage({
          imagePath: record.imagePath,
          template: tpl,
          values: this.data.editValues,
          imgW: record.width || 1080,
          imgH: record.height || 1440,
          customX: record.watermarkX,
          customY: record.watermarkY,
          customScale: this.data.editScale,
          opacity: this.data.editOpacity,
          widthRatio: this.data.editWidthRatio,
          maxEdge: 4096
        });
        const persistentWmPath = await this._persistWmPhoto(outPath);
        console.log('[Detail] 降级渲染完成:', persistentWmPath);
        if (!persistentWmPath) throw new Error('水印图持久化失败');
        return persistentWmPath;
      }
      throw e;
    }
  },

  _persistWmPhoto(tempPath) {
    return new Promise((resolve) => {
      const fs = wx.getFileSystemManager();
      fs.saveFile({
        tempFilePath: tempPath,
        success: (res) => { resolve(res.savedFilePath); },
        fail: (err) => {
          console.warn('[Detail] saveFile 失败，尝试 copyFile:', err);
          const dest = wx.env.USER_DATA_PATH + '/wm_' + Date.now() + '.jpg';
          fs.copyFile({
            srcPath: tempPath,
            destPath: dest,
            success: () => { resolve(dest); },
            fail: (err2) => {
              console.warn('[Detail] copyFile 失败，尝试 readFile+writeFile:', err2);
              try {
                const buf = fs.readFileSync(tempPath);
                if (buf && (buf.byteLength || buf.length)) {
                  const finalDest = wx.env.USER_DATA_PATH + '/wm_' + Date.now() + '.jpg';
                  fs.writeFileSync(finalDest, buf);
                  console.log('[Detail] readFile+writeFile 成功:', finalDest);
                  resolve(finalDest);
                  return;
                }
              } catch (e) {
                console.error('[Detail] readFile+writeFile 也失败:', e);
              }
              console.error('[Detail] 全部持久化方式均失败，放弃保存文件');
              resolve(null);
            }
          });
        }
      });
    });
  },

  onFieldInput(e) {
    const key = e.currentTarget.dataset.key;
    const val = e.detail.value;
    const editValues = Object.assign({}, this.data.editValues, { [key]: val });
    // 实时刷新水印预览内容
    const displayFields = this.data.fields.filter(f => editValues[f.key]).map(f => ({
      key: f.key,
      label: f.label,
      value: editValues[f.key]
    }));
    this.setData({ editValues, displayFields });
    // 字段变化可能导致水印行数变化，高度随之变化，延迟测量
    // 连续输入会堆叠 setTimeout + SelectorQuery，做 150ms 防抖只保留最后一次
    if (this._measureTimer) clearTimeout(this._measureTimer);
    this._measureTimer = setTimeout(() => {
      this._measureTimer = null;
      this._measureWmHeight();
    }, 150);
  },

  onScaleChange(e) {
    const v = e.detail.value;
    this.setData({ editScale: v, scaleLabel: Math.round(v * 100) + '%' });
  },

  onOpacityChange(e) {
    const v = e.detail.value;
    this.setData({ editOpacity: v, opacityLabel: Math.round(v * 100) + '%' });
  },

  onWidthChange(e) {
    const v = e.detail.value;
    this.wmWidth = this.data.imgDisplayW * v;
    this.setData({ editWidthRatio: v, widthLabel: Math.round(v * 100) + '%' });
    // 宽度变化后水印换行可能变化，延迟测量高度
    setTimeout(() => this._measureWmHeight(), 50);
  },

  onDelete() {
    var that = this;
    wx.showModal({
      title: '删除确认',
      content: '确定要删除本条记录吗？（将移入回收站，30天后自动清理）',
      success: (res) => {
        if (res.confirm) {
          var id = that.recordId;
          storage.moveToTrash(id);
          // 同步开启时云端软删除
          if (cloud.isSyncEnabled()) {
            cloud.getOpenid().then(function (openid) {
              if (openid) {
                cloud.softDelete(id, openid).catch(function (err) {
                  console.warn('[Detail] 云端软删除失败:', err);
                });
              }
            });
          }
          wx.navigateBack();
        }
      }
    });
  },

  onToggleAutoSaveEdit(e) {
    const v = e.detail.value;
    storage.setAutoSaveEditAlbum(v);
    this.setData({ autoSaveEditAlbum: v });
    // 配置同步开启时推送到云端
    if (cloud.getConfigSyncEnabled()) {
      cloud.getOpenid().then(function (oid) {
        if (oid) cloud.pushConfigChanges(oid);
      });
    }
  },

  onShareAppMessage() {
    return {
      title: '水印相机 · ' + (this.data.record ? this.data.record.templateName : ''),
      path: '/pages/index/index'
    }
  }
});
