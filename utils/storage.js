// utils/storage.js
// 本地存储管理：照片记录 + 自定义模板 + 文件夹

const KEY_PHOTOS = 'watermark_photos';
const KEY_TEMPLATES = 'watermark_custom_tpls';
const KEY_FOLDERS = 'watermark_folders';
const KEY_AUTO_ALBUM = 'watermark_auto_save_album';  // 是否拍照后自动保存到系统相册
const KEY_AUTO_SAVE_EDIT_ALBUM = 'watermark_auto_save_edit_album';  // 编辑保存时是否自动保存水印图到系统相册
const KEY_TRASH = 'watermark_trash';

// ===== 内部辅助 =====

/**
 * 规范化记录对象，为旧数据补默认字段
 */
function _normalizeRecord(item) {
  return Object.assign({}, item, {
    folderId: item.folderId !== undefined ? item.folderId : null,
    customName: item.customName || null
  });
}

// ===== 文件夹操作 =====

function getAllFolders() {
  try {
    const list = wx.getStorageSync(KEY_FOLDERS);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function getFolderById(id) {
  const list = getAllFolders();
  return list.find(item => item.id === id);
}

function addFolder(name) {
  const list = getAllFolders();
  const folder = {
    id: genFolderId(),
    name: String(name).trim(),
    createdAt: Date.now()
  };
  list.unshift(folder);
  wx.setStorageSync(KEY_FOLDERS, list);
  return folder;
}

function updateFolder(id, patch) {
  const list = getAllFolders();
  const idx = list.findIndex(item => item.id === id);
  if (idx === -1) return null;
  list[idx] = Object.assign({}, list[idx], patch, { updatedAt: Date.now() });
  wx.setStorageSync(KEY_FOLDERS, list);
  return list[idx];
}

function removeFolder(id) {
  const list = getAllFolders();
  const next = list.filter(item => item.id !== id);
  wx.setStorageSync(KEY_FOLDERS, next);
  return true;
}

function genFolderId() {
  return 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function countByFolder(folderId) {
  const all = getAll();
  return all.filter(item => item.folderId === folderId).length;
}

// ===== 照片记录操作 =====

function getAll() {
  try {
    const list = wx.getStorageSync(KEY_PHOTOS);
    if (!Array.isArray(list)) return [];
    return list.map(_normalizeRecord);
  } catch (e) {
    return [];
  }
}

function getById(id) {
  const list = getAll();
  return list.find((item) => item.id === id);
}

/**
 * 获取指定文件夹下的记录
 * @param {string|null} folderId - null 匹配未分类记录
 */
function getByFolderId(folderId) {
  const all = getAll();
  return all.filter(item => item.folderId === folderId);
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

// ===== 回收站操作 =====

function moveToTrash(id) {
  var record = getById(id);
  if (!record) return false;
  record._deletedAt = Date.now();
  var trash = _getTrashRaw();
  trash.unshift(record);
  wx.setStorageSync(KEY_TRASH, trash);
  remove(id);
  return true;
}

function _getTrashRaw() {
  try {
    var list = wx.getStorageSync(KEY_TRASH);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function getTrash() {
  return _getTrashRaw().map(_normalizeRecord);
}

function getTrashCount() {
  return _getTrashRaw().length;
}

function restoreFromTrash(id) {
  var trash = _getTrashRaw();
  var idx = trash.findIndex(function (item) { return item.id === id; });
  if (idx < 0) return false;
  var record = trash[idx];
  delete record._deletedAt;
  trash.splice(idx, 1);
  wx.setStorageSync(KEY_TRASH, trash);
  add(record);
  return true;
}

function emptyTrash() {
  wx.setStorageSync(KEY_TRASH, []);
}

/**
 * 清理超过指定天数的回收站记录
 * @param {number} days - 保留天数，默认30
 */
function cleanupTrash(days) {
  days = days || 30;
  var cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  var trash = _getTrashRaw();
  var remaining = trash.filter(function (item) { return (item._deletedAt || 0) > cutoff; });
  wx.setStorageSync(KEY_TRASH, remaining);
  return trash.length - remaining.length;
}

function clearAll() {
  wx.setStorageSync(KEY_PHOTOS, []);
  wx.setStorageSync(KEY_FOLDERS, []);
  wx.setStorageSync(KEY_TRASH, []);
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

// ===== 自动保存相册配置 =====

function getAutoSaveAlbum() {
  try {
    return wx.getStorageSync(KEY_AUTO_ALBUM) === true;
  } catch (e) {
    return false;
  }
}

function setAutoSaveAlbum(enabled) {
  wx.setStorageSync(KEY_AUTO_ALBUM, !!enabled);
}

function getAutoSaveEditAlbum() {
  try {
    return wx.getStorageSync(KEY_AUTO_SAVE_EDIT_ALBUM) === true;
  } catch (e) {
    return false;
  }
}

function setAutoSaveEditAlbum(enabled) {
  wx.setStorageSync(KEY_AUTO_SAVE_EDIT_ALBUM, !!enabled);
}

// ===== 云同步配置 =====

const KEY_SYNC_ENABLED = 'watermark_sync_enabled';
const KEY_LAST_SYNC_TIME = 'watermark_last_sync_time';

function getSyncEnabled() {
  try {
    return wx.getStorageSync(KEY_SYNC_ENABLED) === true;
  } catch (e) {
    return false;
  }
}

function setSyncEnabled(enabled) {
  wx.setStorageSync(KEY_SYNC_ENABLED, !!enabled);
}

function getLastSyncTime() {
  try {
    var t = wx.getStorageSync(KEY_LAST_SYNC_TIME);
    return typeof t === 'number' ? t : 0;
  } catch (e) {
    return 0;
  }
}

function setLastSyncTime(timestamp) {
  wx.setStorageSync(KEY_LAST_SYNC_TIME, timestamp || Date.now());
}

module.exports = {
  getAll,
  getById,
  getByFolderId,
  add,
  update,
  remove,
  clearAll,
  genId,
  // 文件夹
  getAllFolders,
  getFolderById,
  addFolder,
  updateFolder,
  removeFolder,
  genFolderId,
  countByFolder,
  // 自定义模板
  getCustomTemplates,
  saveCustomTemplate,
  deleteCustomTemplate,
  // 自动保存相册
  getAutoSaveAlbum,
  setAutoSaveAlbum,
  // 编辑保存时自动保存到相册
  getAutoSaveEditAlbum,
  setAutoSaveEditAlbum,
  // 云同步
  getSyncEnabled,
  setSyncEnabled,
  getLastSyncTime,
  setLastSyncTime,
  // 回收站
  moveToTrash,
  getTrash,
  getTrashCount,
  restoreFromTrash,
  emptyTrash,
  cleanupTrash
};
