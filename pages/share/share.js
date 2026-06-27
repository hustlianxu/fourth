// pages/share/share.js
const cloud = require('../../utils/cloud.js');
const storage = require('../../utils/storage.js');

Page({
  data: {
    record: null,
    recordId: '',
    authorizedList: [],
    targetOpenids: '',
    targetCount: 0,
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
    cloud.getAuthorizedList(this.data.recordId).then(function (list) {
      that.setData({ authorizedList: list || [], loading: false });
    }).catch(function () {
      that.setData({ loading: false });
    });
  },

  onTargetInput(e) {
    var raw = e.detail.value || '';
    var lines = raw.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
    this.setData({ targetOpenids: raw, targetCount: lines.length });
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
    var raw = this.data.targetOpenids || '';
    var openids = raw.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
    if (openids.length === 0) {
      wx.showToast({ title: '请输入目标 openid', icon: 'none' });
      return;
    }

    var perm = ['read', 'write', 'readwrite'][this.data.currentPerm];
    var that = this;

    wx.showLoading({ title: '授权中...', mask: true });

    // 逐人授权
    var tasks = openids.map(function (oid) {
      return cloud.callAuthorize(that.data.recordId, oid, perm).then(function (res) {
        return { openid: oid, success: res && res.success, error: (res && res.error) || '' };
      });
    });

    Promise.all(tasks).then(function (results) {
      wx.hideLoading();
      var ok = results.filter(function (r) { return r.success; }).length;
      var fail = results.filter(function (r) { return !r.success; }).length;
      wx.showToast({ title: '授权完成: ' + ok + '成功' + (fail ? ', ' + fail + '失败' : ''), icon: fail > 0 ? 'none' : 'success', duration: 2500 });
      that.setData({ targetOpenids: '', targetCount: 0 });
      that.loadAuthorizedList();
    }).catch(function (err) {
      wx.hideLoading();
      wx.showToast({ title: '授权失败', icon: 'none' });
      console.error('[Share] 批量授权失败:', err);
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
  },

  onShareAppMessage() {
    var record = this.data.record;
    return {
      title: '水印相机 · ' + (record ? (record.customName || record.templateName) : '分享照片'),
      path: '/pages/detail/detail?id=' + this.data.recordId,
      imageUrl: record ? record.imagePath : ''
    };
  }
});
