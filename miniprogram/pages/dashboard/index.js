/**
 * 资产看板页面
 */
const api = require('../../utils/api');
const { formatMoney, formatPercent, formatDate, getPriceColor, getPriceArrow } = require('../../utils/format');
const { ACCOUNT_PLATFORMS } = require('../../utils/constants');

Page({
  data: {
    loading: true,
    summary: {
      totalAssets: 0,
      totalPnL: 0,
      totalPnLPercent: 0,
      todayPnL: 0,
      accounts: [],
      holdingCount: 0,
    },
    distributionList: [],
    lastUpdate: '',
    pnlColor: 'price-flat',
    pnlArrow: '→',
    todayPnlColor: 'price-flat',
  },

  onLoad() {
    // 注册全局刷新
    const app = getApp();
    app.onRefresh(() => {
      this.loadData();
    });
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    this.setData({ loading: true });
    try {
      const summary = await api.getPortfolioSummary();
      this.setData({
        summary,
        pnlColor: getPriceColor(summary.totalPnL),
        pnlArrow: getPriceArrow(summary.totalPnL),
        todayPnlColor: getPriceColor(summary.todayPnL),
        lastUpdate: wx.getStorageSync('last_price_update') || '',
        distributionList: this.buildDistribution(summary),
        loading: false,
      });

      // 更新全局数据
      const app = getApp();
      app.globalData.totalAssets = summary.totalAssets;
      app.globalData.totalPnL = summary.totalPnL;

      // 检查是否需要自动更新行情
      if (wx.getStorageSync('need_price_update')) {
        this.autoRefreshPrices();
      }
    } catch (err) {
      console.error('[Dashboard] loadData error:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  /**
   * 构建饼图分布数据
   */
  buildDistribution(summary) {
    if (!summary.accounts || summary.accounts.length === 0) return [];
    const colors = ['#6c63ff', '#1890ff', '#52c41a', '#fa8c16', '#13c2c2', '#eb2f96', '#722ed1', '#a0d911'];
    const total = summary.totalAssets || 1;
    return summary.accounts.map((acc, i) => ({
      name: acc.name,
      value: acc.total_value || 0,
      percent: ((acc.total_value || 0) / total * 100).toFixed(1),
      color: colors[i % colors.length],
    }));
  },

  /**
   * 自动刷新行情
   */
  async autoRefreshPrices() {
    try {
      wx.showLoading({ title: '更新行情中...' });
      const result = await api.refreshPrices();
      if (result && result.success) {
        wx.setStorageSync('last_price_update', formatDate(new Date(), 'MM-DD HH:mm'));
        wx.setStorageSync('need_price_update', false);
        wx.hideLoading();
        // 重新加载数据
        this.loadData();
      } else {
        wx.hideLoading();
      }
    } catch (err) {
      wx.hideLoading();
      console.error('[autoRefreshPrices] error:', err);
    }
  },

  /**
   * 手动刷新
   */
  async onRefresh() {
    wx.showLoading({ title: '刷新中...' });
    try {
      const result = await api.refreshPrices();
      if (result && result.success) {
        wx.setStorageSync('last_price_update', formatDate(new Date(), 'MM-DD HH:mm'));
        wx.setStorageSync('need_price_update', false);
        wx.showToast({ title: '刷新成功', icon: 'success' });
      } else {
        wx.showToast({ title: result?.message || '刷新失败', icon: 'none' });
      }
      this.loadData();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  /**
   * 点击账户
   */
  onAccountTap(e) {
    const account = e.currentTarget.dataset.account;
    wx.navigateTo({
      url: `/pages/account/detail?id=${account._id}`,
    });
  },

  /**
   * 添加账户
   */
  onAddAccount() {
    wx.navigateTo({ url: '/pages/account/edit' });
  },

  /**
   * 跳转 AI 分析
   */
  onGoToAI() {
    wx.switchTab({ url: '/pages/ai/index' });
  },

  /**
   * 跳转导入
   */
  onGoToImport() {
    wx.navigateTo({ url: '/pages/import/index' });
  },

  /**
   * 手动添加持仓
   */
  onAddHolding() {
    wx.navigateTo({ url: '/pages/holding/edit' });
  },

  /**
   * 获取平台中文名
   */
  platformName(platformKey) {
    for (const group of ACCOUNT_PLATFORMS) {
      if (group.platforms) {
        const found = group.platforms.find(p => p.key === platformKey);
        if (found) return found.name;
      }
      if (group.key === platformKey) return group.name;
    }
    return platformKey || '未知';
  },

  formatMoney,
  formatDate,
});
