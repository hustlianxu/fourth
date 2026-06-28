/**
 * 推送通知设置页面
 */
Page({
  data: {
    morningNews: true,
    eveningNews: true,
    priceAlert: false,
    alertThreshold: '3',
  },

  onLoad() {
    this.loadSettings();
  },

  loadSettings() {
    try {
      const settings = wx.getStorageSync('notify_settings');
      if (settings) {
        this.setData({
          morningNews: settings.morningNews !== false,
          eveningNews: settings.eveningNews !== false,
          priceAlert: settings.priceAlert || false,
          alertThreshold: settings.alertThreshold || '3',
        });
      }
    } catch (err) {
      console.error('[Notify] load error:', err);
    }
  },

  onToggleMorning() {
    this.setData({ morningNews: !this.data.morningNews });
  },

  onToggleEvening() {
    this.setData({ eveningNews: !this.data.eveningNews });
  },

  onToggleAlert() {
    this.setData({ priceAlert: !this.data.priceAlert });
  },

  onSave() {
    try {
      wx.setStorageSync('notify_settings', {
        morningNews: this.data.morningNews,
        eveningNews: this.data.eveningNews,
        priceAlert: this.data.priceAlert,
        alertThreshold: this.data.alertThreshold,
      });

      // 请求订阅消息权限
      if (this.data.morningNews || this.data.eveningNews) {
        wx.requestSubscribeMessage({
          tmplIds: ['your-template-id'], // 替换为您的模板 ID
          success(res) {
            console.log('[SubscribeMessage] success:', res);
          },
          fail(err) {
            console.log('[SubscribeMessage] fail:', err);
          },
        });
      }

      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },
});
