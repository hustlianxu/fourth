/**
 * 资讯推送云函数
 * 通过微信订阅消息推送财经资讯
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  try {
    // 获取最新资讯（取前 5 条最重要的）
    const { data: news } = await db.collection('news_cache')
      .orderBy('importance', 'desc')
      .orderBy('publish_time', 'desc')
      .limit(5)
      .get();

    if (!news || news.length === 0) {
      return { success: true, message: '暂无新资讯', pushed: 0 };
    }

    // 构建推送消息
    const topNews = news[0];
    const title = topNews.title;
    const summary = (topNews.summary || '').slice(0, 50) || title.slice(0, 50);

    // 通过云调用发送订阅消息
    try {
      await cloud.openapi.subscribeMessage.send({
        templateId: 'your-template-id',  // 需要在微信公众平台申请模板
        data: {
          thing1: { value: title.slice(0, 20) },
          thing2: { value: summary.slice(0, 20) },
          time3: { value: new Date().toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) },
        },
      });
      return {
        success: true,
        message: '推送成功',
        pushed: 1,
      };
    } catch (pushErr) {
      console.error('[push_news] subscribeMessage error:', pushErr);
      // 订阅消息未配置或用户未订阅，不影响整体功能
      return {
        success: true,
        message: '用户未订阅推送',
        pushed: 0,
      };
    }
  } catch (err) {
    console.error('[push_news] error:', err);
    return { success: false, message: err.message };
  }
};
