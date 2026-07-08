// 云函数：撤回授权
// 参数: { recordId, targetOpenid }
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const ownerOpenid = wxContext.OPENID;
  const { recordId, targetOpenid } = event;

  if (!recordId || !targetOpenid) {
    return { success: false, error: '缺少参数' };
  }

  try {
    // 从 records 集合移除授权
    const res = await db.collection('records').where({
      recordId: recordId,
      owner: ownerOpenid
    }).get();

    if (!res.data || res.data.length === 0) {
      return { success: false, error: '记录不存在' };
    }

    const doc = res.data[0];
    var sharedWith = (doc.sharedWith || []).filter(s => s.openid !== targetOpenid);

    await db.collection('records').doc(doc._id).update({
      data: { sharedWith: sharedWith }
    });

    // 从 shares 集合删除
    const shareRes = await db.collection('shares').where({
      recordId: recordId,
      targetOpenid: targetOpenid,
      owner: ownerOpenid
    }).get();

    if (shareRes.data && shareRes.data.length > 0) {
      await db.collection('shares').doc(shareRes.data[0]._id).remove();
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
