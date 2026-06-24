// app.js
App({
  onLaunch() {
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
