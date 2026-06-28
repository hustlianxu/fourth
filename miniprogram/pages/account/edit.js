/**
 * 添加/编辑账户页面
 */
const { ACCOUNT_PLATFORMS } = require('../../utils/constants');

Page({
  data: {
    isEdit: false,
    accountId: '',
    form: {
      name: '',
      type: 'stock',
      platform: '',
      cash_balance: '',
      note: '',
    },
    typeIndex: 0,
    typeOptions: [],
    platformIndex: 0,
    platformOptions: [],
  },

  onLoad(options) {
    // 初始化类型选择器
    const types = ACCOUNT_PLATFORMS.map(p => p.name);
    this.setData({ typeOptions: types });

    // 如果有 id 则为编辑模式
    if (options.id) {
      this.setData({ isEdit: true, accountId: options.id });
      this.loadAccount(options.id);
    }

    // 默认选中第一个类型的平台
    this.updatePlatforms(0);
  },

  async loadAccount(id) {
    try {
      const db = wx.cloud.database();
      const res = await db.collection('accounts').doc(id).get();
      const account = res.data;
      if (!account) return;

      const typeIdx = ACCOUNT_PLATFORMS.findIndex(p => p.key === account.type);
      this.setData({
        typeIndex: Math.max(0, typeIdx),
        form: {
          name: account.name || '',
          type: account.type || 'stock',
          platform: account.platform || '',
          cash_balance: String(account.cash_balance || ''),
          note: account.note || '',
        },
      });
      this.updatePlatforms(typeIdx, account.platform);
    } catch (err) {
      console.error('[Account Edit] load error:', err);
    }
  },

  updatePlatforms(typeIndex, selectedPlatform = '') {
    const type = ACCOUNT_PLATFORMS[typeIndex];
    const platforms = type?.platforms || [];
    const opts = platforms.map(p => p.name);
    const idx = platforms.findIndex(p => p.key === selectedPlatform);
    this.setData({
      platformOptions: opts,
      platformIndex: Math.max(0, idx),
      'form.type': type?.key || 'custom',
      'form.platform': selectedPlatform || platforms[0]?.key || '',
    });
  },

  onTypeChange(e) {
    const idx = e.detail.value;
    this.setData({ typeIndex: idx });
    this.updatePlatforms(idx);
  },

  onPlatformChange(e) {
    const idx = e.detail.value;
    const type = ACCOUNT_PLATFORMS[this.data.typeIndex];
    const platforms = type?.platforms || [];
    this.setData({
      platformIndex: idx,
      'form.platform': platforms[idx]?.key || '',
    });
  },

  async onSave() {
    if (!this.data.form.name) {
      wx.showToast({ title: '请输入账户名称', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中...' });
    try {
      const db = wx.cloud.database();
      const data = {
        name: this.data.form.name,
        type: this.data.form.type,
        platform: this.data.form.platform,
        cash_balance: parseFloat(this.data.form.cash_balance) || 0,
        note: this.data.form.note,
        updated_at: db.serverDate(),
      };

      if (this.data.isEdit) {
        await db.collection('accounts').doc(this.data.accountId).update({ data });
      } else {
        await db.collection('accounts').add({
          data: {
            ...data,
            sort_order: 0,
            created_at: db.serverDate(),
          },
        });
      }

      wx.hideLoading();
      wx.showToast({ title: '保存成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 1000);
    } catch (err) {
      console.error('[Account Save] error:', err);
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  async onDelete() {
    wx.showModal({
      title: '确认删除',
      content: '删除账户会同时删除该账户下所有持仓记录，确认？',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          try {
            const db = wx.cloud.database();
            // 删除持仓
            const { data: holdings } = await db.collection('holdings')
              .where({ account_id: this.data.accountId })
              .get();
            const deleteHoldings = holdings.map(h => db.collection('holdings').doc(h._id).remove());
            await Promise.all(deleteHoldings);

            // 删除账户
            await db.collection('accounts').doc(this.data.accountId).remove();

            wx.hideLoading();
            wx.showToast({ title: '已删除', icon: 'success' });
            setTimeout(() => wx.navigateBack(), 1000);
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      },
    });
  },
});
