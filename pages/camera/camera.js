// pages/camera/camera.js
const templates = require('../../utils/templates.js');
const storage = require('../../utils/storage.js');
const watermark = require('../../utils/watermark.js');
const ocr = require('../../utils/ocr.js');
const cloud = require('../../utils/cloud.js');

const POSITIONS = [
  { id: 'top-left',     grid: '1 / 1', label: '左上' },
  { id: 'top-center',   grid: '1 / 2', label: '上中' },
  { id: 'top-right',    grid: '1 / 3', label: '右上' },
  { id: 'center-left',  grid: '2 / 1', label: '左中' },
  { id: 'center',       grid: '2 / 2', label: '正中' },
  { id: 'center-right', grid: '2 / 3', label: '右中' },
  { id: 'bottom-left',  grid: '3 / 1', label: '左下' },
  { id: 'bottom-center',grid: '3 / 2', label: '下中' },
  { id: 'bottom-right', grid: '3 / 3', label: '右下' }
];

Page({
  data: {
    template: null,
    templates: [],
    values: {},
    photo: null,
    photoInfo: null,
    stage: 'camera',
    showTplPicker: false,
    wPos: 'bottom-center',
    POSITIONS: POSITIONS,
    // 水印浮层
    wmX: 0,
    wmY: 0,
    wmBottom: 0,
    wmTransform: '',
    wmPosStyle: '',
    wmScale: 1.0,
    scaleLabel: '100%',
    wmPreviewFields: [],
    wmPreviewFontSize: 14,
    wmPadding: 8,
    // 行内编辑
    editingFieldKey: '',
    editValue: '',
    // 名称输入
    customName: '',
    // 拍照闪光动画
    navTotalHeight: 0,
    flashAnim: false,
  },

  // 拖拽状态（实例变量，不在 data 中避免频繁 setData）
  dragStartX: 0,
  dragStartY: 0,
  wmStartX: 0,
  wmStartY: 0,
  isDragging: false,
  isPinching: false,
  lastPinchDist: 0,
  wmScaleStart: 1,
  viewportW: 0,
  viewportH: 0,



  onLoad(options) {
    const tplId = options.templateId || 'minimal';

    const tpl = templates.getTemplateById(tplId);
    // 模板可能被删除或参数异常，做 null 防护，避免后续 getDefaultValues/validate 崩溃白屏
    if (!tpl) {
      wx.showToast({ title: '模板不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const defaultVals = templates.getDefaultValues(tpl);
    const windowInfo = wx.getWindowInfo();
    this.viewportW = windowInfo.windowWidth;
    // 取景框高度 = 72vh，换算为 px
    this.viewportH = windowInfo.windowHeight * 0.72;
    this.setData({
      template: tpl,
      templates: templates.TEMPLATES,
      values: defaultVals,
      wPos: tpl.position || 'bottom-center'
    });
    this._calcWmPreview();
    this._applyWmPosition();
    this.ctx = wx.createCameraContext();
  },

  onShow() {
    this._refreshTimeFields();
  },

  // ===== 水印位置 =====

  onSetPos(e) {
    const pos = e.currentTarget.dataset.pos;
    this.setData({ wPos: pos });
    this._applyWmPosition();
  },

  _applyWmPosition() {
    const s = this.data.wmScale;
    const margin = this.viewportW * 0.04;
    const vW = (this._wmEstW || this.viewportW * 0.42) * s;
    const isLeft = this.data.wPos.indexOf('left') >= 0;
    const isRight = this.data.wPos.indexOf('right') >= 0;
    const isTop = this.data.wPos.indexOf('top') >= 0;
    const isBottom = this.data.wPos.indexOf('bottom') >= 0;

    let x, style;
    if (isLeft) x = margin;
    else if (isRight) x = this.viewportW - vW - margin;
    else x = (this.viewportW - vW) / 2;

    style = 'left: ' + Math.round(x) + 'px; ';

    if (isBottom) {
      this.setData({
        wmX: Math.round(x), wmBottom: Math.round(margin),
        wmPosStyle: 'left: ' + Math.round(x) + 'px; bottom: ' + Math.round(margin) + 'px;',
        wmTransform: 'transform-origin: left bottom; transform: scale(' + s + ');'
      });
    } else if (isTop) {
      this.setData({
        wmX: Math.round(x), wmY: Math.round(margin),
        wmPosStyle: 'left: ' + Math.round(x) + 'px; top: ' + Math.round(margin) + 'px;',
        wmTransform: 'transform-origin: left top; transform: scale(' + s + ');'
      });
    } else {
      this.setData({
        wmX: Math.round(x), wmY: 0,
        wmPosStyle: 'left: ' + Math.round(x) + 'px; top: 50%;',
        wmTransform: 'transform-origin: left center; transform: translateY(-50%) scale(' + s + ');'
      });
    }
  },

  // ===== 水印预览 =====

  _calcWmPreview() {
    const fields = (this.data.template && this.data.template.fields) || [];
    const vals = this.data.values || {};
    const previewFields = fields.map((f) => ({
      key: f.key,
      label: f.label,
      value: (vals[f.key] && String(vals[f.key]).trim()) ? String(vals[f.key]).trim() : ''
    }));
    const viewportW = wx.getWindowInfo().windowWidth;
    const ratio = viewportW / 750;
    // 字号/行高与最终水印渲染保持一致（避免预览与实际换行位置不符）
    const tplStyle = (this.data.template && this.data.template.style) || {};
    const previewFontSize = Math.max(10, Math.round((tplStyle.fontSize || 22) * ratio));
    // 未缩放尺寸（CSS transform: scale 会处理缩放）
    const lineHeight = Math.round(previewFontSize * (tplStyle.lineHeight || 1.7));
    const fieldCount = previewFields.length;
    const padding = Math.round((tplStyle.padding || 14) * ratio);
    this._wmEstW = this.viewportW * 0.42;
    this._wmEstH = fieldCount * 2 * lineHeight + padding * 2 + 30;
    this.setData({
      wmPreviewFields: previewFields,
      wmPreviewFontSize: previewFontSize,
      wmPadding: padding
    });
  },

  // ===== 行内编辑 =====

  onFieldTap(e) {
    const key = e.currentTarget.dataset.key;
    const field = this.data.wmPreviewFields.find(f => f.key === key);
    if (!field) return;
    this.setData({
      editingFieldKey: key,
      editValue: field.value
    });
  },

  onEditInput(e) {
    this.setData({ editValue: e.detail.value });
  },

  onEditConfirm() {
    const key = this.data.editingFieldKey;
    const val = this.data.editValue;
    const values = Object.assign({}, this.data.values, { [key]: val });
    this.setData({ values, editingFieldKey: '', editValue: '' });
    this._calcWmPreview();
  },

  onEditBlur() {
    if (this.data.editingFieldKey) {
      this.onEditConfirm();
    }
  },

  // ===== 拖拽 =====

  onWmDragStart(e) {
    if (this.data.editingFieldKey) return;
    const touch = e.touches[0];
    if (e.touches.length === 1) {
      this.isDragging = true;
      this.isPinching = false;
      this.dragStartX = touch.clientX;
      this.dragStartY = touch.clientY;
      this.wmStartX = this.data.wmX;
      this.wmStartY = (this.data.wmPosStyle.indexOf('bottom') >= 0) ? this.data.wmBottom : this.data.wmY;
    } else if (e.touches.length === 2) {
      this.isPinching = true;
      this.isDragging = false;
      this.lastPinchDist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      );
      this.wmScaleStart = this.data.wmScale;
    }
  },

  onWmDragMove(e) {
    if (this.isDragging && e.touches.length === 1) {
      const dx = e.touches[0].clientX - this.dragStartX;
      const dy = e.touches[0].clientY - this.dragStartY;
      let newX = this.wmStartX + dx;
      const s = this.data.wmScale;
      newX = Math.max(0, Math.min(newX, this.viewportW - (this._wmEstW || 120) * s));
      if (this.data.wmPosStyle.indexOf('bottom') >= 0) {
        let newB = this.wmStartY - dy;
        // 下边界用预览层实际高度（乘缩放），避免水印整体被拖出取景框底部
        newB = Math.max(0, Math.min(newB, this.viewportH - (this._wmEstH || 40) * s));
        this.setData({
          wmX: Math.round(newX), wmBottom: Math.round(newB),
          wmPosStyle: 'left: ' + Math.round(newX) + 'px; bottom: ' + Math.round(newB) + 'px;'
        });
      } else {
        let newY = this.wmStartY + dy;
        newY = Math.max(-this.viewportH * 0.3, Math.min(newY, this.viewportH - (this._wmEstH || 40) * s));
        this.setData({
          wmX: Math.round(newX), wmY: Math.round(newY),
          wmPosStyle: 'left: ' + Math.round(newX) + 'px; top: ' + Math.round(newY) + 'px;'
        });
      }
    } else if (this.isPinching && e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      );
      if (this.lastPinchDist > 0) {
        let s = this.wmScaleStart * (dist / this.lastPinchDist);
        s = Math.max(0.5, Math.min(s, 2.0));
        this.setData({ wmScale: Math.round(s * 100) / 100, scaleLabel: Math.round(s * 100) + '%' });
        this._calcWmPreview();
      }
      this.lastPinchDist = dist;
    }
  },

  onWmDragEnd() {
    this.isDragging = false;
    this.isPinching = false;
    this.lastPinchDist = 0;
  },

  // ===== 时间刷新 =====

  _refreshTimeFields() {
    if (!this.data.template || !this.data.template.fields) return;
    const now = new Date();
    const values = Object.assign({}, this.data.values);
    let changed = false;
    this.data.template.fields.forEach((f) => {
      if (f.type === 'datetime') { values[f.key] = templates.formatDateTime(now); changed = true; }
      if (f.type === 'date') { values[f.key] = templates.formatDate(now); changed = true; }
      if (f.type === 'time') { values[f.key] = templates.formatTime(now); changed = true; }
    });
    if (changed) {
      this.setData({ values });
      this._calcWmPreview();
    }
  },

  // ===== 字段输入（原有 handlers，供 onGetLocation 等使用） =====

  onNameInput(e) {
    this.setData({ customName: e.detail.value.trim() });
  },

  onFieldInput(e) {
    const key = e.currentTarget.dataset.key;
    const val = e.detail.value;
    const values = Object.assign({}, this.data.values, { [key]: val });
    this.setData({ values });
    this._calcWmPreview();
  },

  onSelectChange(e) {
    const key = e.currentTarget.dataset.key;
    const range = e.currentTarget.dataset.range;
    const idx = e.detail.value;
    const values = Object.assign({}, this.data.values, { [key]: range[idx] });
    this.setData({ values });
    this._calcWmPreview();
  },

  onGetLocation() {
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        const location = 'Loc ' + res.latitude.toFixed(4) + ',' + res.longitude.toFixed(4);
        const values = Object.assign({}, this.data.values, { location });
        this.setData({ values });
        this._calcWmPreview();
        wx.showToast({ title: '已定位', icon: 'success' });
      },
      fail: () => wx.showToast({ title: '定位失败', icon: 'none' })
    });
  },

  onRefreshTime() { this._refreshTimeFields(); },

  onTplTap() { this.setData({ showTplPicker: true }); },

  onPickTemplate(e) {
    const id = e.currentTarget.dataset.id;
    const tpl = templates.getTemplateById(id);
    // 切换模板时重置编辑状态，防止 editingFieldKey 残留阻止拖拽、editValue 显示旧值、wmScale 带入旧缩放
    this.setData({
      template: tpl,
      values: templates.getDefaultValues(tpl, { location: this.data.values.location }),
      wPos: (tpl && tpl.position) || 'bottom-center',
      editingFieldKey: '',
      editValue: '',
      wmScale: 1.0
    });
    this._calcWmPreview();
    this._applyWmPosition();
  },

  closePicker() { this.setData({ showTplPicker: false }); },

  // ===== 校验 + 拍照 =====

  validate() {
    const fields = this.data.template.fields || [];
    const values = this.data.values || {};
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.required && (!values[f.key] || !String(values[f.key]).trim())) {
        wx.showToast({ title: f.label + ' 不能为空', icon: 'none' });
        return false;
      }
    }
    return true;
  },

  onTakePhoto() {
    if (!this.validate()) return;
    // 闪光动画
    this.setData({ flashAnim: true });
    setTimeout(() => this.setData({ flashAnim: false }), 300);

    this.ctx.takePhoto({
      quality: 'high',
      success: (res) => {
        const tempPath = res.tempImagePath;
        console.log('[Camera] 拍照成功, tempPath:', tempPath);
        wx.getFileSystemManager().getFileInfo({
          filePath: tempPath,
          success: (fileInfo) => {
            console.log('[Camera] 拍照文件大小:', fileInfo.size, '字节 (', (fileInfo.size / 1024).toFixed(1), 'KB)');
          },
          fail: (err) => console.error('[Camera] getFileInfo 失败:', JSON.stringify(err))
        });
        this._getPhotoInfo(tempPath, 0);
      },
      fail: (err) => {
        console.error('[Camera] takePhoto 失败:', JSON.stringify(err));
        wx.showToast({ title: '拍照失败', icon: 'none' });
      }
    });
  },

  _getPhotoInfo(tempPath, retryCount) {
    const MAX_RETRY = 1;
    const that = this;
    wx.getImageInfo({
      src: tempPath,
      success: (info) => {
        console.log('[Camera] 拍照分辨率:', info.width, 'x', info.height, '(type:', info.type, ')');
        that._saveAndGoDetail(tempPath, { width: info.width, height: info.height });
      },
      fail: (err) => {
        console.error('[Camera] getImageInfo 失败 (retry=' + retryCount + '):', JSON.stringify(err));
        if (retryCount < MAX_RETRY) {
          setTimeout(() => that._getPhotoInfo(tempPath, retryCount + 1), 300);
        } else {
          wx.getFileSystemManager().getFileInfo({
            filePath: tempPath,
            success: (fileInfo) => {
              console.warn('[Camera] getImageInfo 最终失败，文件大小:', fileInfo.size, '使用估算 3024x4032');
              that._saveAndGoDetail(tempPath, { width: 3024, height: 4032 });
            },
            fail: () => that._saveAndGoDetail(tempPath, { width: 3024, height: 4032 })
          });
        }
      }
    });
  },

  _persistPhoto(tempPath, prefix) {
    return new Promise((resolve) => {
      const fs = wx.getFileSystemManager();
      fs.saveFile({
        tempFilePath: tempPath,
        success: (res) => {
          console.log('[Camera] saveFile 成功:', res.savedFilePath);
          resolve(res.savedFilePath);
        },
        fail: (err) => {
          console.warn('[Camera] saveFile 失败，尝试 copyFile:', err);
          const dest = wx.env.USER_DATA_PATH + '/' + (prefix || 'photo') + '_' + Date.now() + '.jpg';
          fs.copyFile({
            srcPath: tempPath,
            destPath: dest,
            success: () => {
              console.log('[Camera] copyFile 成功:', dest);
              resolve(dest);
            },
            fail: (err2) => {
              console.warn('[Camera] copyFile 失败，尝试 readFile+writeFile:', err2);
              // 最终兜底：逐字节读取再写入，saveFile/copyFile 失败但 readFile 可能仍可读
              try {
                const buf = fs.readFileSync(tempPath);
                if (buf && (buf.byteLength || buf.length)) {
                  const finalDest = wx.env.USER_DATA_PATH + '/' + (prefix || 'photo') + '_' + Date.now() + '.jpg';
                  fs.writeFileSync(finalDest, buf);
                  console.log('[Camera] readFile+writeFile 成功:', finalDest);
                  resolve(finalDest);
                  return;
                }
              } catch (e) {
                console.warn('[Camera] readFile+writeFile 也失败:', e);
                console.warn('[Camera] 存储配额不足，回退使用原始临时路径');
              }
              // 持久化均失败 → 回退原始临时路径（开发者工具有存储配额限制，真机不受影响）
              if (tempPath) {
                console.warn('[Camera] 回退临时路径:', tempPath);
                resolve(tempPath);
              } else {
                resolve(null);
              }
            }
          });
        }
      });
    });
  },

  _persistOriginalPhoto(tempPath) {
    return this._persistPhoto(tempPath, 'orig');
  },

  _persistWatermarkPhoto(tempPath) {
    return this._persistPhoto(tempPath, 'wm');
  },

  // 自动保存到系统相册（开关开启时，原图+水印图都存一份）
  // 平台限制：wx.saveImageToPhotosAlbum 需用户授权 scope.writePhotosAlbum
  _autoSaveToAlbum(originalPath, watermarkedPath) {
    if (!storage.getAutoSaveAlbum()) return Promise.resolve(false);
    return new Promise((resolve) => {
      let saved = 0;
      const total = 2;
      const checkDone = () => {
        saved++;
        if (saved >= total) {
          console.log('[Camera] 自动保存相册完成');
          resolve(true);
        }
      };
      // 保存原图
      wx.saveImageToPhotosAlbum({
        filePath: originalPath,
        success: () => { console.log('[Camera] 原图已存相册'); checkDone(); },
        fail: (err) => {
          console.warn('[Camera] 原图存相册失败:', err && err.errMsg);
          checkDone();
        }
      });
      // 保存水印图
      wx.saveImageToPhotosAlbum({
        filePath: watermarkedPath,
        success: () => { console.log('[Camera] 水印图已存相册'); checkDone(); },
        fail: (err) => {
          console.warn('[Camera] 水印图存相册失败:', err && err.errMsg);
          checkDone();
        }
      });
    }).catch((e) => {
      console.warn('[Camera] 自动保存相册异常:', e);
      return false;
    });
  },

  // 一步保存：渲染水印 → 持久化原图 → 入库 → 跳转详情页
  async _saveAndGoDetail(photo, photoInfo) {
    wx.showLoading({ title: '保存中...', mask: true });
    try {
      const imgW = photoInfo.width || 1080;
      const imgH = photoInfo.height || 1440;
      const tpl = this.data.template;

      // 1. 先用临时路径渲染水印图片（saveFile 会移动临时文件，必须先渲染）
      const outPath = await watermark.renderWatermarkedImage({
        imagePath: photo,
        template: tpl,
        values: this.data.values,
        imgW: imgW,
        imgH: imgH,
        customScale: this.data.wmScale,
        opacity: 0.85,
        widthRatio: 0.42
      });
      console.log('[Camera] 水印渲染完成:', outPath);

      // 2. 持久化原图和水印图（防止临时文件被回收，Mac 开发者工具上尤其明显）
      const persistentPath = await this._persistOriginalPhoto(photo);
      console.log('[Camera] 原图持久化:', persistentPath);
      if (!persistentPath) throw new Error('原图保存失败');
      const persistentWmPath = await this._persistWatermarkPhoto(outPath);
      console.log('[Camera] 水印图持久化:', persistentWmPath);
      if (!persistentWmPath) throw new Error('水印图保存失败');

      // 2.5 自动保存到系统相册（若用户开启此开关，原图+水印图都存一份，降低丢失风险）
      await this._autoSaveToAlbum(persistentPath, persistentWmPath);

      // 3. 入库
      const record = {
        id: storage.genId(),
        templateId: tpl.id,
        templateName: tpl.name,
        watermarkPosition: this.data.wPos,
        watermarkScale: this.data.wmScale,
        watermarkOpacity: 0.85,
        watermarkWidthRatio: 0.42,
        values: this.data.values,
        customName: this.data.customName || null,
        imagePath: persistentWmPath,
        originalPath: persistentPath,
        width: imgW,
        height: imgH,
        createdAt: Date.now(),
        ocr: null,
        verifyIssues: [],
        _syncStatus: cloud.isSyncEnabled() ? 'pending' : 'off',
        _cloudOwner: null,
        _permission: null
      };
      storage.add(record);
      console.log('[Camera] 记录已保存:', record.id);

      // 4. 云同步（后台进行，不阻塞跳转）
      if (cloud.isSyncEnabled()) {
        cloud.getOpenid().then(function (oid) {
          if (oid) {
            return cloud.syncRecord(record, oid, true);
          }
        }).then(function (res) {
          if (res && res.success) {
            storage.update(record.id, { _syncStatus: 'synced' });
            console.log('[Camera] 云同步成功:', res.recordId);
          }
        }).catch(function (err) {
          console.warn('[Camera] 云同步失败（不影响本地保存）:', err);
        });
      }

      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });

      // 5. 跳转详情页（redirectTo 替换当前页，避免返回到拍照页）
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/detail/detail?id=' + record.id });
      }, 500);

    } catch (e) {
      wx.hideLoading();
      console.error('[Camera] 保存失败:', e);
      wx.showToast({ title: '保存失败: ' + (e.message || '').slice(0, 20), icon: 'none', duration: 3000 });
    }
  },

  onPickImage() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album'],
      success: (res) => {
        wx.getImageInfo({
          src: res.tempFiles[0].tempFilePath,
          success: (info) => this._saveAndGoDetail(info.path, { width: info.width, height: info.height }),
          // 降级值与拍照路径 _getPhotoInfo 保持一致（3024×4032，4:3），
          // 避免 1080×1440 导致 Canvas 缓冲区与真实图片比例不符造成水印拉伸/裁切
          fail: () => this._saveAndGoDetail(res.tempFiles[0].tempFilePath, { width: 3024, height: 4032 })
        });
      }
    });
  },

  onNavReady(e) {
    this.setData({ navTotalHeight: e.detail.totalNavBarHeight });
  },

});
