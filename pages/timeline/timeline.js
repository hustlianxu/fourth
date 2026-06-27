// pages/timeline/timeline.js
const cloud = require('../../utils/cloud.js');
const storage = require('../../utils/storage.js');

Page({
  data: {
    record: null,
    recordId: '',
    history: [],
    loading: true,
    currentVersion: 0
  },

  onLoad(options) {
    var id = options.id;
    if (!id) {
      wx.showToast({ title: '缺少记录 ID', icon: 'none' });
      wx.navigateBack();
      return;
    }
    this.setData({ recordId: id });
    this.load();
  },

  onShow() {
    if (this.data.recordId) this.load();
  },

  load() {
    var record = storage.getById(this.data.recordId);
    if (!record) {
      wx.showToast({ title: '记录不存在', icon: 'none' });
      return;
    }
    this.setData({ record: record, currentVersion: record.version || 1 });

    var that = this;
    cloud.getHistory(this.data.recordId).then(function (list) {
      that.setData({ history: list, loading: false });
    });
  },

  formatTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  },

  onRestore(e) {
    var version = parseInt(e.currentTarget.dataset.version, 10);
    var item = this.data.history.find(function (h) { return h.version === version; });
    if (!item || !item.snapshot) {
      wx.showToast({ title: '快照数据异常', icon: 'none' });
      return;
    }

    var that = this;
    wx.showModal({
      title: '回滚确认',
      content: '确定要回滚到 V' + version + ' 吗？当前版本将被保存为历史快照。',
      success: function (res) {
        if (res.confirm) {
          wx.showLoading({ title: '回滚中...', mask: true });
          cloud.restoreVersion(that.data.recordId, item.snapshot).then(function (result) {
            wx.hideLoading();
            if (result && result.success) {
              // 同步更新本地记录
              var record = that.data.record;
              if (item.snapshot.values) {
                storage.update(that.data.recordId, {
                  values: item.snapshot.values,
                  templateId: item.snapshot.templateId || record.templateId,
                  templateName: item.snapshot.templateName || record.templateName,
                  watermarkScale: item.snapshot.watermarkScale || record.watermarkScale
                });
              }
              wx.showToast({ title: '已回滚到 V' + version, icon: 'success' });
              // 刷新
              setTimeout(function () {
                that.load();
              }, 500);
            } else {
              wx.showToast({ title: '回滚失败', icon: 'none' });
            }
          }).catch(function (err) {
            wx.hideLoading();
            wx.showToast({ title: '回滚失败', icon: 'none' });
            console.error('[Timeline] 回滚失败:', err);
          });
        }
      }
    });
  }
});
