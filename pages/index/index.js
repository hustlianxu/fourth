// pages/index/index.js
const templates = require('../../utils/templates.js');
const storage = require('../../utils/storage.js');

Page({
  data: {
    templates: [],
    selectedId: 'handwrite',
    total: 0
  },

  onLoad() {
    this.setData({
      templates: templates.TEMPLATES
    });
  },

  onShow() {
    const list = storage.getAll();
    this.setData({ total: list.length });
  },

  onSelectTemplate(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ selectedId: id });
  },

  goCamera() {
    const id = this.data.selectedId;
    wx.navigateTo({
      url: '/pages/camera/camera?templateId=' + id
    });
  },

  goList() {
    wx.navigateTo({
      url: '/pages/list/list'
    });
  },

  goAbout() {
    wx.showModal({
      title: '关于水印相机',
      content: '基于微信小程序原生实现：可选水印模板，据实填写数据；生成带水印的照片并与字段关联保存。可扩展至微信云开发，支持云端 OCR 核验。',
      showCancel: false
    });
  }
});
