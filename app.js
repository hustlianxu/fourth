// app.js
App({
  onLaunch() {
    // 初始化云开发环境
    try {
      wx.cloud.init({
        env: 'cloud1-d9g0g4pm6b7648e8d',
        traceUser: true
      });
      console.log('[App] 云开发环境已初始化');
    } catch (e) {
      console.warn('[App] 云开发初始化失败（非云开发环境可忽略）:', e);
    }

    // 初始化本地存储结构
    try {
      const records = wx.getStorageSync('watermark_photos');
      if (!Array.isArray(records)) {
        wx.setStorageSync('watermark_photos', []);
      }
    } catch (e) {
      wx.setStorageSync('watermark_photos', []);
    }
    try {
      const folders = wx.getStorageSync('watermark_folders');
      if (!Array.isArray(folders)) {
        wx.setStorageSync('watermark_folders', []);
      }
    } catch (e) {
      wx.setStorageSync('watermark_folders', []);
    }

    // 注册翻译引擎配置变更回调（用于配置同步）
    try {
      var translator = require('/utils/translator.js');
      var cloud = require('/utils/cloud.js');
      translator.setOnConfigChange(function () {
        if (cloud.getConfigSyncEnabled()) {
          var oid = cloud._getCachedOpenid();
          if (oid) cloud.pushConfigChanges(oid);
        }
      });
    } catch (e) {
      console.warn('[App] 注册配置变更回调失败:', e);
    }

    // 清理超过30天的回收站记录
    try {
      var storage = require('/utils/storage.js');
      var cleaned = storage.cleanupTrash(30);
      if (cleaned > 0) {
        console.log('[App] 回收站清理完成，删除了', cleaned, '条过期记录');
      }
    } catch (e) {
      console.warn('[App] 回收站清理失败:', e);
    }
  },
  globalData: {
    userInfo: null
  }
});
