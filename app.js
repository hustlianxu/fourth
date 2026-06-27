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
  },
  globalData: {
    userInfo: null
  }
});
