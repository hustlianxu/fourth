// 云函数：授权其他用户
// 参数: { recordId, targetOpenid, permission }
// permission: 'read' | 'write' | 'readwrite'
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const ownerOpenid = wxContext.OPENID;
  const { recordId, targetOpenid, permission } = event;

  if (!recordId || !targetOpenid || !permission) {
    return { success: false, error: '缺少参数' };
  }
  if (['read', 'write', 'readwrite'].indexOf(permission) < 0) {
    return { success: false, error: '无效的权限级别' };
  }
  if (targetOpenid === ownerOpenid) {
    return { success: false, error: '不能授权给自己' };
  }

  try {
    // 查找记录
    const res = await db.collection('records').where({
      recordId: recordId,
      owner: ownerOpenid
    }).get();

    if (!res.data || res.data.length === 0) {
      return { success: false, error: '记录不存在' };
    }

    const doc = res.data[0];
    var sharedWith = doc.sharedWith || [];

    // 去重更新
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

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
