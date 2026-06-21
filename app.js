// app.js
App({
  onLaunch() {
    // 初始化全局数据与版本信息
    const sysInfo = wx.getSystemInfoSync();
    this.globalData.systemInfo = sysInfo;
    // 初始化本地存储结构
    try {
      const records = wx.getStorageSync('watermark_photos');
      if (!Array.isArray(records)) {
        wx.setStorageSync('watermark_photos', []);
      }
    } catch (e) {
      wx.setStorageSync('watermark_photos', []);
    }
  },
  globalData: {
    systemInfo: null,
    userInfo: null
  }
});
