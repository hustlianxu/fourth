/**
 * apply_transaction
 * 将一笔交易应用到对应持仓（加权平均成本法），幂等。
 *
 * 入参：
 *   { transaction_id }  按已存在的交易记录应用
 *
 * 算法（与同花顺口径对齐）：
 *   买入：buyCost = N*P + fee；newCostValue = oldCostValue + buyCost；newCost = newCostValue / newShares
 *        total_fee += buy_fee
 *   卖出：newShares = S - N；cost_price 不变；归零则 is_cleared=true
 *        realized_pnl += (sell_price - cost_price) * sell_shares - sell_fee
 *        total_fee += sell_fee
 *   打新中签(ipo_win)：会计处理同买入，并额外扣减账户 cash_balance（中签缴款由券商自动扣收）
 *   红股入账(stock_dividend)：shares += bonus；cost_value 不变；cost_price = cost_value / new_shares 摊薄
 *   拆分/合并(split)：shares × ratio；cost_price ÷ ratio；cost_value 不变
 *   纳税(tax)：扣减账户 cash_balance；若带 product_code 则 realized_pnl -= amount
 *   分红/利息：不影响份额；找对应持仓累加 total_dividend += amount
 *   银证转入/转出/手续费：联动账户 cash_balance，不影响持仓
 *
 * 总收益（同花顺口径）：
 *   total_pnl = 浮动盈亏(market_value - cost_value) + realized_pnl + total_dividend
 *   （手续费已计入 cost_value[买入] 与 realized_pnl[卖出]，不重复扣减）
 *
 * 幂等：transaction 带 applied_holding 标记，已应用则跳过。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * 重算 total_pnl（在份额/成本/已实现/分红/手续费变化后调用）
 */
function recomputeTotalPnl(holding, marketValue, costValue) {
  const mv = Number(marketValue) || 0;
  const cv = Number(costValue) || 0;
  const realized = Number(holding.realized_pnl) || 0;
  const dividend = Number(holding.total_dividend) || 0;
  const fee = Number(holding.total_fee) || 0;
  return Number((mv - cv + realized + dividend).toFixed(2));
}

/**
 * 读取持仓 cost_value（null/undefined/NaN 时回退到 shares × cost_price）
 */
function readCostValue(h) {
  return (h.cost_value !== null && h.cost_value !== undefined && !isNaN(h.cost_value))
    ? Number(h.cost_value)
    : (Number(h.shares) || 0) * (Number(h.cost_price) || 0);
}

/**
 * 调整账户现金余额（transfer_in/transfer_out/fee/tax 联动）
 * @param {string} account_id
 * @param {string} openid - 调用者 openid，用于归属校验（为空则放行，如定时任务）
 * @param {number} delta - 增减额（正=入账，负=出账）
 */
async function adjustAccountCash(account_id, openid, delta) {
  try {
    const accRes = await db.collection('accounts').doc(account_id).get();
    const account = accRes.data;
    if (!account) return;
    if (openid && account._openid && account._openid !== openid) return;
    const oldBalance = Number(account.cash_balance) || 0;
    const newBalance = Number((oldBalance + delta).toFixed(2));
    await db.collection('accounts').doc(account_id).update({
      data: { cash_balance: newBalance, updated_at: db.serverDate() },
    });
  } catch (err) {
    console.warn('[adjustAccountCash] error:', err);
  }
}

