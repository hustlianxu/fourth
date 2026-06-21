// pages/list/list.js
const storage = require('../../utils/storage.js');
const templates = require('../../utils/templates.js');

Page({
  data: {
    list: []
  },

  onShow() {
    const raw = storage.getAll();
    const list = raw.map((item) => {
      const fields = templates.getTemplateById(item.templateId);
      const summary = item.values ? Object.keys(item.values).slice(0, 3).map((k) => {
        return k + ': ' + (item.values[k] || '');
      }).join(' · ') : '';
      const date = new Date(item.createdAt);
      return Object.assign({}, item, {
        timeText: templates.formatDateTime(date),
        summary
      });
    });
    this.setData({ list });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },

  goCamera() {
    wx.navigateTo({ url: '/pages/camera/camera' });
  },

  onClear() {
    if (this.data.list.length === 0) return;
    wx.showModal({
      title: '清空确认',
      content: '将删除本地所有记录（仅删除数据库记录，已保存到相册的照片不受影响）。',
      success: (res) => {
        if (res.confirm) {
          storage.clearAll();
          this.onShow();
        }
      }
    });
  }
});
