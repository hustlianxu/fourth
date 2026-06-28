// 云函数：通过分享卡片授权（对方打开分享卡片时自动获得授权）
// 调用者：被分享的小程序用户（打开卡片的人）
// 参数: { recordId, permission }
// 返回: { success, targetOpenid, record }
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const targetOpenid = wxContext.OPENID;  // 打开分享卡片的人 = 被授权者
  const { recordId, permission } = event;

  if (!recordId || !permission) {
    return { success: false, error: '缺少参数' };
  }
  if (['read', 'write', 'readwrite'].indexOf(permission) < 0) {
    return { success: false, error: '无效的权限级别' };
  }

  try {
    // 通过 recordId 查找记录（云函数有管理员权限，不需要 owner 过滤）
    const res = await db.collection('records').where({ recordId: recordId }).get();
    if (!res.data || res.data.length === 0) {
      return { success: false, error: '记录不存在' };
    }

    const doc = res.data[0];
    const ownerOpenid = doc.owner;

    if (targetOpenid === ownerOpenid) {
      return { success: false, error: '不能授权给自己' };
    }

    // 更新 records 的 sharedWith
    var sharedWith = doc.sharedWith || [];
    var existing = sharedWith.findIndex(s => s.openid === targetOpenid);
    var entry = { openid: targetOpenid, permission: permission, grantedAt: Date.now() };
    if (existing >= 0) {
      sharedWith[existing] = entry;
    } else {
      sharedWith.push(entry);
    }

    await db.collection('records').doc(doc._id).update({ data: { sharedWith: sharedWith } });

    // 同时写入 shares 集合
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

    return {
      success: true,
      targetOpenid: targetOpenid,
      // 返回记录数据，方便前端直接展示
      record: {
        recordId: doc.recordId,
        owner: doc.owner,
        templateId: doc.templateId,
        templateName: doc.templateName,
        watermarkPosition: doc.watermarkPosition,
        watermarkScale: doc.watermarkScale,
        values: doc.values || {},
        imageFileID: doc.imageFileID || '',
        originalFileID: doc.originalFileID || '',
        width: doc.width,
        height: doc.height,
        customName: doc.customName || '',
        createdAt: doc.createdAt
      }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
