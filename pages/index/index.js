// pages/index/index.js
const templates = require('../../utils/templates.js');
const storage = require('../../utils/storage.js');
const cloud = require('../../utils/cloud.js');

Page({
  data: {
    templates: [],
    selectedId: 'minimal',
    total: 0,
    autoSaveAlbum: false,
    syncEnabled: false,
    configSyncEnabled: false
  },

  onLoad() {
    this.loadTemplates();
    this.setData({
      autoSaveAlbum: storage.getAutoSaveAlbum(),
      syncEnabled: storage.getSyncEnabled(),
      configSyncEnabled: storage.getConfigSyncEnabled()
    });
  },

  onToggleAutoAlbum(e) {
    const enabled = e.detail.value;
    storage.setAutoSaveAlbum(enabled);
    this.setData({ autoSaveAlbum: enabled });
    if (cloud.getConfigSyncEnabled()) {
      cloud.getOpenid().then(function (oid) {
        if (oid) cloud.pushConfigChanges(oid);
      });
    }
    if (enabled) {
      wx.showToast({ title: '已开启自动保存相册', icon: 'success' });
    } else {
      wx.showToast({ title: '已关闭', icon: 'none' });
    }
  },

  onToggleSync(e) {
    const enabled = e.detail.value;
    storage.setSyncEnabled(enabled);
    this.setData({ syncEnabled: enabled });
    if (enabled) {
      cloud.getOpenid().then(function (oid) {
        if (oid) try { wx.setStorageSync('watermark_openid_cache', oid); } catch (e) {}
      });
      wx.showToast({ title: '已开启照片同步', icon: 'success' });
    } else {
      wx.showToast({ title: '已关闭照片同步', icon: 'none' });
    }
  },

  onToggleConfigSync(e) {
    const enabled = e.detail.value;
    storage.setConfigSyncEnabled(enabled);
    this.setData({ configSyncEnabled: enabled });
    if (enabled) {
      var oid = cloud._getCachedOpenid();
      if (oid) {
        cloud.syncConfig(oid);
      } else {
        cloud.getOpenid().then(function (oid2) {
          if (oid2) {
            try { wx.setStorageSync('watermark_openid_cache', oid2); } catch (e) {}
            cloud.syncConfig(oid2);
          }
        });
      }
      wx.showToast({ title: '已开启配置同步', icon: 'success' });
    } else {
      wx.showToast({ title: '已关闭配置同步', icon: 'none' });
    }
  },

  loadTemplates() {
    const builtIn = templates.TEMPLATES;
    const custom = storage.getCustomTemplates() || [];
    this.setData({
      templates: [...custom, ...builtIn]
    });
  },

  onSelectTemplate(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ selectedId: id });
  },

  // ===== 左右滑动手势 =====
  _touchStartX: 0,
  _touchStartY: 0,
  _touchStartT: 0,

  onTouchStart(e) {
    this._touchStartX = e.touches[0].clientX;
    this._touchStartY = e.touches[0].clientY;
    this._touchStartT = Date.now();
  },

  onTouchEnd(e) {
    const dx = e.changedTouches[0].clientX - this._touchStartX;
    const dy = e.changedTouches[0].clientY - this._touchStartY;
    const dt = Date.now() - this._touchStartT;
    // 阈值：水平滑动 > 60px、手势快于 500ms、水平幅度大于垂直幅度
    if (Math.abs(dx) > 60 && dt < 500 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0) {
        // 右滑 → 我的记录
        wx.navigateTo({ url: '/pages/list/list' });
      } else {
        // 左滑 → 拍照
        const id = this.data.selectedId;
        wx.navigateTo({ url: '/pages/camera/camera?templateId=' + id });
      }
    }
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

  goTemplate() {
    wx.navigateTo({
      url: '/pages/template/template'
    });
  },

  goAbout() {
    wx.showModal({
      title: '关于水印相机',
      content: '基于微信小程序原生实现：可选水印模板，据实填写数据；生成带水印的照片并与字段关联保存。可扩展至微信云开发，支持云端 OCR 核验。',
      showCancel: false
    });
  },

  onShow() {
    const list = storage.getAll();
    this.setData({
      total: list.length,
      autoSaveAlbum: storage.getAutoSaveAlbum(),
      syncEnabled: storage.getSyncEnabled(),
      configSyncEnabled: storage.getConfigSyncEnabled()
    });
    this.loadTemplates();
  }
});
