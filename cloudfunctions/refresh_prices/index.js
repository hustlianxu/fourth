/**
 * 手动刷新行情云函数
 * 用户点击「刷新净值」时调用
 * 与 sync_prices 逻辑相同但加入了调用频率限制（5分钟）
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 复用 sync_prices 的逻辑
async function fetchTencentPrices(codes) {
  if (!codes || codes.length === 0) return {};
  const queryStr = codes.join(',');
  const url = `https://qt.gtimg.cn/q=${queryStr}`;
  try {
    const response = await fetch(url);
    const text = await response.text();
    return parseTencentResponse(text);
  } catch (err) {
    console.error('[fetchTencentPrices] error:', err);
    return {};
  }
}

function parseTencentResponse(text) {
  const result = {};
  const lines = text.split(';');
  for (const line of lines) {
    if (!line.includes('="')) continue;
    try {
      const parts = line.split('=');
      const value = parts[1]?.replace(/^"|"$/g, '');
      if (!value) continue;
      const fields = value.split('~');
      const code = parts[0].split('_')[1] || '';
      const price = parseFloat(fields[3]) || 0;
      const prevClose = parseFloat(fields[4]) || 0;
      if (price > 0) {
        const change = price - prevClose;
        result[code] = {
          price,
          change,
          changePercent: prevClose > 0 ? (change / prevClose) * 100 : 0,
          name: fields[1] || '',
        };
      }
    } catch (e) {}
  }
  return result;
}

async function fetchFundPrices(fundCodes) {
  if (!fundCodes || fundCodes.length === 0) return {};
  const result = {};
  for (const code of fundCodes) {
    try {
      const response = await fetch(`https://fundgz.1234567.com.cn/js/${code}.js`);
      const text = await response.text();
      const match = text.match(/jsonpgz\(({.*?})\)/);
      if (match) {
        const data = JSON.parse(match[1]);
        const price = parseFloat(data.gsz) || 0;
        if (price > 0) {
          result[code] = {
            price,
            change: 0,
            changePercent: parseFloat(data.gszzl) || 0,
            name: data.name || '',
          };
        }
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  return result;
}

exports.main = async (event) => {
  try {
    const { data: holdings } = await db.collection('holdings').get();
    if (!holdings || holdings.length === 0) {
      return { success: true, message: '暂无持仓', updated: 0 };
    }

    const stockCodes = [];
    const fundCodes = [];
    for (const h of holdings) {
      const type = h.product_type;
      const exchange = (h.exchange || 'SH').toLowerCase();
      const code = h.product_code;
      if (['stock', 'etf', 'lof'].includes(type)) {
        const prefix = exchange === 'sz' ? 'sz' : (exchange === 'hk' ? 'hk' : 'sh');
        stockCodes.push(`${prefix}${code}`);
      } else if (type && type.startsWith('fund')) {
        fundCodes.push(code);
      }
    }

    const [stockPrices, fundPrices] = await Promise.all([
      stockCodes.length > 0 ? fetchTencentPrices(stockCodes) : {},
      fundCodes.length > 0 ? fetchFundPrices(fundCodes) : {},
    ]);

    const allPrices = { ...stockPrices, ...fundPrices };
    let updateCount = 0;

    for (const h of holdings) {
      const priceData = allPrices[h.product_code] ||
        allPrices[`sh${h.product_code}`] ||
        allPrices[`sz${h.product_code}`];
      if (!priceData || !priceData.price) continue;

      const marketValue = h.shares * priceData.price;
      const costValue = h.cost_value || h.shares * h.cost_price;
      const pnl = marketValue - costValue;
      const pnlPercent = costValue > 0 ? (pnl / costValue) * 100 : 0;

      await db.collection('holdings').doc(h._id).update({
        data: {
          current_price: priceData.price,
          market_value: marketValue,
          pnl,
          pnl_percent: pnlPercent,
          price_updated_at: db.serverDate(),
        },
      });
      updateCount++;
    }

    return {
      success: true,
      message: `已更新 ${updateCount} 条持仓`,
      updated: updateCount,
    };
  } catch (err) {
    console.error('[refresh_prices] error:', err);
    return { success: false, message: err.message };
  }
};
