/**
 * 持仓详情页面
 */
const { formatMoney, formatDate, formatQuantity, formatPercent, getPriceColor } = require('../../utils/format');
const { PRODUCT_TYPES } = require('../../utils/constants');

Page({
  data: {
    holding: {},
    priceColor: 'price-flat',
  },

  onLoad(options) {
    if (options.id) {
      this.loadHolding(options.id);
    }
  },

  async loadHolding(id) {
    try {
      const db = wx.cloud.database();
      const res = await db.collection('holdings').doc(id).get();
      const holding = res.data || {};
      this.setData({
        holding,
        priceColor: getPriceColor(holding.pnl),
      });
    } catch (err) {
      console.error('[Holding Detail] error:', err);
    }
  },

  onEdit() {
    wx.navigateTo({
      url: `/pages/holding/edit?id=${this.data.holding._id}`,
    });
  },

  onDelete() {
    wx.showModal({
      title: '确认删除',
      content: `删除 ${this.data.holding.product_name} 的持仓记录？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            const db = wx.cloud.database();
            await db.collection('holdings').doc(this.data.holding._id).remove();
            wx.showToast({ title: '已删除', icon: 'success' });
            setTimeout(() => wx.navigateBack(), 1000);
          } catch (err) {
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      },
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

  formatMoney, formatDate, formatQuantity, formatPercent,
});
