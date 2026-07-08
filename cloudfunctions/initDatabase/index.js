// 云函数：初始化云数据库集合
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const collections = ['records', 'records_history', 'folders', 'shares', 'config'];
  const results = [];

  for (const name of collections) {
    try {
      await db.createCollection(name);
      results.push({ collection: name, status: 'created' });
    } catch (e) {
      // 集合已存在会报错，属正常情况
      if (e.errCode === 'DATABASE_COLLECTION_ALREADY_EXIST' ||
          (e.message && e.message.indexOf('already exists') >= 0)) {
        results.push({ collection: name, status: 'already_exists' });
      } else {
        results.push({ collection: name, status: 'error', error: e.message });
      }
    }
  }

  return {
    openid: wxContext.OPENID,
    results: results
  };
};
