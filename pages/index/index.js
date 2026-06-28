// pages/index/index.js
const templates = require('../../utils/templates.js');
const storage = require('../../utils/storage.js');
const cloud = require('../../utils/cloud.js');

const SWIPE_RATIO = 0.18;      // 触发滑动的距离占比（屏幕宽度的百分比）
const MAX_DRAG_RATIO = 0.28;   // 跟随手指的最大偏移占比
const NAV_DELAY = 200;         // 放手后动画时长 ms
const EDGE_WIDTH = 30;         // 右滑触发边缘宽度（px）

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
    this._screenW = wx.getSystemInfoSync().windowWidth;
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
  _directionLocked: false,
  _swipeDir: '',   // 'left' | 'right' | ''
  _screenW: 375,

  onTouchStart(e) {
    var touch = e.touches[0];
    this._touchStartX = touch.clientX;
    this._touchStartY = touch.clientY;
    this._touchStartT = Date.now();
    this._directionLocked = false;
    this._swipeDir = '';
    // 右滑必须从左侧边缘触发；左滑可从任意位置
    // 但都需要水平手势，后续在 touchmove 判断
    this.setData({
      slideTransition: 'transition: transform 0s',
      previewOpacity: 0,
      dragDir: ''
    });
  },

  onTouchMove(e) {
    if (this._directionLocked && !this._swipeDir) return; // 已锁定为垂直，忽略

    var touch = e.touches[0];
    var dx = touch.clientX - this._touchStartX;
    var dy = touch.clientY - this._touchStartY;

    // 首次移动：锁定滑动方向
    if (!this._directionLocked) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return; // 太小的移动忽略
      this._directionLocked = true;
      if (Math.abs(dy) > Math.abs(dx)) {
        // 垂直滑动 → 放弃，交给页面默认滚动
        this._swipeDir = '';
        return;
      }
      // 横向滑动：确定方向
      if (dx > 0) {
        // 右滑：必须从屏幕左侧边缘触发
        if (this._touchStartX > EDGE_WIDTH) {
          this._swipeDir = '';
          return;
        }
        this._swipeDir = 'right';
      } else {
        this._swipeDir = 'left';
      }
      return; // 锁定方向本次不处理，下次 touchmove 开始跟手
    }

    if (!this._swipeDir) return; // 已确认为垂直滑动

    // 基于屏幕宽度计算百分比偏移
    var screenW = this._screenW;
    var pct = (dx / screenW) * 100;
    // 限制范围
    var maxPct = MAX_DRAG_RATIO * 100;
    pct = Math.max(-maxPct, Math.min(maxPct, pct));

    // 预览透明度：偏移量越大越透明
    var opacity = Math.min(0.9, Math.abs(pct) / maxPct);

    this.setData({
      slideStyle: 'transform: translateX(' + pct + '%)',
      previewOpacity: opacity,
      dragDir: this._swipeDir
    });
  },

  onTouchEnd(e) {
    if (!this._directionLocked || !this._swipeDir) {
      // 没有触发横向滑动 → 复位
      this.setData({ dragDir: '', previewOpacity: 0 });
      return;
    }

    var touch = e.changedTouches[0];
    var dx = touch.clientX - this._touchStartX;
    var dt = Date.now() - this._touchStartT;
    var screenW = this._screenW;
    var thresholdPx = screenW * SWIPE_RATIO;

    // 重置预览
    this.setData({ dragDir: '', previewOpacity: 0 });

    if (Math.abs(dx) > thresholdPx && dt < 500) {
      this._doSwipe(this._swipeDir);
    } else {
      // 弹回
      this.setData({
        slideStyle: 'transform: translateX(0px)',
        slideTransition: 'transition: transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
      });
    }
  },

  _doSwipe(dir) {
    if (dir === 'right') {
      this.setData({
        slideStyle: 'transform: translateX(100%)',
        slideTransition: 'transition: transform ' + NAV_DELAY + 'ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'
      });
      setTimeout(function () {
        wx.navigateTo({ url: '/pages/list/list' });
      }, NAV_DELAY);
    } else {
      var id = this.data.selectedId;
      this.setData({
        slideStyle: 'transform: translateX(-100%)',
        slideTransition: 'transition: transform ' + NAV_DELAY + 'ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'
      });
      setTimeout(function () {
        wx.navigateTo({ url: '/pages/camera/camera?templateId=' + id });
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
