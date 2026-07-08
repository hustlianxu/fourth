// 云函数：批量分享记录给其他用户
// 参数: { recordIds: [], targetOpenid, permission }
// 前端需先确保图片已上传到云存储，将 fileID 传入
// 也可由前端传入本地记录的完整数据，云函数代为上传
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const ownerOpenid = wxContext.OPENID;
  const { recordIds, targetOpenid, permission, records } = event;

  if (!recordIds || !targetOpenid || !permission) {
    return { success: false, error: '缺少参数' };
  }
  if (['read', 'write', 'readwrite'].indexOf(permission) < 0) {
    return { success: false, error: '无效的权限级别' };
  }

  const results = [];

  for (const recordId of recordIds) {
    try {
      // 检查云端是否已有此记录
      const existRes = await db.collection('records').where({
        recordId: recordId,
        owner: ownerOpenid
      }).get();

      if (existRes.data && existRes.data.length > 0) {
        // 云端已存在 → 更新 sharedWith
        const doc = existRes.data[0];
        var sharedWith = doc.sharedWith || [];
        var existing = sharedWith.findIndex(s => s.openid === targetOpenid);
        var entry = {
          openid: targetOpenid,
          permission: permission,
          grantedAt: Date.now()
        };
        if (existing >= 0) {
          sharedWith[existing] = entry;
        } else {
          sharedWith.push(entry);
        }
        await db.collection('records').doc(doc._id).update({
          data: { sharedWith: sharedWith }
        });
        results.push({ recordId: recordId, status: 'shared', action: 'updated' });
      } else if (records && records[recordId]) {
        // 云端不存在但前端提供了数据 → 创建记录
        const rec = records[recordId];
        const cloudData = {
          recordId: recordId,
          owner: ownerOpenid,
          sharedWith: [{ openid: targetOpenid, permission: permission, grantedAt: Date.now() }],
          templateId: rec.templateId || '',
          templateName: rec.templateName || '',
          watermarkPosition: rec.watermarkPosition || 'bottom-center',
          watermarkScale: rec.watermarkScale || 1,
          watermarkOpacity: rec.watermarkOpacity || 0.85,
          watermarkWidthRatio: rec.watermarkWidthRatio || 0.42,
          values: rec.values || {},
          imageFileID: rec.imageFileID || '',
          originalFileID: rec.originalFileID || '',
          width: rec.width || 0,
          height: rec.height || 0,
          folderId: null,
          customName: rec.customName || '',
          createdAt: rec.createdAt || Date.now(),
          updatedAt: Date.now(),
          deletedAt: null,
          version: 1
        };
        await db.collection('records').add({ data: cloudData });
        results.push({ recordId: recordId, status: 'shared', action: 'created' });
      } else {
        results.push({ recordId: recordId, status: 'skipped', reason: '云端无此记录且未提供数据' });
      }

      // 写入 shares 集合
      if (results[results.length - 1].status === 'shared') {
        const shareRes = await db.collection('shares').where({
          recordId: recordId,
          targetOpenid: targetOpenid,
          owner: ownerOpenid
        }).get();
        if (shareRes.data && shareRes.data.length > 0) {
          await db.collection('shares').doc(shareRes.data[0]._id).update({
            data: { permission: permission, updatedAt: Date.now() }
          });
        } else {
          await db.collection('shares').add({
            data: {
              recordId: recordId,
              targetOpenid: targetOpenid,
              owner: ownerOpenid,
              permission: permission,
              createdAt: Date.now(),
              expiredAt: null
            }
          });
        }
      }
    } catch (e) {
      results.push({ recordId: recordId, status: 'error', error: e.message });
    }
  }

  var sharedCount = results.filter(r => r.status === 'shared').length;
  return {
    success: sharedCount > 0,
    results: results,
    sharedCount: sharedCount
  };
};
