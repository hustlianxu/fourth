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

  onLoad(options) {
    this.recordId = options.id;
  },

  onReady() {
    // 使用离屏 Canvas 渲染，无需初始化 DOM Canvas
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
      // 保存修改：用新字段值重新渲染水印
      wx.showLoading({ title: '保存中...', mask: true });

      try {
        const newImagePath = await this._rerenderWatermark(this.data.editValues);

        const patch = {
          values: this.data.editValues,
          imagePath: newImagePath
        };
        storage.update(this.recordId, patch);

        wx.hideLoading();
        wx.showToast({ title: '已更新', icon: 'success' });

        this.load();
        this.setData({ editing: false, editValues: {} });
      } catch (e) {
        wx.hideLoading();
        console.error('[Detail] 重新渲染水印失败:', e);
        // 显示具体错误信息方便排查
        const errMsg = e.message || String(e);
        wx.showToast({ title: '更新失败: ' + errMsg.slice(0, 20), icon: 'none', duration: 3000 });
      }
    } else {
      this.setData({
        editing: true,
        editValues: Object.assign({}, this.data.record.values)
      });
    }
  },

  // 重新渲染水印（使用离屏 Canvas）
  async _rerenderWatermark(newValues) {
    const record = this.data.record;
    const tpl = templates.getTemplateById(record.templateId);

    if (!tpl) {
      throw new Error('模板不存在');
    }

    // 必须使用原始照片（无水印），不能用已渲染过的 imagePath
    const originalPath = record.originalPath;
    if (!originalPath) {
      throw new Error('原始照片不存在，无法重新渲染');
    }

    console.log('[Detail] 开始重新渲染水印, originalPath:', originalPath);

    // 详情页重新渲染使用较高分辨率，iOS 4096 / Android 2048（watermark.js 自动适配）
    const outPath = await watermark.renderWatermarkedImage({
      imagePath: originalPath,
      template: tpl,
      values: newValues,
      imgW: record.width || 1080,
      imgH: record.height || 1440,
      customX: record.watermarkX,
      customY: record.watermarkY,
      customScale: record.watermarkScale || 1,
      opacity: record.watermarkOpacity || 0.85,
      maxEdge: 4096
    });

    console.log('[Detail] 重新渲染完成:', outPath);
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
