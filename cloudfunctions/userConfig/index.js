// 云函数：同步用户配置
// 数据存在 config 集合（每人一条）
// 云函数 add 会自动创建集合，不需要手动建
// 参数: { action: 'push' | 'pull', config? }
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { action, config } = event;

  try {
    if (action === 'push') {
      if (!config) return { success: false, error: '缺少 config' };

      // 尝试查找已有 config 文档（集合不存在时 get 会抛错，catch 里走 add）
      var existDoc = null;
      try {
        const existRes = await db.collection('config').where({ owner: openid }).get();
        if (existRes.data && existRes.data.length > 0) {
          existDoc = existRes.data[0];
        }
      } catch (e) {
        // 集合不存在，直接用 add（会自动创建）
      }

      var doc = {
        owner: openid,
        // 基本设置
        autoSaveAlbum: config.autoSaveAlbum || false,
        autoSaveEditAlbum: config.autoSaveEditAlbum || false,
        customTemplates: config.customTemplates || [],
        // 翻译引擎配置
        translatorConfig: config.translatorConfig || null,
        translatorProfiles: config.translatorProfiles || null,
        translatorPrompt: config.translatorPrompt || null,
        freeDict: config.freeDict || null,
        // 词典/白名单
        customDict: config.customDict || null,
        customWhitelist: config.customWhitelist || null,
        updatedAt: Date.now()
      };

      if (existDoc) {
        await db.collection('config').doc(existDoc._id).update({ data: doc });
      } else {
        await db.collection('config').add({ data: doc });
      }
      return { success: true, updatedAt: doc.updatedAt };
    }

    if (action === 'pull') {
      try {
        const res = await db.collection('config').where({ owner: openid }).get();
        if (res.data && res.data.length > 0) {
          var cfg = res.data[0];
          return {
            success: true,
            config: {
              autoSaveAlbum: cfg.autoSaveAlbum || false,
              autoSaveEditAlbum: cfg.autoSaveEditAlbum || false,
              customTemplates: cfg.customTemplates || [],
              translatorConfig: cfg.translatorConfig || null,
              translatorProfiles: cfg.translatorProfiles || null,
              translatorPrompt: cfg.translatorPrompt || null,
              freeDict: cfg.freeDict || null,
              customDict: cfg.customDict || null,
              customWhitelist: cfg.customWhitelist || null,
              updatedAt: cfg.updatedAt || 0
            }
          };
        }
      } catch (e) {
        // 集合不存在，返回 null
      }
      return { success: true, config: null };
    }

    return { success: false, error: '未知操作' };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
