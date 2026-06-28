// pages/index/index.js
const templates = require('../../utils/templates.js');
const storage = require('../../utils/storage.js');
const cloud = require('../../utils/cloud.js');

const SWIPE_THRESHOLD = 60;   // 触发滑动的最小 px
const MAX_DRAG = 150;          // 跟随手指的最大偏移 px

Page({
  data: {
    templates: [],
    selectedId: 'minimal',
    total: 0,
    autoSaveAlbum: false,
    syncEnabled: false,
    configSyncEnabled: false,
    recentRecords: [],
    // 滑动偏移
    slideStyle: '',
    slideTransition: 'transition: transform 0s',
    // 面板状态：初始在屏幕外，由 CSS 控制
    listPanelStyle: 'transform: translateX(-100%)',
    cameraPanelStyle: 'transform: translateX(100%)',
    panelTransition: 'transition: transform 0.25s ease-out'
  },

  onLoad() {
    this.loadTemplates();
    this._loadData();
  },

  _loadData() {
    var list = storage.getAll();
    var recent = list.slice(0, 10);
    this.setData({
      total: list.length,
      recentRecords: recent.map(function (r) {
        return {
          id: r.id,
          imagePath: r.imagePath,
          customName: r.customName,
          templateName: r.templateName,
          timeText: r.timeText || ''
        };
      }),
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
    // ... unchanged from before
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

  // ===== 滑动手势 =====
  _touchStartX: 0,
  _touchStartY: 0,
  _touchStartT: 0,
  _swipeConsumed: false,

  onTouchStart(e) {
    this._touchStartX = e.touches[0].clientX;
    this._touchStartY = e.touches[0].clientY;
    this._touchStartT = Date.now();
    this._swipeConsumed = false;
    this.setData({
      slideTransition: 'transition: transform 0s'
    });
  },

  onTouchMove(e) {
    if (this._swipeConsumed) return;
    var dx = e.touches[0].clientX - this._touchStartX;
    var dy = e.touches[0].clientY - this._touchStartY;

    // 过滤垂直滑动为主的情况
    if (Math.abs(dx) < Math.abs(dy) || Math.abs(dx) < 10) return;

    // 限制最大偏移
    var tx = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, dx));

    this.setData({
      slideStyle: 'transform: translateX(' + tx + 'px)'
    });
  },

  onTouchEnd(e) {
    if (this._swipeConsumed) return;
    var dx = e.changedTouches[0].clientX - this._touchStartX;
    var dy = e.changedTouches[0].clientY - this._touchStartY;
    var dt = Date.now() - this._touchStartT;

    // 判断是否为有效滑动
    if (Math.abs(dx) > SWIPE_THRESHOLD && dt < 500 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      this._swipeConsumed = true;
      if (dx > 0) {
        this._showListPanel();
      } else {
        this._showCameraPanel();
      }
    } else {
      // 弹回
      this.setData({
        slideStyle: 'transform: translateX(0px)',
        slideTransition: 'transition: transform 0.2s ease-out'
      });
    }
  },

  // ===== 面板控制 =====
  _showListPanel() {
    // 刷新数据
    var list = storage.getAll();
    var recent = list.slice(0, 10);
    this.setData({
      total: list.length,
      recentRecords: recent.map(function (r) {
        return {
          id: r.id,
          imagePath: r.imagePath,
          customName: r.customName,
          templateName: r.templateName,
          timeText: r.timeText || ''
        };
      }),
      // 预览"手指推动"的动画：首页向右80%，列表面板从左侧滑入
      slideStyle: 'transform: translateX(80%)',
      slideTransition: 'transition: transform 0.25s ease-out',
      listPanelStyle: 'transform: translateX(0)',
      panelTransition: 'transition: transform 0.25s ease-out'
    });
  },

  _showCameraPanel() {
    this.setData({
      slideStyle: 'transform: translateX(-80%)',
      slideTransition: 'transition: transform 0.25s ease-out',
      cameraPanelStyle: 'transform: translateX(0)',
      panelTransition: 'transition: transform 0.25s ease-out'
    });
  },

  hideListPanel() {
    this.setData({
      listPanelStyle: 'transform: translateX(-100%)',
      panelTransition: 'transition: transform 0.25s ease-out',
      slideStyle: '',
      slideTransition: 'transition: transform 0.25s ease-out'
    });
  },

  hideCameraPanel() {
    this.setData({
      cameraPanelStyle: 'transform: translateX(100%)',
      panelTransition: 'transition: transform 0.25s ease-out',
      slideStyle: '',
      slideTransition: 'transition: transform 0.25s ease-out'
    });
  },

  goDetail(e) {
    var id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
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
    // 回到首页时重置所有状态
    this.setData({
      slideStyle: '',
      slideTransition: 'transition: transform 0s',
      listPanelStyle: 'transform: translateX(-100%)',
      cameraPanelStyle: 'transform: translateX(100%)',
      panelTransition: 'transition: transform 0s'
    });
    this._loadData();
    this.loadTemplates();
  }
});
