// pages/share/share.js
const cloud = require('../../utils/cloud.js');
const storage = require('../../utils/storage.js');

Page({
  data: {
    record: null,
    recordId: '',
    authorizedList: [],
    targetOpenid: '',
    currentPerm: 0,
    permOptions: ['只读 (read)', '只写 (write)', '读写 (readwrite)'],
    loading: true
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
    this.setData({ record: record });
    this.loadAuthorizedList();
  },

  loadAuthorizedList() {
    var that = this;
    cloud.callAuthorize = cloud.callAuthorize || cloud.authorize;
    cloud.getAuthorizedList(this.data.recordId).then(function (list) {
      that.setData({ authorizedList: list || [], loading: false });
    }).catch(function () {
      that.setData({ loading: false });
    });
  },

  onTargetInput(e) {
    this.setData({ targetOpenid: e.detail.value.trim() });
  },

  onPermChange(e) {
    this.setData({ currentPerm: parseInt(e.detail.value, 10) });
  },

  permLabel(perm) {
    var map = { read: '只读', write: '只写', readwrite: '读写' };
    return map[perm] || perm;
  },

  formatTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  },

  onAddAuthorize() {
    var openid = this.data.targetOpenid;
    if (!openid) {
      wx.showToast({ title: '请输入目标 openid', icon: 'none' });
      return;
    }

    var perm = ['read', 'write', 'readwrite'][this.data.currentPerm];
    var that = this;

    wx.showLoading({ title: '添加授权...', mask: true });
    cloud.callAuthorize(this.data.recordId, openid, perm).then(function (res) {
      wx.hideLoading();
      if (res && res.success) {
        wx.showToast({ title: '授权成功', icon: 'success' });
        that.setData({ targetOpenid: '' });
        that.loadAuthorizedList();
      } else {
        wx.showToast({ title: '授权失败: ' + ((res && res.error) || '未知错误').slice(0, 15), icon: 'none' });
      }
    }).catch(function (err) {
      wx.hideLoading();
      wx.showToast({ title: '授权失败', icon: 'none' });
      console.error('[Share] 授权失败:', err);
    });
  },

  onRevoke(e) {
    var openid = e.currentTarget.dataset.openid;
    var that = this;

    wx.showModal({
      title: '撤回授权',
      content: '确定要撤回对 ' + openid.slice(0, 15) + '... 的授权吗？',
      success: function (res) {
        if (res.confirm) {
          wx.showLoading({ title: '撤回中...', mask: true });
          cloud.callRevoke(that.data.recordId, openid).then(function (res2) {
            wx.hideLoading();
            if (res2 && res2.success) {
              wx.showToast({ title: '已撤回', icon: 'success' });
              that.loadAuthorizedList();
            } else {
              wx.showToast({ title: '撤回失败', icon: 'none' });
            }
          }).catch(function (err) {
            wx.hideLoading();
            wx.showToast({ title: '撤回失败', icon: 'none' });
            console.error('[Share] 撤回失败:', err);
          });
        }
      }
    });
  }
});
