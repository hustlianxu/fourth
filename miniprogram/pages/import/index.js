/**
 * 批量导入持仓页面
 */
Page({
  data: {
    loading: false,
    importResult: {
      show: false,
      total: 0,
      imported: 0,
      errorCount: 0,
      errors: [],
    },
    fieldDescriptions: [
      { field: 'account', required: true, desc: '账户名称，如：华泰证券、且慢（自动创建）' },
      { field: 'product_code', required: true, desc: '产品代码，如：600036、510050' },
      { field: 'product_name', required: false, desc: '产品名称，如：招商银行（留空自动用代码）' },
      { field: 'product_type', required: false, desc: '产品类型：stock/ETF/LOF/基金_场外' },
      { field: 'exchange', required: false, desc: '交易所：SH/SZ/HK（默认SH）' },
      { field: 'shares', required: true, desc: '持有份额/股数（必填）' },
      { field: 'cost_price', required: true, desc: '成本单价（必填）' },
      { field: 'buy_date', required: false, desc: '买入日期，如：2025-01-15' },
      { field: 'note', required: false, desc: '备注（可选）' },
    ],
  },

  onDownloadTemplate() {
    const csvContent = `account,product_code,product_name,product_type,exchange,shares,cost_price,buy_date,note
华泰证券,600036,招商银行,stock,SH,1000,36.50,2025-03-01,
华泰证券,510050,上证50ETF,ETF,SH,5000,2.850,2025-06-01,
华泰证券,161720,证券LOF,LOF,SZ,2000,1.235,2025-04-15,
且慢-长盈计划,110011,易方达中小盘,基金_场外,,3000,5.123,2025-01-10,
蚂蚁基金,000001,华夏成长,基金_场外,,5000,1.500,2024-12-01,
天天基金,163415,兴全商业模式LOF,基金_场外,,2000,3.456,2025-02-20,`;

    const fs = wx.getFileSystemManager();
    const filePath = `${wx.env.USER_DATA_PATH}/import_template.csv`;
    fs.writeFileSync(filePath, csvContent, 'utf8');

    // 优先使用 saveFileToDisk (base lib >= 2.24.4)
    if (wx.saveFileToDisk) {
      wx.saveFileToDisk({
        filePath,
        success() {
          wx.showToast({ title: '模板已保存到下载目录', icon: 'success' });
        },
        fail() {
          copyToClipboard();
        },
      });
    } else {
      copyToClipboard();
    }

    function copyToClipboard() {
      wx.setClipboardData({
        data: csvContent,
        success() {
          wx.showModal({
            title: '模板已复制',
            content: 'CSV 模板内容已复制到剪贴板，请粘贴到文本编辑器保存为 .csv 文件',
            showCancel: false,
          });
        },
      });
    }
  },

  onAddSingle() {
    wx.navigateTo({ url: '/pages/holding/edit' });
  },

  onUploadFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv'],
      success: (res) => {
        const file = res.tempFiles[0];
        if (!file.name.toLowerCase().endsWith('.csv')) {
          wx.showToast({ title: '请选择 CSV 文件', icon: 'none' });
          return;
        }
        this.parseAndUpload(file.path);
      },
    });
  },

  async parseAndUpload(filePath) {
    this.setData({ loading: true });

    try {
      const fs = wx.getFileSystemManager();
      const csvData = fs.readFileSync(filePath, 'utf8');

      // 调用云函数解析
      const result = await wx.cloud.callFunction({
        name: 'parse_import',
        data: { csvData },
      });

      const res = result.result || {};
      this.setData({
        importResult: {
          show: true,
          total: res.total || 0,
          imported: res.imported || 0,
          errorCount: res.errorCount || 0,
          errors: res.errors || [],
        },
        loading: false,
      });

      if (res.imported > 0) {
        wx.showToast({
          title: `成功导入 ${res.imported} 条`,
          icon: 'success',
        });
        // 通知全局刷新
        const app = getApp();
        app.triggerRefresh();
      }
    } catch (err) {
      console.error('[Import] error:', err);
      this.setData({
        importResult: {
          show: true,
          total: 0,
          imported: 0,
          errorCount: 1,
          errors: ['文件读取失败，请重试'],
        },
        loading: false,
      });
      wx.showToast({ title: '导入失败', icon: 'none' });
    }
  },
});
