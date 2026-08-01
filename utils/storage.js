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

function getFolderByName(name) {
  const list = getAllFolders();
  return list.find(item => item.name === String(name).trim());
}

function addFolder(name, id) {
  const list = getAllFolders();
  const folder = {
    id: id || genFolderId(),
    name: String(name).trim(),
    createdAt: Date.now(),
    updatedAt: Date.now()
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
  // 先删除回收站各记录引用的本地文件，再清空元数据（文件不删会成为孤儿占满配额）
  _getTrashRaw().forEach(function (r) { getRecordFilePaths(r).forEach(safeUnlink); });
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
  var expired = trash.filter(function (item) { return (item._deletedAt || 0) <= cutoff; });
  var remaining = trash.filter(function (item) { return (item._deletedAt || 0) > cutoff; });
  // 删除过期记录引用的本地文件，避免成为孤儿文件继续占满配额
  expired.forEach(function (r) { getRecordFilePaths(r).forEach(safeUnlink); });
  wx.setStorageSync(KEY_TRASH, remaining);
  return expired.length;
}

function clearAll() {
  // 先删除所有记录（含回收站）引用的本地文件，再清空元数据
  getAll().forEach(function (r) { getRecordFilePaths(r).forEach(safeUnlink); });
  _getTrashRaw().forEach(function (r) { getRecordFilePaths(r).forEach(safeUnlink); });
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
 * 用云端列表全量替换自定义模板（替代增量 saveCustomTemplate）
 * 保证云端删除的模板在本地也被删除
 */
function setCustomTemplates(list) {
  wx.setStorageSync(KEY_TEMPLATES, Array.isArray(list) ? list : []);
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

// ===== 云端导出记录 =====

const KEY_EXPORTS = 'watermark_exports';

function addExportRecord(record) {
  var list = getExportRecords();
  list.unshift({
    fileID: record.fileID,
    fileName: record.fileName,
    createdAt: record.createdAt || Date.now()
  });
  // 只保留最近 20 条
  if (list.length > 20) list = list.slice(0, 20);
  wx.setStorageSync(KEY_EXPORTS, list);
}

function getExportRecords() {
  try {
    var list = wx.getStorageSync(KEY_EXPORTS);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function removeExportRecord(fileID) {
  var list = getExportRecords();
  var next = list.filter(function (item) { return item.fileID !== fileID; });
  wx.setStorageSync(KEY_EXPORTS, next);
}

// ===== 云同步配置 =====

const KEY_SYNC_ENABLED = 'watermark_sync_enabled';
const KEY_LAST_SYNC_TIME = 'watermark_last_sync_time';
const KEY_CONFIG_SYNC_ENABLED = 'watermark_config_sync_enabled';

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

function getConfigSyncEnabled() {
  try {
    return wx.getStorageSync(KEY_CONFIG_SYNC_ENABLED) === true;
  } catch (e) {
    return false;
  }
}

function setConfigSyncEnabled(enabled) {
  wx.setStorageSync(KEY_CONFIG_SYNC_ENABLED, !!enabled);
}

// ===== 本地文件存储管理 =====
//
// 背景：微信本地缓存文件 + 本地用户文件共享 200MB 总配额，超出后继续写文件失败且平台不自动清理。
// 本模块提供：孤儿文件清理、已同步记录的本地文件 LRU 释放、本地占用统计，配合拍照前配额预警使用。

const LOCAL_FILE_QUOTA = 200 * 1024 * 1024; // 微信本地存储总配额 200MB
const SOFT_LIMIT = 150 * 1024 * 1024;       // 超过后自动清理已同步记录的本地文件
const HARD_LIMIT = 190 * 1024 * 1024;       // 超过后阻止拍摄并提示

// 本应用生成的图片文件前缀（用于识别 USER_DATA_PATH 中的孤儿文件）
// 注意：restore_/copy_ 正常情况下被记录引用，未引用时即为孤儿，可一并清理
const GENERATED_PREFIX_RE = /^(orig_|wm_|wm_embed_|photo_|copy_|restore_)/;

/**
 * 容错删除本地文件。
 * saveFile 产物（store_ 缓存文件）只读，unlinkSync 不适用时回退 removeSavedFile；
 * USER_DATA_PATH 下我们 writeFileSync/copyFileSync 生成的文件 unlinkSync 直接可删。
 */
function safeUnlink(path) {
  if (!path) return;
  var fs = wx.getFileSystemManager();
  try { fs.unlinkSync(path); return; } catch (e) {}
  try { fs.removeSavedFile({ filePath: path, fail: function () {} }); } catch (e) {}
}

/**
 * 记录引用的本地文件路径列表（去重）
 */
function getRecordFilePaths(record) {
  if (!record) return [];
  var paths = [];
  if (record.imagePath) paths.push(record.imagePath);
  if (record.originalPath && record.originalPath !== record.imagePath) paths.push(record.originalPath);
  return paths;
}

/**
 * 同步统计本地已用空间（字节）。
 * 包含：所有记录 + 回收站引用的文件、USER_DATA_PATH 中未被引用的孤儿文件。
 * 注意：历史 store_ 孤儿（saveFile 产物）不在此统计内（getSavedFileList 为异步），
 * 由 purgeOrphanFiles() 负责清理，不影响拍摄预检的准确性。
 */
function getLocalFileUsage() {
  var total = 0;
  var fs = wx.getFileSystemManager();
  var seen = {};
  var addFile = function (p) {
    if (!p || seen[p]) return;
    seen[p] = true;
    try { total += fs.statSync(p).size || 0; } catch (e) {}
  };
  getAll().forEach(function (r) { getRecordFilePaths(r).forEach(addFile); });
  getTrash().forEach(function (r) { getRecordFilePaths(r).forEach(addFile); });
  try {
    var files = fs.readdirSync(wx.env.USER_DATA_PATH) || [];
    for (var i = 0; i < files.length; i++) {
      var name = files[i];
      if (!GENERATED_PREFIX_RE.test(name)) continue;
      var full = wx.env.USER_DATA_PATH + '/' + name;
      if (seen[full]) continue;
      try { total += fs.statSync(full).size || 0; } catch (e) {}
    }
  } catch (e) {}
  return total;
}

/**
 * 统一本地路径前缀：开发者工具 USER_DATA_PATH 为 http://usr，真机为 wxfile://usr。
 * 路径比对（getSavedFileList 返回 vs 记录存储）前归一化，避免误删仍被引用的文件。
 */
function _normalizePath(p) {
  if (!p) return '';
  return String(p).replace(/^http:\/\/usr\//, 'wxfile://usr/');
}

/**
 * 构建所有记录 + 回收站引用的文件路径集合（键为归一化路径）
 */
function _buildReferencedPathSet() {
  var set = {};
  getAll().forEach(function (r) {
    getRecordFilePaths(r).forEach(function (p) { if (p) set[_normalizePath(p)] = true; });
  });
  getTrash().forEach(function (r) {
    getRecordFilePaths(r).forEach(function (p) { if (p) set[_normalizePath(p)] = true; });
  });
  return set;
}

/**
 * 清理孤儿文件：未被任何记录引用的中间产物。
 * ① USER_DATA_PATH 中匹配生成前缀且未被引用的文件（unlinkSync）；
 * ② 历史 saveFile 产物（store_ 缓存文件）中未被引用的（removeSavedFile）。
 * @returns {Promise<{removed: number, freed: number}>}
 */
function purgeOrphanFiles() {
  return new Promise(function (resolve) {
    var fs = wx.getFileSystemManager();
    var referenced = _buildReferencedPathSet();
    var removed = 0;
    var freed = 0;

    // ① USER_DATA_PATH 同步清理
    try {
      var files = fs.readdirSync(wx.env.USER_DATA_PATH) || [];
      for (var i = 0; i < files.length; i++) {
        var name = files[i];
        if (!GENERATED_PREFIX_RE.test(name)) continue;
        var full = wx.env.USER_DATA_PATH + '/' + name;
        if (referenced[_normalizePath(full)]) continue;
        try { freed += fs.statSync(full).size || 0; } catch (e) {}
        try { fs.unlinkSync(full); removed++; } catch (e) {}
      }
    } catch (e) {}

    // ② store_ 孤儿（异步，路径经归一化比对避免 scheme 不一致导致误删）
    if (typeof fs.getSavedFileList !== 'function') {
      resolve({ removed: removed, freed: freed });
      return;
    }
    fs.getSavedFileList({
      success: function (res) {
        var list = res.fileList || [];
        for (var j = 0; j < list.length; j++) {
          var sf = list[j];
          if (!sf || !sf.filePath) continue;
          if (referenced[_normalizePath(sf.filePath)]) continue;
          try { freed += sf.size || 0; } catch (e) {}
          safeUnlink(sf.filePath);
          removed++;
        }
        resolve({ removed: removed, freed: freed });
      },
      fail: function () {
        resolve({ removed: removed, freed: freed });
      }
    });
  });
}

/**
 * 释放已同步记录的本地文件（LRU：最旧优先）。
 * 仅清理 _cloudFileId 非空的记录（云端有备份，可随时懒加载下载）。
 * 保留元数据与 _cloudFileId/_originalCloudFileId，仅清空 imagePath/originalPath。
 * @param {number} [targetBytes=0] 需要释放的目标字节数；0 表示全部清理
 * @returns {{cleaned: number, freed: number}}
 */
function deleteLocalFilesForSyncedRecords(targetBytes) {
  targetBytes = targetBytes || 0;
  var fs = wx.getFileSystemManager();
  var list = getAll().slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
  var freed = 0;
  var cleaned = 0;
  for (var i = 0; i < list.length; i++) {
    if (targetBytes > 0 && freed >= targetBytes) break;
    var r = list[i];
    if (!r._cloudFileId) continue; // 未上云，删除后无法恢复，跳过
    var patch = {};
    if (r.imagePath) {
      try { freed += fs.statSync(r.imagePath).size || 0; } catch (e) {}
      safeUnlink(r.imagePath);
      patch.imagePath = '';
      // 干净原图场景 originalPath === imagePath，需一并清空
      if (r.originalPath === r.imagePath) patch.originalPath = '';
    }
    if (r.originalPath && r.originalPath !== r.imagePath) {
      try { freed += fs.statSync(r.originalPath).size || 0; } catch (e) {}
      safeUnlink(r.originalPath);
      patch.originalPath = '';
    }
    if (patch.imagePath !== undefined || patch.originalPath !== undefined) {
      update(r.id, patch);
      cleaned++;
    }
  }
  return { cleaned: cleaned, freed: freed };
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
  getFolderByName,
  addFolder,
  updateFolder,
  removeFolder,
  genFolderId,
  countByFolder,
  // 自定义模板
  getCustomTemplates,
  saveCustomTemplate,
  deleteCustomTemplate,
  setCustomTemplates,
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
  getConfigSyncEnabled,
  setConfigSyncEnabled,
  // 云端导出记录
  addExportRecord,
  getExportRecords,
  removeExportRecord,
  // 回收站
  moveToTrash,
  getTrash,
  getTrashCount,
  restoreFromTrash,
  emptyTrash,
  cleanupTrash,
  // 本地文件存储管理
  LOCAL_FILE_QUOTA,
  SOFT_LIMIT,
  HARD_LIMIT,
  safeUnlink,
  getRecordFilePaths,
  getLocalFileUsage,
  purgeOrphanFiles,
  deleteLocalFilesForSyncedRecords
};
