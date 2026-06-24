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
    showActionMenu: false
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

  onLoad(options) {
    this.recordId = options.id;
    const windowInfo = wx.getWindowInfo();
    this.screenWidth = windowInfo.windowWidth;
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

    // 计算图片显示尺寸（image 用 widthFix 模式，宽度撑满）
    const imgW = record.width || 1080;
    const imgH = record.height || 1440;
    const displayW = this.screenWidth - 48; // container padding
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
    const wmX = record.watermarkX || 0;
    const wmY = record.watermarkY || 0;
    return {
      x: wmX * (this.data.imgDisplayW / imgW),
      y: wmY * (this.data.imgDisplayH / imgH)
    };
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
      newX = Math.max(0, Math.min(newX, this.data.imgDisplayW - 80));
      newY = Math.max(0, Math.min(newY, this.data.imgDisplayH - 30));
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
        wx.showToast({ title: '已更新', icon: 'success' });

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

    return outPath;
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

  onShareAppMessage() {
    return {
      title: '水印相机 · ' + (this.data.record ? this.data.record.templateName : ''),
      path: '/pages/index/index'
    }
  }
});
