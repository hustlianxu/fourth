// pages/settings/settings.js
const cloud = require('../../utils/cloud.js');
const storage = require('../../utils/storage.js');

Page({
  data: {
    syncEnabled: false,
    openid: '',
    lastSyncText: '',
    syncing: false
  },

  onShow() {
    this.load();
  },

  load() {
    var enabled = storage.getSyncEnabled();
    this.setData({
      syncEnabled: enabled,
      openid: cloud._getCachedOpenid ? cloud._getCachedOpenid() : '',
      lastSyncText: this._formatLastSync(storage.getLastSyncTime())
    });
  },

  onSyncToggle(e) {
    var enabled = e.detail.value;
    storage.setSyncEnabled(enabled);
    this.setData({ syncEnabled: enabled });

    if (enabled) {
      // 开启同步时立即获取 openid
      var that = this;
      cloud.getOpenid().then(function (oid) {
        if (oid) {
          try {
            wx.setStorageSync('watermark_openid_cache', oid);
          } catch (e) {}
          that.setData({ openid: oid });
        }
      });
    }
  },

  onManualSync() {
    var that = this;
    this.setData({ syncing: true });
    wx.showLoading({ title: '同步中...', mask: true });

    cloud.syncFromCloud().then(function (count) {
      wx.hideLoading();
      that.setData({
        syncing: false,
        lastSyncText: that._formatLastSync(storage.getLastSyncTime())
      });
      wx.showToast({ title: '同步完成' + (count > 0 ? '，' + count + ' 条更新' : ''), icon: 'success' });
    }).catch(function (err) {
      wx.hideLoading();
      that.setData({ syncing: false });
      wx.showToast({ title: '同步失败', icon: 'none' });
      console.error('[Settings] 同步失败:', err);
    });
  },

  _formatLastSync(ts) {
    if (!ts) return '';
    var date = new Date(ts);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
      + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }
});
