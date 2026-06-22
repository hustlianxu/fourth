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
    ocrResult: null,
    verifyIssues: []
  },

  recordId: '',
  ctx2d: null,
  canvas: null,

  onLoad(options) {
    this.recordId = options.id;
  },

  onReady() {
    wx.createSelectorQuery().select('#wmCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (res && res[0] && res[0].node) {
          this.canvas = res[0].node;
          this.ctx2d = res[0].node.getContext('2d');
        }
      });
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
    const date = new Date(record.createdAt);
    this.setData({
      record,
      fields,
      timeText: templates.formatDateTime(date),
      ocrResult: record.ocr || null,
      verifyIssues: record.verifyIssues || []
    });
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

  async onEditToggle() {
    if (this.data.editing) {
      // 保存修改
      wx.showLoading({ title: '保存中...', mask: true });
      
      try {
        // 重新渲染水印图片
        const newImagePath = await this._rerenderWatermark(this.data.editValues);
        
        // 更新记录
        const patch = { 
          values: this.data.editValues,
          imagePath: newImagePath
        };
        storage.update(this.recordId, patch);
        
        wx.hideLoading();
        wx.showToast({ title: '已更新', icon: 'success' });
        
        // 重新加载
        this.load();
        this.setData({ editing: false, editValues: {} });
      } catch (e) {
        wx.hideLoading();
        wx.showToast({ title: '更新失败', icon: 'none' });
        console.error('重新渲染水印失败:', e);
      }
    } else {
      this.setData({
        editing: true,
        editValues: Object.assign({}, this.data.record.values)
      });
    }
  },

  // 重新渲染水印
  async _rerenderWatermark(newValues) {
    if (!this.ctx2d || !this.canvas) {
      throw new Error('Canvas 未就绪');
    }

    const record = this.data.record;
    const tpl = templates.getTemplateById(record.templateId);
    
    if (!tpl) {
      throw new Error('模板不存在');
    }

    // 使用原图重新渲染
    const originalPath = record.originalPath || record.imagePath;
    
    await watermark.drawWatermark({
      ctx: this.ctx2d,
      canvas: this.canvas,
      imagePath: originalPath,
      template: tpl,
      values: newValues,
      imgW: record.width || 1080,
      imgH: record.height || 1440,
      customX: record.watermarkX,
      customY: record.watermarkY,
      customScale: record.watermarkScale || 1,
      opacity: record.watermarkOpacity || 0.85
    });

    const outPath = await watermark.canvasToTempFilePath(this.canvas);
    return outPath;
  },

  onFieldInput(e) {
    const key = e.currentTarget.dataset.key;
    const val = e.detail.value;
    const editValues = Object.assign({}, this.data.editValues, { [key]: val });
    this.setData({ editValues });
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
