// utils/storage.js
// 本地存储管理：照片记录（包含图片本地路径 + 模板信息 + 填写数据）
// 未来可替换为云开发数据库（wx.cloud.database）

const KEY = 'watermark_photos';

function getAll() {
  try {
    const list = wx.getStorageSync(KEY);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function getById(id) {
  const list = getAll();
  return list.find((item) => item.id === id);
}

function add(record) {
  const list = getAll();
  list.unshift(record);
  wx.setStorageSync(KEY, list);
  return record;
}

function update(id, patch) {
  const list = getAll();
  const idx = list.findIndex((item) => item.id === id);
  if (idx === -1) return null;
  list[idx] = Object.assign({}, list[idx], patch);
  wx.setStorageSync(KEY, list);
  return list[idx];
}

function remove(id) {
  const list = getAll();
  const next = list.filter((item) => item.id !== id);
  wx.setStorageSync(KEY, next);
  return true;
}

function clearAll() {
  wx.setStorageSync(KEY, []);
}

/**
 * 生成唯一 id
 */
function genId() {
  return 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

module.exports = {
  getAll,
  getById,
  add,
  update,
  remove,
  clearAll,
  genId
};