exports.main = async (event) => {
  const { transaction_id } = event;
  if (!transaction_id) {
    return { success: false, message: '缺少 transaction_id' };
  }

  try {
    // 当前调用者 openid（用于新建持仓归属 + 查询隔离）
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID || '';

    // 1. 读取交易
    const txnRes = await db.collection('transactions').doc(transaction_id).get();
    const txn = txnRes.data;
    if (!txn) {
      return { success: false, message: '交易记录不存在' };
    }

    // 幂等：已应用则直接返回
    if (txn.applied_holding) {
      return { success: true, message: '已应用过，跳过', skipped: true };
    }

    // 归属人优先取交易记录上的 _openid，回退当前调用者
    const ownerOpenid = txn._openid || openid;

    const type = txn.type;
    const fee = Number(txn.fee) || 0;
    const amount = Number(txn.amount) || 0;

    // 2. 分红/利息：找对应持仓累加 total_dividend（不影响份额）
    if (type === 'dividend' || type === 'interest') {
      if (!txn.account_id || !txn.product_code) {
        await db.collection('transactions').doc(transaction_id).update({
          data: { applied_holding: true, applied_at: db.serverDate() },
        });
        return { success: true, message: '分红/利息缺账户或代码，仅记录', skipped: true };
      }
      const existRes = await db.collection('holdings').where({
        _openid: ownerOpenid,
        account_id: txn.account_id,
        product_code: txn.product_code,
      }).limit(1).get();
      const existing = existRes.data[0];
      if (!existing) {
        await db.collection('transactions').doc(transaction_id).update({
          data: { applied_holding: true, applied_at: db.serverDate() },
        });
        return { success: true, message: '无对应持仓，分红/利息仅记录', warning: true };
      }
      const oldDividend = Number(existing.total_dividend) || 0;
      const newDividend = oldDividend + amount;
      const mv = Number(existing.market_value) || 0;
      const cv = Number(existing.cost_value) || 0;
      const newTotalPnl = recomputeTotalPnl(
        { ...existing, total_dividend: newDividend },
        mv, cv
      );
      await db.collection('holdings').doc(existing._id).update({
        data: {
          total_dividend: Number(newDividend.toFixed(2)),
          total_pnl: newTotalPnl,
          updated_at: db.serverDate(),
        },
      });
      await db.collection('transactions').doc(transaction_id).update({
        data: { applied_holding: true, applied_at: db.serverDate() },
      });
      return { success: true, message: '已应用分红/利息' };
    }

    // 3. 红股入账（送股）：份额增加，总成本不变，成本价摊薄；无现金流
    if (type === 'stock_dividend') {
      if (!txn.account_id || !txn.product_code) {
        return { success: false, message: '红股入账缺少 account_id 或 product_code' };
      }
      const existRes = await db.collection('holdings').where({
        _openid: ownerOpenid,
        account_id: txn.account_id,
        product_code: txn.product_code,
      }).limit(1).get();
      const existing = existRes.data[0];
      if (!existing) {
        await db.collection('transactions').doc(transaction_id).update({
          data: { applied_holding: true, applied_at: db.serverDate() },
        });
        return { success: true, message: '无对应持仓，红股入账仅记录', warning: true };
      }
      const bonusShares = Number(txn.shares) || 0;
      if (bonusShares <= 0) {
        return { success: false, message: '红股入账份额无效' };
      }
      const oldShares = Number(existing.shares) || 0;
      const newShares = oldShares + bonusShares;
      const costValue = readCostValue(existing);
      const newCost = newShares > 0 ? costValue / newShares : Number(existing.cost_price) || 0;
      const curPrice = Number(existing.current_price) || 0;
      const newMarketValue = Number((newShares * curPrice).toFixed(2));
      const newPnl = Number((newMarketValue - costValue).toFixed(2));
      const newPnlPercent = costValue > 0 ? Number(((newPnl / costValue) * 100).toFixed(2)) : 0;
      const newTotalPnl = recomputeTotalPnl(existing, newMarketValue, costValue);
      await db.collection('holdings').doc(existing._id).update({
        data: {
          shares: newShares,
          cost_price: Number(newCost.toFixed(4)),
          cost_value: Number(costValue.toFixed(2)),
          market_value: newMarketValue,
          pnl: newPnl,
          pnl_percent: newPnlPercent,
          total_pnl: newTotalPnl,
          is_cleared: false,
          updated_at: db.serverDate(),
        },
      });
      await db.collection('transactions').doc(transaction_id).update({
        data: { applied_holding: true, applied_at: db.serverDate() },
      });
      return { success: true, message: '已应用红股入账' };
    }

    // 4. 份额拆分/合并：按 ratio 调整份额与成本价，总成本与总资产不变；无现金流
    //    ratio > 1 为拆分（如 3 = 1拆3），0 < ratio < 1 为合并（如 0.333 = 3合1）
    if (type === 'split') {
      if (!txn.account_id || !txn.product_code) {
        return { success: false, message: '拆分/合并缺少 account_id 或 product_code' };
      }
      const existRes = await db.collection('holdings').where({
        _openid: ownerOpenid,
        account_id: txn.account_id,
        product_code: txn.product_code,
      }).limit(1).get();
      const existing = existRes.data[0];
      if (!existing) {
        await db.collection('transactions').doc(transaction_id).update({
          data: { applied_holding: true, applied_at: db.serverDate() },
        });
        return { success: true, message: '无对应持仓，拆分/合并仅记录', warning: true };
      }
      const ratio = Number(txn.ratio) || 0;
      if (ratio <= 0) {
        return { success: false, message: '拆分/合并比例无效（ratio 需 >0，如 3=1拆3，0.333=3合1）' };
      }
      const oldShares = Number(existing.shares) || 0;
      const newShares = Number((oldShares * ratio).toFixed(4));
      const costValue = readCostValue(existing);
      const oldCost = Number(existing.cost_price) || 0;
      const newCost = oldCost / ratio;
      const curPrice = Number(existing.current_price) || 0;
      const newMarketValue = Number((newShares * curPrice).toFixed(2));
      const newPnl = Number((newMarketValue - costValue).toFixed(2));
      const newPnlPercent = costValue > 0 ? Number(((newPnl / costValue) * 100).toFixed(2)) : 0;
      const newTotalPnl = recomputeTotalPnl(existing, newMarketValue, costValue);
      await db.collection('holdings').doc(existing._id).update({
        data: {
          shares: newShares,
          cost_price: Number(newCost.toFixed(4)),
          cost_value: Number(costValue.toFixed(2)),
          market_value: newMarketValue,
          pnl: newPnl,
          pnl_percent: newPnlPercent,
          total_pnl: newTotalPnl,
          updated_at: db.serverDate(),
        },
      });
      await db.collection('transactions').doc(transaction_id).update({
        data: { applied_holding: true, applied_at: db.serverDate() },
      });
      return { success: true, message: '已应用拆分/合并' };
    }

    // 5. 纳税：扣减账户现金余额；若带 product_code 且有对应持仓，同时计入已实现盈亏扣减
    //    （限售股个税、红利税等：从券商对账单抄入已扣缴税额）
    if (type === 'tax') {
      if (!txn.account_id) {
        return { success: false, message: '纳税缺少 account_id' };
      }
      await adjustAccountCash(txn.account_id, ownerOpenid, -amount);
      if (txn.product_code) {
        const existRes = await db.collection('holdings').where({
          _openid: ownerOpenid,
          account_id: txn.account_id,
          product_code: txn.product_code,
        }).limit(1).get();
        const existing = existRes.data[0];
        if (existing) {
          const oldRealized = Number(existing.realized_pnl) || 0;
          const newRealized = Number((oldRealized - amount).toFixed(2));
          const mv = Number(existing.market_value) || 0;
          const cv = readCostValue(existing);
          const newTotalPnl = recomputeTotalPnl(
            Object.assign({}, existing, { realized_pnl: newRealized }), mv, cv
          );
          await db.collection('holdings').doc(existing._id).update({
            data: {
              realized_pnl: newRealized,
              total_pnl: newTotalPnl,
              updated_at: db.serverDate(),
            },
          });
        }
      }
      await db.collection('transactions').doc(transaction_id).update({
        data: { applied_holding: true, applied_at: db.serverDate() },
      });
      return { success: true, message: '已应用纳税' };
    }

    // 6. 转入/转出/手续费：仅联动账户现金余额，不影响持仓
    if (type === 'transfer_in' || type === 'transfer_out' || type === 'fee') {
      if (!txn.account_id) {
        return { success: false, message: `${type} 缺少 account_id` };
      }
      const delta = type === 'transfer_in' ? amount : -amount;
      await adjustAccountCash(txn.account_id, ownerOpenid, delta);
      await db.collection('transactions').doc(transaction_id).update({
        data: { applied_holding: true, applied_at: db.serverDate() },
      });
      const nameMap = { transfer_in: '转入', transfer_out: '转出', fee: '手续费' };
      return { success: true, message: `已应用${nameMap[type]}` };
    }

    // 7. 其他未知类型（非买卖/打新中签且未命中上述分支）：仅记录
    if (type !== 'buy' && type !== 'sell' && type !== 'ipo_win') {
      await db.collection('transactions').doc(transaction_id).update({
        data: { applied_holding: true, applied_at: db.serverDate() },
      });
      return { success: true, message: '非买卖交易，仅记录', skipped: true };
    }

    if (!txn.account_id || !txn.product_code) {
      return { success: false, message: '交易缺少 account_id 或 product_code' };
    }

    const shares = Number(txn.shares) || 0;
    const price = Number(txn.price) || 0;
    if (shares <= 0) {
      return { success: false, message: '交易份额无效' };
    }

    // 4. 查询对应持仓（_openid + account_id + product_code）
    const existRes = await db.collection('holdings').where({
      _openid: ownerOpenid,
      account_id: txn.account_id,
      product_code: txn.product_code,
    }).limit(1).get();

    const existing = existRes.data[0];
    let resultHolding;

    if (type === 'buy' || type === 'ipo_win') {
      // 买入成本 = 份额 × 单价 + 手续费（同花顺口径）
      // 打新中签 ipo_win 会计处理等同 buy（加权平均成本），并额外扣减账户现金余额
      //   （中签缴款由券商从资金账户自动扣收，与普通买入的银证结算不同）
      const buyCost = shares * price + fee;
      if (existing) {
        const oldShares = Number(existing.shares) || 0;
        const oldCostValue = Number(existing.cost_value) || (oldShares * Number(existing.cost_price || 0));
        const newShares = oldShares + shares;
        const newCostValue = oldCostValue + buyCost;
        const newCost = newShares > 0 ? newCostValue / newShares : price;

        // 累计手续费
        const oldFee = Number(existing.total_fee) || 0;
        const newTotalFee = oldFee + fee;
        // 重算市值/浮动盈亏/总收益：用 newShares × current_price 重算市值，
        // 不能复用旧 market_value（份额已变，旧值已失效）
        const curPrice = Number(existing.current_price) || price;
        const newMarketValue = Number((newShares * curPrice).toFixed(2));
        const newPnl = Number((newMarketValue - newCostValue).toFixed(2));
        const newPnlPercent = newCostValue > 0
          ? Number(((newPnl / newCostValue) * 100).toFixed(2)) : 0;
        const newTotalPnl = recomputeTotalPnl(
          { ...existing, total_fee: newTotalFee },
          newMarketValue, newCostValue
        );

        const updateData = {
          shares: newShares,
          cost_price: Number(newCost.toFixed(4)),
          cost_value: Number(newCostValue.toFixed(2)),
          market_value: newMarketValue,
          pnl: newPnl,
          pnl_percent: newPnlPercent,
          total_fee: Number(newTotalFee.toFixed(2)),
          total_pnl: newTotalPnl,
          is_cleared: false,
          updated_at: db.serverDate(),
        };

        await db.collection('holdings').doc(existing._id).update({ data: updateData });
        resultHolding = { ...existing, ...updateData };
      } else {
        // 新建持仓
        const newCostPrice = shares > 0 ? buyCost / shares : price;
        const marketValue = Number((shares * price).toFixed(2));
        const newHolding = {
          _openid: ownerOpenid,
          account_id: txn.account_id,
          product_code: txn.product_code,
          product_name: txn.product_name || txn.product_code,
          product_type: txn.product_type || '',
          exchange: txn.exchange || '',
          shares: shares,
          cost_price: Number(newCostPrice.toFixed(4)),
          cost_value: Number(buyCost.toFixed(2)),
          current_price: price,
          market_value: marketValue,
          pnl: 0,
          pnl_percent: 0,
          realized_pnl: 0,
          total_dividend: 0,
          total_fee: Number(fee.toFixed(2)),
          total_pnl: 0,
          daily_change: 0,
          is_cleared: false,
          buy_date: txn.trade_date || '',
          note: '',
          created_at: db.serverDate(),
          updated_at: db.serverDate(),
        };
        const addRes = await db.collection('holdings').add({ data: newHolding });
        resultHolding = { ...newHolding, _id: addRes._id };
      }
      // 打新中签缴款由券商从资金账户自动扣收，联动扣减账户现金余额
      if (type === 'ipo_win') {
        await adjustAccountCash(txn.account_id, ownerOpenid, -buyCost);
      }
    } else {
      // 卖出
      if (!existing) {
        await db.collection('transactions').doc(transaction_id).update({
          data: { applied_holding: true, applied_at: db.serverDate() },
        });
        return { success: true, message: '无对应持仓，卖出仅记录', warning: true };
      }

      const oldShares = Number(existing.shares) || 0;
      const newShares = oldShares - shares;
      const isCleared = newShares <= 0;
      const finalShares = isCleared ? 0 : newShares;

      const costPrice = Number(existing.cost_price) || 0;
      const newCostValue = Number((finalShares * costPrice).toFixed(2));
      // 已实现盈亏 = (卖出价 - 持仓成本价) × 卖出份额 - 卖出手续费
      // 同花顺口径：卖出手续费从已实现盈亏中扣除
      const sellRealized = (price - costPrice) * shares - fee;
      const oldRealized = Number(existing.realized_pnl) || 0;
      const newRealized = oldRealized + sellRealized;
      // 累计手续费
      const oldFee = Number(existing.total_fee) || 0;
      const newTotalFee = oldFee + fee;

      // 重算市值/浮动盈亏/总收益：用 finalShares × current_price 重算市值，
      // 不能复用旧 market_value（份额已变，旧值已失效）
      const curPrice = Number(existing.current_price) || price;
      const newMarketValue = isCleared ? 0
        : Number((finalShares * curPrice).toFixed(2));
      const newPnl = Number((newMarketValue - newCostValue).toFixed(2));
      const newPnlPercent = newCostValue > 0
        ? Number(((newPnl / newCostValue) * 100).toFixed(2)) : 0;
      const newTotalPnl = recomputeTotalPnl(
        { ...existing, realized_pnl: newRealized, total_fee: newTotalFee },
        newMarketValue, newCostValue
      );

      const updateData = {
        shares: finalShares,
        is_cleared: isCleared,
        cost_value: newCostValue,
        market_value: newMarketValue,
        pnl: newPnl,
        pnl_percent: newPnlPercent,
        realized_pnl: Number(newRealized.toFixed(2)),
        total_fee: Number(newTotalFee.toFixed(2)),
        total_pnl: newTotalPnl,
        updated_at: db.serverDate(),
      };

      await db.collection('holdings').doc(existing._id).update({ data: updateData });
      resultHolding = { ...existing, ...updateData };
    }

    // 5. 标记交易已应用
    await db.collection('transactions').doc(transaction_id).update({
      data: { applied_holding: true, applied_at: db.serverDate() },
    });

    return {
      success: true,
      message: isCleared(resultHolding) ? '已应用，持仓清仓' : '已应用',
      holding: resultHolding,
    };
  } catch (err) {
    console.error('[apply_transaction] error:', err);
    return { success: false, message: err.message || '应用失败' };
  }
};

function isCleared(h) {
  return h && h.is_cleared === true;
}
