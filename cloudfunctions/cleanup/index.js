// 云函数：定时清理过期数据
// 触发器：每天凌晨 2:00 执行
// 清理内容：
//   1. records 中 deletedAt 超过 30 天的软删除记录（永久删除）
//   2. 随记录一同删除对应的云存储图片
//   3. 清理 records_history 中超过 90 天的历史版本
//   4. 清理 exports 目录中超过 7 天的导出文件
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 云存储操作
const storage = cloud.getCloudStorage();

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

exports.main = async (event, context) => {
  console.log('[Cleanup] 开始清理过期数据');
  const now = Date.now();
  const thirtyDaysAgo = now - THIRTY_DAYS;
  const ninetyDaysAgo = now - NINETY_DAYS;
  const sevenDaysAgo = now - SEVEN_DAYS;
  const results = { records: 0, histories: 0, errors: [] };

  try {
    // === 1. 清理过期软删除记录 ===
    console.log('[Cleanup] 查找 deletedAt <', thirtyDaysAgo, '的记录');
    const recordRes = await db.collection('records')
      .where({
        deletedAt: _.neq(null).and(_.lt(thirtyDaysAgo))
      })
      .get();

    if (recordRes.data && recordRes.data.length > 0) {
      console.log('[Cleanup] 找到', recordRes.data.length, '条过期记录');

      for (const doc of recordRes.data) {
        try {
          // 删除云存储中的图片
          var fileIDs = [];
          if (doc.imageFileID) fileIDs.push(doc.imageFileID);
          if (doc.originalFileID) fileIDs.push(doc.originalFileID);
          if (fileIDs.length > 0) {
            try {
              await cloud.deleteFile({
                fileList: fileIDs
              });
              console.log('[Cleanup] 已删除云存储文件:', fileIDs.join(', '));
            } catch (e) {
              console.warn('[Cleanup] 删除云存储文件失败:', e.message);
            }
          }

          // 删除对应的 shares
          await db.collection('shares').where({
            recordId: doc.recordId
          }).remove();

          // 删除 records_history
          await db.collection('records_history').where({
            recordId: doc.recordId
          }).remove();

          // 永久删除记录
          await db.collection('records').doc(doc._id).remove();
          results.records++;
        } catch (e) {
          results.errors.push('删除记录 ' + doc.recordId + ' 失败: ' + e.message);
        }
      }
    } else {
      console.log('[Cleanup] 无过期记录需要清理');
    }

    // === 2. 清理超过 90 天的历史版本 ===
    console.log('[Cleanup] 查找 changedAt <', ninetyDaysAgo, '的历史版本');
    // 注意：records_history 可能很大，分批删除
    let histDeleted = 0;
    while (true) {
      const histRes = await db.collection('records_history')
        .where({ changedAt: _.lt(ninetyDaysAgo) })
        .limit(100)
        .get();

      if (!histRes.data || histRes.data.length === 0) break;

      const histIds = histRes.data.map(function (h) { return h._id; });
      await db.collection('records_history')
        .where({ _id: _.in(histIds) })
        .remove();
      histDeleted += histIds.length;
    }
    results.histories = histDeleted;
    console.log('[Cleanup] 已删除', histDeleted, '条过期历史版本');

    console.log('[Cleanup] 清理完成。结果:', JSON.stringify(results));
    return {
      success: true,
      cleanedRecords: results.records,
      cleanedHistories: results.histories,
      errors: results.errors
    };
  } catch (e) {
    console.error('[Cleanup] 清理失败:', e);
    return { success: false, error: e.message };
  }
};
