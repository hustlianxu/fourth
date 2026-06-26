// pages/detail/detail.js
const storage = require('../../utils/storage.js');
const templates = require('../../utils/templates.js');
const watermark = require('../../utils/watermark.js');

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
    autoSaveEditAlbum: false
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
    const windowInfo = wx.getWindowInfo();
    this.screenWidth = windowInfo.windowWidth;
    this.setData({ autoSaveEditAlbum: storage.getAutoSaveEditAlbum() });
  },

  onReady() {},

  // 浮层菜单
  onToggleActionMenu() {
    this.setData({ showActionMenu: !this.data.showActionMenu });
  },

  onDeleteFromMenu() {
    this.setData({ showActionMenu: false });
    this.onDelete();
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
      verifyIssues: record.verifyIssues || []
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
    if (this.data.editing) {
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
        this.setData({ editing: false, editValues: {}, showWmOverlay: false, displayPhoto: newImagePath });
      } catch (e) {
        wx.hideLoading();
        console.error('[Detail] 重新渲染水印失败:', e);
        const errMsg = e.message || String(e);
        wx.showToast({ title: '更新失败: ' + errMsg.slice(0, 20), icon: 'none', duration: 3000 });
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

  async _rerenderWatermark() {
    const record = this.data.record;
    const tpl = templates.getTemplateById(record.templateId);
    if (!tpl) throw new Error('模板不存在');
    const originalPath = record.originalPath;
    if (!originalPath) throw new Error('原始照片不存在，无法重新渲染');

    console.log('[Detail] 重新渲染, x:', record.watermarkX, 'y:', record.watermarkY, 'scale:', this.data.editScale);

    const outPath = await watermark.renderWatermarkedImage({
      imagePath: originalPath,
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

    // 持久化水印图，防止临时文件被回收（Mac 开发者工具上尤其明显）
    const persistentWmPath = await this._persistWmPhoto(outPath);
    console.log('[Detail] 水印图重渲并持久化:', persistentWmPath);
    return persistentWmPath;
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
              console.error('[Detail] 持久化失败，使用临时路径:', err2);
              resolve(tempPath);
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
    setTimeout(() => this._measureWmHeight(), 50);
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
    wx.showModal({
      title: '删除确认',
      content: '确定要删除本条记录吗？',
      success: (res) => {
        if (res.confirm) {
          storage.remove(this.recordId);
          wx.navigateBack();
        }
      }
    });
  },

  onToggleAutoSaveEdit(e) {
    const v = e.detail.value;
    storage.setAutoSaveEditAlbum(v);
    this.setData({ autoSaveEditAlbum: v });
  },

  onShareAppMessage() {
    return {
      title: '水印相机 · ' + (this.data.record ? this.data.record.templateName : ''),
      path: '/pages/index/index'
    }
  }
});
