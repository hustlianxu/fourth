// utils/storage.js
// 本地存储管理：照片记录 + 自定义模板

const KEY_PHOTOS = 'watermark_photos';
const KEY_TEMPLATES = 'watermark_custom_tpls';

// ===== 照片记录操作 =====
function getAll() {
  try {
    const list = wx.getStorageSync(KEY_PHOTOS);
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
  wx.setStorageSync(KEY_PHOTOS, list);
  return record;
}

function update(id, patch) {
  const list = getAll();
  const idx = list.findIndex((item) => item.id === id);
  if (idx === -1) return null;
  list[idx] = Object.assign({}, list[idx], patch);
  wx.setStorageSync(KEY_PHOTOS, list);
  return list[idx];
}

function remove(id) {
  const list = getAll();
  const next = list.filter((item) => item.id !== id);
  wx.setStorageSync(KEY_PHOTOS, next);
  return true;
}

function clearAll() {
  wx.setStorageSync(KEY_PHOTOS, []);
}

// ===== 自定义模板操作 =====
function getCustomTemplates() {
  try {
    const list = wx.getStorageSync(KEY_TEMPLATES);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function saveCustomTemplate(tpl) {
  const list = getCustomTemplates();
  const idx = list.findIndex(item => item.id === tpl.id);
  if (idx >= 0) {
    list[idx] = tpl;
  } else {
    list.unshift(tpl);
  }
  wx.setStorageSync(KEY_TEMPLATES, list);
  return tpl;
}

function deleteCustomTemplate(id) {
  const list = getCustomTemplates();
  const next = list.filter(item => item.id !== id);
  wx.setStorageSync(KEY_TEMPLATES, next);
  return true;
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
  genId,
  getCustomTemplates,
  saveCustomTemplate,
  deleteCustomTemplate
};
