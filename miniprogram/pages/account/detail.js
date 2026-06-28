/**
 * 账户详情页面
 */
const api = require('../../utils/api');
const { formatMoney, formatQuantity } = require('../../utils/format');
const { ACCOUNT_PLATFORMS } = require('../../utils/constants');

Page({
  data: {
    account: {
      holdings: [],
      total_value: 0,
      pnl: 0,
      holdingCount: 0,
    },
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ 'account._id': options.id });
      this.loadAccount(options.id);
    }
  },

  onShow() {
    if (this.data.account._id) {
      this.loadAccount(this.data.account._id);
    }
  },

  async loadAccount(id) {
    try {
      const summary = await api.getPortfolioSummary();
      const account = (summary.accounts || []).find(a => a._id === id);
      if (account) {
        this.setData({ account });
      }
    } catch (err) {
      console.error('[Account Detail] error:', err);
    }
  },

  onHoldingTap(e) {
    const holding = e.currentTarget.dataset.holding;
    wx.navigateTo({
      url: `/pages/holding/detail?id=${holding._id}`,
    });
  },

  onEditAccount() {
    wx.navigateTo({
      url: `/pages/account/edit?id=${this.data.account._id}`,
    });
  },

  onAddHolding() {
    wx.navigateTo({
      url: `/pages/holding/edit?account_id=${this.data.account._id}`,
    });
  },

  platformName(platformKey) {
    for (const group of ACCOUNT_PLATFORMS) {
      if (group.platforms) {
        const found = group.platforms.find(p => p.key === platformKey);
        if (found) return found.name;
      }
    }
    return platformKey || '未知';
  },

  formatMoney,
  formatQuantity,
});
