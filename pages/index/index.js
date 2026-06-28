// pages/index/index.js
const templates = require('../../utils/templates.js');
const storage = require('../../utils/storage.js');
const cloud = require('../../utils/cloud.js');

const SWIPE_THRESHOLD = 60;   // 触发滑动的最小 px
const MAX_DRAG = 150;          // 跟随手指的最大偏移 px
const NAV_DELAY = 200;         // 放手后动画时长 ms

Page({
  data: {
    templates: [],
    selectedId: 'minimal',
    total: 0,
    autoSaveAlbum: false,
    syncEnabled: false,
    configSyncEnabled: false,
    // 滑动状态
    slideStyle: '',
    slideTransition: 'transition: transform 0s',
    previewOpacity: 0,
    dragDir: ''   // 'left' | 'right' | ''
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

  // ===== 左右滑动手势（实时跟随手指） =====
  _touchStartX: 0,
  _touchStartY: 0,
  _touchStartT: 0,

  onTouchStart(e) {
    this._touchStartX = e.touches[0].clientX;
    this._touchStartY = e.touches[0].clientY;
    this._touchStartT = Date.now();
    this.setData({
      slideTransition: 'transition: transform 0s',
      previewOpacity: 0,
      dragDir: ''
    });
  },

  onTouchMove(e) {
    var dx = e.touches[0].clientX - this._touchStartX;
    var dy = e.touches[0].clientY - this._touchStartY;

    // 过滤垂直滑动为主的情况
    if (Math.abs(dx) < Math.abs(dy)) return;
    // 太小不响应
    if (Math.abs(dx) < 10) return;

    // 限制最大偏移
    var tx = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, dx));

    // 计算预览层透明度（0~1 线性映射到 0~MAX_DRAG）
    var opacity = Math.min(1, Math.abs(tx) / MAX_DRAG);

    this.setData({
      slideStyle: 'transform: translateX(' + tx + 'px)',
      previewOpacity: opacity,
      dragDir: tx > 0 ? 'right' : 'left'
    });
  },

  onTouchEnd(e) {
    var dx = e.changedTouches[0].clientX - this._touchStartX;
    var dy = e.changedTouches[0].clientY - this._touchStartY;
    var dt = Date.now() - this._touchStartT;

    // 重置预览
    this.setData({ dragDir: '', previewOpacity: 0 });

    // 判断是否为有效滑动：距离 > 阈值、时间 < 500ms、水平为主
    if (Math.abs(dx) > SWIPE_THRESHOLD && dt < 500 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      this._doSwipe(dx);
    } else {
      // 无效滑动 → 弹回
      this.setData({
        slideStyle: 'transform: translateX(0px)',
        slideTransition: 'transition: transform ' + NAV_DELAY + 'ms ease-out'
      });
    }
  },

  _doSwipe(dx) {
    if (dx > 0) {
      // 右滑 → 首页向右滑出，列表页从左侧推入
      this.setData({
        slideStyle: 'transform: translateX(100%)',
        slideTransition: 'transition: transform ' + NAV_DELAY + 'ms ease-out'
      });
      setTimeout(function () {
        wx.navigateTo({ url: '/pages/list/list', routeType: 'none' });
      }, NAV_DELAY);
    } else {
      // 左滑 → 首页向左滑出，拍照页从右侧推入
      this.setData({
        slideStyle: 'transform: translateX(-100%)',
        slideTransition: 'transition: transform ' + NAV_DELAY + 'ms ease-out'
      });
      var id = this.data.selectedId;
      setTimeout(function () {
        wx.navigateTo({ url: '/pages/camera/camera?templateId=' + id, routeType: 'none' });
      }, NAV_DELAY);
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
    // 回到首页时清除滑动偏移
    this.setData({
      slideStyle: '',
      slideTransition: 'transition: transform 0s',
      previewOpacity: 0,
      dragDir: ''
    });
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
