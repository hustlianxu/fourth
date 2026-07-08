// 云函数：管理导出记录（列出/新增）
// 数据存储在已有的 records 集合中，用 _type: 'export_meta' 标记
// 参数: { action: 'list' | 'save', fileName?, fileID? }
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { action, fileName, fileID } = event;

  try {
    if (action === 'save') {
      if (!fileName || !fileID) {
        return { success: false, error: '缺少参数' };
      }

      await db.collection('records').add({
        data: {
          owner: openid,
          _type: 'export_meta',
          fileID: fileID,
          fileName: fileName,
          createdAt: Date.now(),
          deletedAt: null
        }
      });
      return { success: true };
    }

    if (action === 'list') {
      const res = await db.collection('records')
        .where({
          owner: openid,
          _type: 'export_meta',
          deletedAt: null
        })
        .get();

      var records = (res.data || []).map(function (doc) {
        return {
          fileID: doc.fileID,
          fileName: doc.fileName,
          createdAt: doc.createdAt
        };
      });
      // 客户端排序，避免要求数据库索引
      records.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

      return { success: true, records: records };
    }

    if (action === 'delete') {
      if (!fileID) {
        return { success: false, error: '缺少 fileID' };
      }

      // 查找对应的 export_meta 记录
      const res = await db.collection('records')
        .where({ owner: openid, _type: 'export_meta', fileID: fileID, deletedAt: null })
        .get();

      if (res.data && res.data.length > 0) {
        // 软删除（标记 deletedAt，30天后由 cleanup 云函数彻底清理）
        await db.collection('records').doc(res.data[0]._id).update({
          data: { deletedAt: Date.now() }
        });

        // 同时删除云存储中的 xlsx 文件
        try {
          await cloud.deleteFile({ fileList: [fileID] });
        } catch (delErr) {
          console.warn('[exportRecords] 删除云存储文件失败:', delErr.message);
        }
      }

      return { success: true };
    }

    return { success: false, error: '未知操作' };
  } catch (e) {
    return { success: false, error: e.message };
  }
};
