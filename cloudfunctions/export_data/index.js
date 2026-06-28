/**
 * 数据导出云函数
 * 导出用户的全量数据（accounts + holdings）
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const [accountsRes, holdingsRes] = await Promise.all([
      db.collection('accounts').get(),
      db.collection('holdings').get(),
    ]);

    const exportData = {
      export_time: new Date().toISOString(),
      version: '1.0.0',
      accounts: accountsRes.data || [],
      holdings: holdingsRes.data || [],
      summary: {
        accountCount: (accountsRes.data || []).length,
        holdingCount: (holdingsRes.data || []).length,
        totalMarketValue: (holdingsRes.data || []).reduce((s, h) => s + (h.market_value || 0), 0),
        totalCostValue: (holdingsRes.data || []).reduce((s, h) => s + (h.cost_value || 0), 0),
      },
    };

    return {
      success: true,
      data: exportData,
    };
  } catch (err) {
    console.error('[export_data] error:', err);
    return { success: false, message: err.message };
  }
};
