/**
 * 我的 - 设置页面
 */
const api = require('../../utils/api');
const { LLM_PROVIDERS } = require('../../utils/constants');

Page({
  data: {
    llmProviders: [],
  },

  onShow() {
    this.loadProviderStatus();
  },

  async loadProviderStatus() {
    try {
      const config = await api.getLLMConfig();
      const providers = LLM_PROVIDERS.map(p => ({
        ...p,
        configured: config?.providers?.[p.key]?.enabled && config?.providers?.[p.key]?.api_key,
      }));
      this.setData({ llmProviders: providers });
    } catch (err) {
      this.setData({
        llmProviders: LLM_PROVIDERS.map(p => ({ ...p, configured: false })),
      });
    }
  },

  onGoToAccounts() {
    wx.navigateTo({ url: '/pages/holdings/index' });
  },

  onGoToTransactions() {
    wx.navigateTo({ url: '/pages/transactions/index' });
  },

  onGoToImport() {
    wx.navigateTo({ url: '/pages/import/index' });
  },

  onGoToExport() {
    this.exportData();
  },

  async exportData() {
    wx.showLoading({ title: '导出中...' });
    try {
      const result = await api.callCloudFunction('export_data');
      if (result && result.success) {
        // 保存到本地
        const fs = wx.getFileSystemManager();
        const filePath = `${wx.env.USER_DATA_PATH}/asset_backup_${Date.now()}.json`;
        fs.writeFileSync(filePath, JSON.stringify(result.data, null, 2));
        wx.hideLoading();
        wx.showModal({
          title: '导出成功',
          content: '数据已保存到本地文件',
          success() {
            wx.openDocument({
              filePath,
              fileType: 'json',
              showMenu: true,
            });
          },
        });
      } else {
        wx.hideLoading();
        wx.showToast({ title: '导出失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '导出失败', icon: 'none' });
    }
  },

  onConfigureLLM(e) {
    const provider = e.currentTarget.dataset.provider;
    wx.navigateTo({ url: `/pages/settings/llm/index?provider=${provider}` });
  },

  onGoToLLMSettings() {
    wx.navigateTo({ url: '/pages/settings/llm/index' });
  },

  onGoToNotifySettings() {
    wx.navigateTo({ url: '/pages/settings/notify/index' });
  },

  onShowPrivacy() {
    wx.showModal({
      title: '隐私说明',
      content: '您的金融数据仅存储在微信云数据库中，采用加密传输和存储。AI 分析时调用的 API Key 经过 AES-256 加密存储，仅在云函数内存中解密。您的持仓数据不会用于任何其他目的，也不会分享给第三方。',
      showCancel: false,
    });
  },
});
