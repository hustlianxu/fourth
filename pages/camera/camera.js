// pages/camera/camera.js
const templates = require('../../utils/templates.js');
const storage = require('../../utils/storage.js');
const watermark = require('../../utils/watermark.js');
const ocr = require('../../utils/ocr.js');

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
    const tplId = options.templateId || 'handwrite';
    const tpl = templates.getTemplateById(tplId);
    const defaultVals = templates.getDefaultValues(tpl);
    const windowInfo = wx.getWindowInfo();
    this.viewportW = windowInfo.windowWidth;
    this.viewportH = windowInfo.windowWidth * 0.72 / (windowInfo.windowWidth / windowInfo.windowHeight);
    // 取景框高度 = 72vh，换算为 px
    this.viewportH = windowInfo.windowHeight * 0.72;
    this.setData({
      template: tpl,
      templates: templates.TEMPLATES,
      values: defaultVals,
      wPos: (tpl && tpl.position) || 'bottom-center'
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
    const previewFontSize = Math.max(10, Math.round(22 * ratio));
    // 未缩放尺寸（CSS transform: scale 会处理缩放）
    const lineHeight = Math.round(previewFontSize * 1.6);
    const fieldCount = previewFields.length;
    const padding = Math.round(14 * ratio);
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
        newB = Math.max(0, Math.min(newB, this.viewportH - 40));
        this.setData({
          wmX: Math.round(newX), wmBottom: Math.round(newB),
          wmPosStyle: 'left: ' + Math.round(newX) + 'px; bottom: ' + Math.round(newB) + 'px;'
        });
      } else {
        let newY = this.wmStartY + dy;
        newY = Math.max(-this.viewportH * 0.3, Math.min(newY, this.viewportH - 40));
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
    this.setData({
      template: tpl,
      values: templates.getDefaultValues(tpl, { location: this.data.values.location }),
      wPos: (tpl && tpl.position) || 'bottom-center'
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
        that._goPreview(tempPath, { width: info.width, height: info.height });
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
              that._goPreview(tempPath, { width: 3024, height: 4032 });
            },
            fail: () => that._goPreview(tempPath, { width: 3024, height: 4032 })
          });
        }
      }
    });
  },


  _goPreview(photo, photoInfo) {
    try {
      const template = Object.assign({}, this.data.template, { position: this.data.wPos });
      getApp().globalData.previewData = {
        photo, photoInfo: JSON.stringify(photoInfo),
        template: JSON.stringify(template), values: JSON.stringify(this.data.values)
      };
      wx.navigateTo({
        url: '/pages/preview/preview',
        fail: (err) => { console.error('navigateTo failed:', err); getApp().globalData.previewData = null; }
      });
    } catch (e) {
      console.error('_goPreview error:', e);
      wx.showToast({ title: '跳转失败', icon: 'none' });
    }
  },

  onPickImage() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album'],
      success: (res) => {
        wx.getImageInfo({
          src: res.tempFiles[0].tempFilePath,
          success: (info) => this._goPreview(info.path, { width: info.width, height: info.height }),
          fail: () => this._goPreview(res.tempFiles[0].tempFilePath, { width: 1080, height: 1440 })
        });
      }
    });
  },
});
