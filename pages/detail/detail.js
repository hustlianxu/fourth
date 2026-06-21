// pages/detail/detail.js
const storage = require('../../utils/storage.js');
const templates = require('../../utils/templates.js');
const ocr = require('../../utils/ocr.js');

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

  onLoad(options) {
    this.recordId = options.id;
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

  onEditToggle() {
    if (this.data.editing) {
      // 保存
      const patch = { values: this.data.editValues };
      storage.update(this.recordId, patch);
      // 重新跑一次 OCR 校验
      ocr.recognize(this.data.record.imagePath)
        .catch(() => null)
        .then((res) => {
          const issues = ocr.verify(this.data.editValues, res);
          storage.update(this.recordId, { ocr: res, verifyIssues: issues });
          this.load();
          this.setData({ editing: false, editValues: {} });
          wx.showToast({ title: '已更新', icon: 'success' });
        });
    } else {
      this.setData({
        editing: true,
        editValues: Object.assign({}, this.data.record.values)
      });
    }
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
      content: '将从本地删除本条记录（已保存到相册的照片不会被删除）。',
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
    };
  }
});
