// pages/list/list.js
const storage = require('../../utils/storage.js');
const templates = require('../../utils/templates.js');
const exporter = require('../../utils/exporter.js');

Page({
  data: {
    list: [],
    exportMode: false,
    selectedCount: 0
  },

  onShow() {
    this._loadList();
  },

  _loadList() {
    const raw = storage.getAll();
    const list = raw.map((item) => {
      const date = new Date(item.createdAt);
      return Object.assign({}, item, {
        timeText: templates.formatDateTime(date),
        summary: this._buildSummary(item),
        _checked: false
      });
    });
    this.setData({ list, exportMode: false, selectedCount: 0 });
  },

  _buildSummary(item) {
    if (!item.values) return '';
    return Object.keys(item.values).slice(0, 3).map((k) => {
      return k + ': ' + (item.values[k] || '');
    }).join(' · ');
  },

  goDetail(e) {
    if (this.data.exportMode) return;
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },

  goCamera() {
    wx.navigateTo({ url: '/pages/camera/camera' });
  },

  // === 导出模式 ===

  toggleExportMode() {
    if (this.data.list.length === 0) return;
    const entering = !this.data.exportMode;
    // 进入导出模式时重置所有勾选，离开时也重置
    const list = this.data.list.map(item => {
      item._checked = false;
      return item;
    });
    this.setData({ exportMode: entering, list, selectedCount: 0 });
  },

  toggleSelect(e) {
    const id = e.currentTarget.dataset.id;
    let count = 0;
    const list = this.data.list.map(item => {
      if (item.id === id) {
        item._checked = !item._checked;
      }
      if (item._checked) count++;
      return item;
    });
    this.setData({ list, selectedCount: count });
  },

  selectAll() {
    const list = this.data.list.map(item => {
      item._checked = true;
      return item;
    });
    this.setData({ list, selectedCount: list.length });
  },

  deselectAll() {
    const list = this.data.list.map(item => {
      item._checked = false;
      return item;
    });
    this.setData({ list, selectedCount: 0 });
  },

  async doExport() {
    const selected = this.data.list.filter(item => item._checked);
    if (selected.length === 0) {
      wx.showToast({ title: '请先选择记录', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '正在生成...', mask: true });

    try {
      await exporter.exportToExcel(selected);

      wx.hideLoading();
      wx.showToast({ title: '导出完成', icon: 'success' });

      // 退出导出模式
      const list = this.data.list.map(item => {
        item._checked = false;
        return item;
      });
      this.setData({ exportMode: false, list, selectedCount: 0 });
    } catch (e) {
      wx.hideLoading();
      console.error('[List] 导出失败:', e);
      wx.showToast({ title: '导出失败: ' + (e.message || '').slice(0, 15), icon: 'none' });
    }
  },

  onClear() {
    if (this.data.list.length === 0) return;
    wx.showModal({
      title: '清空确认',
      content: '将删除本地所有记录（仅删除数据库记录，已保存到相册的照片不受影响）。',
      success: (res) => {
        if (res.confirm) {
          storage.clearAll();
          this._loadList();
        }
      }
    });
  }
});
