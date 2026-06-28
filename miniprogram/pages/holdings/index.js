/**
 * 持仓列表页面
 */
const api = require('../../utils/api');
const { formatMoney, formatQuantity } = require('../../utils/format');
const { PRODUCT_TYPES } = require('../../utils/constants');

Page({
  data: {
    accountList: [],
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    try {
      const summary = await api.getPortfolioSummary();
      const accounts = (summary.accounts || []).map(acc => ({
        ...acc,
        expanded: true,
      }));
      this.setData({ accountList: accounts });
    } catch (err) {
      console.error('[Holdings] load error:', err);
    }
  },

  onToggleAccount(e) {
    const id = e.currentTarget.dataset.id;
    const list = this.data.accountList.map(a => {
      if (a._id === id) return { ...a, expanded: !a.expanded };
      return a;
    });
    this.setData({ accountList: list });
  },

  onHoldingTap(e) {
    const holding = e.currentTarget.dataset.holding;
    wx.navigateTo({
      url: `/pages/holding/detail?id=${holding._id}`,
    });
  },

  tagClass(type) {
    const t = PRODUCT_TYPES[type?.toUpperCase()];
    return t?.tag || 'tag-stock';
  },

  productTypeName(type) {
    const t = PRODUCT_TYPES[type?.toUpperCase()];
    return t?.name || type || '股票';
  },

  formatMoney,
  formatQuantity,
});
