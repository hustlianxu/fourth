// utils/cloud.js
// 云开发工具模块 - 数据同步引擎
//
// 使用前需在 app.js onLaunch 中调用 wx.cloud.init
// 然后在开发者工具中上传并部署 cloudfunctions/ 下的云函数

var CLOUD_ENV = 'cloud1-d9g0g4pm6b7648e8d';

// ===== 初始化 =====

function init() {
  try {
    wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
    return true;
  } catch (e) {
    console.warn('[Cloud] 初始化失败:', e);
    return false;
  }
}

// ===== 用户信息 =====

function getOpenid() {
  return wx.cloud.callFunction({ name: 'getOpenid' })
    .then(function (res) { return res.result && res.result.openid; })
    .catch(function (err) {
      console.warn('[Cloud] 获取 openid 失败:', err);
      return null;
    });
}

// ===== 云存储 =====

/**
 * 上传图片到云存储
 * @param {string} localPath - 本地文件路径
 * @param {string} cloudPath - 云端路径（如 photos/{openid}/{recordId}.jpg）
 * @returns {Promise<string|null>} fileID
 */
function uploadFile(localPath, cloudPath) {
  return wx.cloud.uploadFile({
    cloudPath: cloudPath,
    filePath: localPath
  }).then(function (res) {
    console.log('[Cloud] 上传成功:', res.fileID);
    return res.fileID;
  }).catch(function (err) {
    console.error('[Cloud] 上传失败:', err);
    return null;
  });
}

/**
 * 从云存储下载文件
 * @param {string} fileID - 云存储 fileID
 * @returns {Promise<string|null>} 本地临时路径
 */
function downloadFile(fileID) {
  return wx.cloud.downloadFile({ fileID: fileID })
    .then(function (res) { return res.tempFilePath; })
    .catch(function (err) {
      console.error('[Cloud] 下载失败:', err);
      return null;
    });
}

/**
 * 上传导出文件到云存储
 * @param {string} localPath - 本地导出文件路径
 * @param {string} openid - 当前用户 openid
 * @param {string} fileName - 文件名（如 "客户A.xlsx"）
 * @returns {Promise<string|null>} fileID
 */
function uploadExportFile(localPath, openid, fileName) {
  var cloudPath = 'exports/' + openid + '/' + Date.now() + '_' + fileName;
  return uploadFile(localPath, cloudPath);
}

// ===== 云数据库 - 记录 CRUD =====

var db = null;
function _db() {
  if (!db) db = wx.cloud.database();
  return db;
}

/**
 * 同步一条记录到云端
 * @param {Object} record - 完整记录对象（含 id, values, imagePath 等）
 * @param {string} openid - 当前用户 openid
 * @param {boolean} [uploadImages=true] - 是否上传图片
 * @returns {Promise<Object>} { success, recordId, imageFileID }
 */
function syncRecord(record, openid, uploadImages) {
  if (uploadImages !== false) uploadImages = true;

  return _uploadRecordImages(record, openid, uploadImages).then(function (fileIDs) {
    var cloudData = {
      recordId: record.id,
      owner: openid,
      sharedWith: [],
      templateId: record.templateId,
      templateName: record.templateName,
      watermarkPosition: record.watermarkPosition,
      watermarkScale: record.watermarkScale,
      watermarkOpacity: record.watermarkOpacity,
      watermarkWidthRatio: record.watermarkWidthRatio,
      values: record.values,
      imageFileID: fileIDs.imageFileID || '',
      originalFileID: fileIDs.originalFileID || '',
      width: record.width,
      height: record.height,
      folderId: record.folderId || null,
      customName: record.customName || '',
      createdAt: record.createdAt,
      updatedAt: Date.now(),
      deletedAt: null,
      version: record.version || 1
    };

    // 检查云端是否存在
    return _db().collection('records').where({
      recordId: record.id,
      owner: openid
    }).get().then(function (res) {
      if (res.data && res.data.length > 0) {
        // 已存在 → 更新（先存历史快照）
        var existing = res.data[0];
        return _saveHistorySnapshot(existing, cloudData.values).then(function () {
          return _db().collection('records').doc(existing._id).update({ data: cloudData });
        }).then(function () {
          return { success: true, recordId: record.id, imageFileID: cloudData.imageFileID, action: 'updated' };
        });
      } else {
        // 不存在 → 新建
        return _db().collection('records').add({ data: cloudData }).then(function () {
          return { success: true, recordId: record.id, imageFileID: cloudData.imageFileID, action: 'created' };
        });
      }
    });
  });
}

/**
 * 上传记录关联的图片
 */
function _uploadRecordImages(record, openid, uploadImages) {
  var result = { imageFileID: null, originalFileID: null };
  if (!uploadImages) return Promise.resolve(result);

  var tasks = [];
  var basePath = 'photos/' + openid + '/' + record.id;

  if (record.imagePath) {
    tasks.push(
      uploadFile(record.imagePath, basePath + '_watermarked.jpg')
        .then(function (fid) { result.imageFileID = fid; })
    );
  }
  if (record.originalPath) {
    tasks.push(
      uploadFile(record.originalPath, basePath + '_original.jpg')
        .then(function (fid) { result.originalFileID = fid; })
    );
  }

  return Promise.all(tasks).then(function () { return result; });
}

/**
 * 保存历史快照到 records_history 集合
 */
function _saveHistorySnapshot(record, newValues) {
  var snapshot = JSON.parse(JSON.stringify(record));
  delete snapshot._id;
  return _db().collection('records_history').add({
    data: {
      recordId: record.recordId,
      owner: record.owner,
      version: (record.version || 1),
      snapshot: snapshot,
      changedAt: Date.now(),
      changeType: 'update',
      changeSummary: _buildChangeSummary(snapshot, newValues)
    }
  });
}

function _buildChangeSummary(snapshot, newValues) {
  if (!snapshot || !snapshot.values) return '更新了记录';
  if (!newValues) {
    var keys = Object.keys(snapshot.values).slice(0, 3);
    if (keys.length === 0) return '更新了记录';
    return '修改了 ' + keys.join('、') + (Object.keys(snapshot.values).length > 3 ? ' 等' : '');
  }
  var oldVals = snapshot.values || {};
  var changes = [];
  var seen = {};
  Object.keys(newValues).forEach(function (k) { seen[k] = true; });
  Object.keys(oldVals).forEach(function (k) { seen[k] = true; });
  Object.keys(seen).forEach(function (k) {
    var oldVal = oldVals[k] != null ? String(oldVals[k]) : '';
    var newVal = newValues[k] != null ? String(newValues[k]) : '';
    if (oldVal !== newVal) {
      changes.push(k + ': "' + (oldVal || '空') + '" → "' + (newVal || '空') + '"');
    }
  });
  if (changes.length === 0) return '更新了记录（字段未变化）';
  return changes.slice(0, 5).join('；') + (changes.length > 5 ? ' 等' + changes.length + '项变化' : '');
}

// ===== 从云端拉取变更 =====

/**
 * 从云端拉取变更到本地
 * @param {string} openid - 当前用户 openid
 * @param {number} lastSyncTime - 上次同步时间戳
 * @returns {Promise<Array>} 变更记录列表
 */
function fetchRemoteChanges(openid, lastSyncTime) {
  // 拉取自己的记录
  var myPromise = _db().collection('records')
    .where({
      owner: openid,
      deletedAt: null
    })
    .get();

  // 拉取被授权的记录
  var sharedPromise = _db().collection('records')
    .where({
      sharedWith: openid  // 这里需要更复杂的查询，实际用云函数处理
    })
    .get();

  return Promise.all([myPromise, sharedPromise]).then(function (results) {
    var merged = [];
    (results[0].data || []).forEach(function (d) {
      merged.push({
        _cloudOwner: d.owner,
        _permission: d.owner === openid ? 'readwrite' : null,
        _syncStatus: 'synced',
        id: d.recordId,
        templateId: d.templateId,
        templateName: d.templateName,
        values: d.values,
        imagePath: '',  // 图片需要单独下载
        width: d.width,
        height: d.height,
        createdAt: d.createdAt,
        customName: d.customName
      });
    });

    return merged;
  });
}

// ===== 软删除 =====

function softDelete(recordId, openid) {
  return _db().collection('records').where({
    recordId: recordId,
    owner: openid
  }).get().then(function (res) {
    if (!res.data || res.data.length === 0) throw new Error('记录不存在');
    var doc = res.data[0];
    return _saveHistorySnapshot(doc).then(function () {
      return _db().collection('records').doc(doc._id).update({
        data: { deletedAt: Date.now() }
      });
    });
  });
}

// ===== 授权管理 =====

/**
 * 授权其他用户
 * @param {string} recordId - 记录 ID
 * @param {string} targetOpenid - 被授权用户 openid
 * @param {string} permission - 'read' | 'write' | 'readwrite'
 * @param {string} ownerOpenid - 当前用户（授权者）openid
 */
function authorize(recordId, targetOpenid, permission, ownerOpenid) {
  return _db().collection('records').where({
    recordId: recordId,
    owner: ownerOpenid
  }).get().then(function (res) {
    if (!res.data || res.data.length === 0) throw new Error('记录不存在');
    var doc = res.data[0];
    var sharedWith = doc.sharedWith || [];
    // 去重
    var existing = sharedWith.findIndex(function (s) { return s.openid === targetOpenid; });
    var entry = { openid: targetOpenid, permission: permission, grantedAt: Date.now() };
    if (existing >= 0) {
      sharedWith[existing] = entry;
    } else {
      sharedWith.push(entry);
    }
    return _db().collection('records').doc(doc._id).update({
      data: { sharedWith: sharedWith }
    });
  });
}

/**
 * 撤回授权
 */
function revoke(recordId, targetOpenid, ownerOpenid) {
  return _db().collection('records').where({
    recordId: recordId,
    owner: ownerOpenid
  }).get().then(function (res) {
    if (!res.data || res.data.length === 0) throw new Error('记录不存在');
    var doc = res.data[0];
    var sharedWith = (doc.sharedWith || []).filter(function (s) {
      return s.openid !== targetOpenid;
    });
    return _db().collection('records').doc(doc._id).update({
      data: { sharedWith: sharedWith }
    });
  });
}

// ===== 同步开关管理 =====

/**
 * 读取云同步开关状态
 */
function isSyncEnabled() {
  try {
    return wx.getStorageSync('watermark_sync_enabled') === true;
  } catch (e) {
    return false;
  }
}

/**
 * 设置云同步开关
 */
function setSyncEnabled(enabled) {
  try {
    wx.setStorageSync('watermark_sync_enabled', !!enabled);
  } catch (e) {
    console.warn('[Cloud] 设置同步开关失败:', e);
  }
}

/**
 * 缓存 openid 到本地
 */
function _cacheOpenid(openid) {
  try {
    wx.setStorageSync('watermark_openid_cache', openid);
  } catch (e) {}
}

function _getCachedOpenid() {
  try {
    return wx.getStorageSync('watermark_openid_cache') || null;
  } catch (e) {
    return null;
  }
}

// ===== 从云端拉取变更到本地 =====

/**
 * 从云端拉取当前用户的记录，合并到本地 storage
 * @returns {Promise<number>} 拉取到的记录数
 */
function syncFromCloud() {
  var openid = _getCachedOpenid();
  if (!openid) {
    return getOpenid().then(function (oid) {
      if (!oid) { console.warn('[Cloud] syncFromCloud: 无法获取 openid'); return 0; }
      _cacheOpenid(oid);
      return _doSyncFromCloud(oid);
    });
  }
  return _doSyncFromCloud(openid);
}

function _doSyncFromCloud(openid) {
  console.log('[Cloud] 开始从云端拉取变更 for', openid);
  var storage = require('./storage.js');
  var _ = _db().command;

  // 同时查询非删除记录 + 已删除记录 + 文件夹 + 配置
  var nonDeletedPromise = _db().collection('records')
    .where({ owner: openid, deletedAt: null })
    .get();

  var lastSyncTime = storage.getLastSyncTime() || 0;
  // 只拉取上次同步之后新删除的记录（避免每次拉取全部历史删除）
  var deletedPromise = _db().collection('records')
    .where({ owner: openid, deletedAt: _.gt(lastSyncTime > 0 ? lastSyncTime : 0) })
    .get();

  // 拉取云端文件夹（非删除）
  var foldersPromise = _db().collection('folders')
    .where({ owner: openid, deletedAt: null })
    .get();

  // 拉取云端已删除的文件夹（增量）
  var foldersDeletedPromise = _db().collection('folders')
    .where({ owner: openid, deletedAt: _.gt(lastSyncTime > 0 ? lastSyncTime : 0) })
    .get();

  return Promise.all([nonDeletedPromise, deletedPromise, foldersPromise, foldersDeletedPromise]).then(function (results) {
    var remoteRecords = results[0].data || [];
    var deletedRecords = results[1].data || [];
    var cloudFolders = results[2].data || [];
    var cloudFoldersDeleted = results[3].data || [];

    var localRecords = storage.getAll();
    var localMap = {};
    localRecords.forEach(function (r) { localMap[r.id] = r; });

    var mergedCount = 0;
    var downloadTasks = [];
    var needsReload = false;
    var trashCount = 0;

    // === 1. 先处理云端已删除的记录 → 移入本地回收站 ===
    deletedRecords.forEach(function (r) {
      var localRec = localMap[r.recordId];
      if (localRec) {
        storage.moveToTrash(r.recordId);
        delete localMap[r.recordId]; // 已处理，不再进入下方非删除流程
        needsReload = true;
        trashCount++;
      }
    });

    // === 2. 处理非删除记录（云端有的本地补上，更新的覆盖） ===
    remoteRecords.forEach(function (r) {
      var localRec = localMap[r.recordId];
      if (!localRec) {
        // 云端有、本地无 → 新增到本地
        var newRecord = {
          id: r.recordId,
          templateId: r.templateId,
          templateName: r.templateName,
          watermarkPosition: r.watermarkPosition,
          watermarkScale: r.watermarkScale,
          watermarkOpacity: r.watermarkOpacity,
          watermarkWidthRatio: r.watermarkWidthRatio,
          values: r.values || {},
          imagePath: '',
          originalPath: '',
          _cloudFileId: r.imageFileID || '',
          _originalCloudFileId: r.originalFileID || '',
          width: r.width,
          height: r.height,
          folderId: r.folderId,
          customName: r.customName || '',
          createdAt: r.createdAt,
          _cloudOwner: r.owner,
          _permission: r.owner === openid ? 'readwrite' : null,
          _syncStatus: 'synced'
        };
        storage.add(newRecord);
        mergedCount++;
        needsReload = true;

        // 加入下载队列
        if (r.imageFileID) {
          downloadTasks.push(
            _downloadAndUpdate(r.recordId, r.imageFileID, r.originalFileID)
          );
        }
      } else if (r.updatedAt > (localRec.updatedAt || 0)) {
        storage.update(r.recordId, {
          templateId: r.templateId,
          templateName: r.templateName,
          values: r.values || {},
          folderId: r.folderId,
          customName: r.customName || '',
          _syncStatus: 'synced',
          _cloudFileId: r.imageFileID || '',
          _originalCloudFileId: r.originalFileID || ''
        });
        mergedCount++;
        needsReload = true;

        // 图片下载逻辑：云端有图片ID 且本地缺失或 fileID 变更 → 下载
        var downloadNeeded = r.imageFileID && (
          !localRec.imagePath ||
          !localRec._cloudFileId ||
          localRec._cloudFileId !== r.imageFileID
        );
        if (downloadNeeded) {
          downloadTasks.push(
            _downloadAndUpdate(r.recordId, r.imageFileID, r.originalFileID)
          );
        }
      }
    });

    // === 3. 合并云端文件夹（随照片同步开关一起） ===
    if (isSyncEnabled()) {
      var localFolders = storage.getAllFolders();
      var folderMap = {};      // keyed by folder.id
      var nameMap = {};        // keyed by folder.name
      localFolders.forEach(function (f) {
        folderMap[f.id] = f;
        if (f.name) nameMap[f.name] = f;
      });

      cloudFolders.forEach(function (cf) {
        if (folderMap[cf.folderId]) {
          // 云端 ID 在本地已存在 → 更新名称
          if (cf.updatedAt > (folderMap[cf.folderId].updatedAt || 0)) {
            storage.updateFolder(cf.folderId, { name: cf.name });
            needsReload = true;
          }
        } else if (nameMap[cf.name]) {
          // 同名但不同 ID → 可能是旧 bug 产生的重复，
          // 将所有引用旧 ID 的记录更新为云端 folderId，然后删除旧文件夹
          var dup = nameMap[cf.name];
          var allRecs = storage.getAll();
          allRecs.forEach(function (r) {
            if (r.folderId === dup.id) {
              storage.update(r.id, { folderId: cf.folderId });
            }
          });
          storage.removeFolder(dup.id);
          storage.addFolder(cf.name, cf.folderId);
          needsReload = true;
        } else {
          // 云端有、本地完全无 → 新增（保留云端 folderId，避免重复）
          storage.addFolder(cf.name, cf.folderId);
          needsReload = true;
        }
      });
    }

    // === 4. 处理云端已删除的文件夹 ===
    if (isSyncEnabled()) {
      cloudFoldersDeleted.forEach(function (cfd) {
        var localFolder = storage.getFolderById(cfd.folderId);
        if (localFolder) {
          // 将该文件夹下的记录移入未分类，然后删除本地文件夹
          var folderRecs = storage.getByFolderId(cfd.folderId);
          folderRecs.forEach(function (r) { storage.update(r.id, { folderId: null }); });
          storage.removeFolder(cfd.folderId);
          needsReload = true;
        }
      });
    }

    // === 5. 合并云端配置（走云函数，不依赖数据库集合） ===
    if (getConfigSyncEnabled()) {
      // 异步拉取，不阻塞后续流程
      pullConfigFromCloud(openid).then(function (changed) {
        if (changed) needsReload = true;
      });
    }

    storage.setLastSyncTime(Date.now());

    if (trashCount > 0) {
      console.log('[Cloud] 回收站处理:', trashCount, '条记录移入回收站');
    }

    // 等待图片全部下载完成
    var allDonePromise;
    if (downloadTasks.length > 0) {
      allDonePromise = Promise.all(downloadTasks).then(function (ds) {
        var ok = ds.filter(function (r) { return r; }).length;
        console.log('[Cloud] 图片下载完成:', ok, '/', ds.length, '张');
        return ok;
      });
    } else {
      allDonePromise = Promise.resolve(0);
    }

    return allDonePromise.then(function (imageCount) {
      console.log('[Cloud] 同步完成，合并了', mergedCount, '条记录，下载了', imageCount, '张图片');
      return { merged: mergedCount, images: imageCount, reload: needsReload || imageCount > 0 };
    });
  })
  .catch(function (err) {
    console.error('[Cloud] 从云端拉取失败:', err);
    return { merged: 0, images: 0, reload: false };
  });
}

/**
 * 下载云端图片并更新本地记录
 */
function _downloadAndUpdate(recordId, imageFileID, originalFileID) {
  var storage = require('./storage.js');
  var localRec = storage.getById(recordId);
  // 本地文件已存在且 cloudFileId 匹配 → 跳过下载
  if (localRec && localRec.imagePath && localRec._cloudFileId === imageFileID) {
    try {
      wx.getFileSystemManager().accessSync(localRec.imagePath);
      return Promise.resolve(true);
    } catch (e) {
      console.log('[Cloud] 本地文件已丢失，重新从云下载:', imageFileID);
    }
  }
  return downloadFile(imageFileID).then(function (localPath) {
    if (localPath) {
      storage.update(recordId, {
        imagePath: localPath,
        _cloudFileId: imageFileID,
        _originalCloudFileId: originalFileID || ''
      });
      if (originalFileID) {
        return downloadFile(originalFileID).then(function (origPath) {
          if (origPath) {
            storage.update(recordId, { originalPath: origPath });
          }
          return true;
        });
      }
      return true;
    }
    return false;
  }).catch(function (err) {
    console.warn('[Cloud] 下载图片失败:', recordId, err.message);
    return false;
  });
}

// ===== 文件夹同步 =====

/**
 * 同步一个文件夹到云端
 * @param {Object} folder - 文件夹对象 { id, name, createdAt }
 * @param {string} openid
 * @returns {Promise<Object>}
 */
function syncFolder(folder, openid) {
  if (!folder || !folder.id) return Promise.resolve({ success: false, error: '无数据' });
  var cloudData = {
    folderId: folder.id,
    owner: openid,
    name: folder.name,
    createdAt: folder.createdAt || Date.now(),
    updatedAt: Date.now(),
    deletedAt: null
  };
  return _db().collection('folders').where({
    folderId: folder.id,
    owner: openid
  }).get().then(function (res) {
    if (res.data && res.data.length > 0) {
      return _db().collection('folders').doc(res.data[0]._id).update({ data: cloudData });
    } else {
      return _db().collection('folders').add({ data: cloudData });
    }
  }).then(function () {
    return { success: true };
  }).catch(function (err) {
    console.warn('[Cloud] 同步文件夹失败:', err);
    return { success: false, error: err.message };
  });
}

/**
 * 软删除文件夹（云端标记 deletedAt）
 */
function softDeleteFolder(folderId, openid) {
  return _db().collection('folders').where({
    folderId: folderId,
    owner: openid
  }).get().then(function (res) {
    if (res.data && res.data.length > 0) {
      return _db().collection('folders').doc(res.data[0]._id).update({
        data: { deletedAt: Date.now() }
      });
    }
  }).catch(function (err) {
    console.warn('[Cloud] 软删除文件夹失败:', err);
  });
}

/**
 * 从云端拉取文件夹并合并到本地
 */
function _mergeCloudFolders(openid) {
  var storage = require('./storage.js');
  return _db().collection('folders').where({
    owner: openid,
    deletedAt: null
  }).get().then(function (res) {
    var cloudFolders = res.data || [];
    if (cloudFolders.length === 0) return 0;

    var localFolders = storage.getAllFolders();
    var localMap = {};    // keyed by folder.id
    var nameMap = {};     // keyed by folder.name
    localFolders.forEach(function (f) {
      localMap[f.id] = f;
      if (f.name) nameMap[f.name] = f;
    });

    var merged = 0;
    cloudFolders.forEach(function (cf) {
      if (localMap[cf.folderId]) {
        // 云端 ID 已存在 → 更新名称
        if (cf.updatedAt > (localMap[cf.folderId].updatedAt || 0)) {
          storage.updateFolder(cf.folderId, { name: cf.name });
          merged++;
        }
      } else if (nameMap[cf.name]) {
        // 同名不同 ID → 旧 bug 重复，清理
        var dup = nameMap[cf.name];
        var allRecs = storage.getAll();
        allRecs.forEach(function (r) {
          if (r.folderId === dup.id) storage.update(r.id, { folderId: cf.folderId });
        });
        storage.removeFolder(dup.id);
        storage.addFolder(cf.name, cf.folderId);
        merged++;
      } else {
        // 新增
        storage.addFolder(cf.name, cf.folderId);
        merged++;
      }
    });
    return merged;
  }).catch(function (err) {
    console.warn('[Cloud] 拉取文件夹失败:', err);
    return 0;
  });
}

// ===== 配置同步 =====

/**
 * 读取配置同步开关
 */
function getConfigSyncEnabled() {
  try {
    return wx.getStorageSync('watermark_config_sync_enabled') === true;
  } catch (e) {
    return false;
  }
}

/**
 * 设置配置同步开关
 */
function setConfigSyncEnabled(enabled) {
  try {
    wx.setStorageSync('watermark_config_sync_enabled', !!enabled);
  } catch (e) {
    console.warn('[Cloud] 设置配置同步开关失败:', e);
  }
}

/**
 * 上传用户配置到云端
 * 包括：自动保存设置、自定义模板、自定义词典
 */
function syncConfig(openid) {
  var storage = require('./storage.js');

  // 收集所有配置项（含翻译引擎、词典等）
  var translatorConfig, translatorProfiles, translatorPrompt, freeDict, customDict, customWhitelist;
  try { translatorConfig = wx.getStorageSync('watermark_translator_config'); } catch (e) {}
  try { translatorProfiles = wx.getStorageSync('watermark_translator_profiles'); } catch (e) {}
  try { translatorPrompt = wx.getStorageSync('watermark_translator_prompt'); } catch (e) {}
  try { freeDict = wx.getStorageSync('watermark_free_dict'); } catch (e) {}
  try { customDict = wx.getStorageSync('watermark_custom_dict'); } catch (e) {}
  try { customWhitelist = wx.getStorageSync('watermark_custom_whitelist'); } catch (e) {}

  var config = {
    // 基本设置
    autoSaveAlbum: storage.getAutoSaveAlbum(),
    autoSaveEditAlbum: storage.getAutoSaveEditAlbum(),
    customTemplates: storage.getCustomTemplates(),
    // 翻译引擎配置
    translatorConfig: translatorConfig || null,
    translatorProfiles: translatorProfiles || null,
    translatorPrompt: translatorPrompt || null,
    freeDict: freeDict || null,
    // 词典/白名单
    customDict: customDict || null,
    customWhitelist: customWhitelist || null
  };
  return wx.cloud.callFunction({
    name: 'userConfig',
    data: { action: 'push', config: config }
  }).then(function (res) {
    var ok = res.result && res.result.success;
    if (ok && res.result.updatedAt) {
      try { wx.setStorageSync('watermark_config_updated_at', res.result.updatedAt); } catch (e) {}
    }
    return ok ? { success: true } : { success: false, error: '上传失败' };
  }).catch(function (err) {
    console.warn('[Cloud] 同步配置失败:', err);
    return { success: false, error: err.message };
  });
}

/**
 * 从云端拉取用户配置并合并到本地（走云函数，不依赖数据库集合）
 */
function pullConfigFromCloud(openid) {
  var storage = require('./storage.js');
  return wx.cloud.callFunction({
    name: 'userConfig',
    data: { action: 'pull' }
  }).then(function (res) {
    if (res.result && res.result.success && res.result.config) {
      var cloudConfig = res.result.config;
      if (!cloudConfig.updatedAt) return false;

      // 比较时间戳，云端更新则覆盖
      var localUpdatedAt = 0;
      try { localUpdatedAt = wx.getStorageSync('watermark_config_updated_at') || 0; } catch (e) {}
      if (cloudConfig.updatedAt > localUpdatedAt) {
        // 基本设置
        if (cloudConfig.autoSaveAlbum != null) storage.setAutoSaveAlbum(cloudConfig.autoSaveAlbum);
        if (cloudConfig.autoSaveEditAlbum != null) storage.setAutoSaveEditAlbum(cloudConfig.autoSaveEditAlbum);
        // 全量替换自定义模板（非增量添加），确保云端删除的模板本地也被移除
        if (cloudConfig.customTemplates) {
          storage.setCustomTemplates(cloudConfig.customTemplates);
        }
        // 翻译引擎配置
        if (cloudConfig.translatorConfig != null) {
          try { wx.setStorageSync('watermark_translator_config', cloudConfig.translatorConfig); } catch (e) {}
        }
        if (cloudConfig.translatorProfiles != null) {
          try { wx.setStorageSync('watermark_translator_profiles', cloudConfig.translatorProfiles); } catch (e) {}
        }
        if (cloudConfig.translatorPrompt != null) {
          try { wx.setStorageSync('watermark_translator_prompt', cloudConfig.translatorPrompt); } catch (e) {}
        }
        if (cloudConfig.freeDict != null) {
          try { wx.setStorageSync('watermark_free_dict', cloudConfig.freeDict); } catch (e) {}
        }
        // 词典/白名单
        if (cloudConfig.customDict != null) {
          try { wx.setStorageSync('watermark_custom_dict', cloudConfig.customDict); } catch (e) {}
        }
        if (cloudConfig.customWhitelist != null) {
          try { wx.setStorageSync('watermark_custom_whitelist', cloudConfig.customWhitelist); } catch (e) {}
        }
        try { wx.setStorageSync('watermark_config_updated_at', cloudConfig.updatedAt); } catch (e) {}
        return true;
      }
    }
    return false;
  }).catch(function (err) {
    console.warn('[Cloud] 拉取配置失败:', err);
    return false;
  });
}

/**
 * 快速推送当前配置到云端（配置变更时调用）
 */
function pushConfigChanges(openid) {
  if (!getConfigSyncEnabled()) return Promise.resolve(false);
  return syncConfig(openid).then(function (res) { return res.success; });
}

// ===== 云端导出记录（走云函数，无需安全规则） =====

/**
 * 保存导出记录到云端（跨设备可见）
 */
function saveExportRecordToCloud(openid, fileID, fileName) {
  return wx.cloud.callFunction({
    name: 'exportRecords',
    data: { action: 'save', fileID: fileID, fileName: fileName }
  }).then(function (res) {
    var ok = res.result && res.result.success;
    console.log('[Cloud] 导出记录保存' + (ok ? '成功' : '失败') + ':', fileName);
    return ok;
  }).catch(function (err) {
    console.warn('[Cloud] 保存导出记录失败:', err);
    return false;
  });
}

/**
 * 从云端拉取当前用户的导出记录
 */
function fetchExportRecordsFromCloud(openid) {
  return wx.cloud.callFunction({
    name: 'exportRecords',
    data: { action: 'list' }
  }).then(function (res) {
    if (res.result && res.result.success && res.result.records) {
      return res.result.records;
    }
    return [];
  }).catch(function (err) {
    console.warn('[Cloud] 拉取导出记录失败:', err);
    return [];
  });
}

/**
 * 从云端删除导出记录（跨设备同步删除 + 删除云存储文件）
 * @param {string} fileID
 * @returns {Promise<boolean>}
 */
function deleteExportRecordFromCloud(fileID) {
  return wx.cloud.callFunction({
    name: 'exportRecords',
    data: { action: 'delete', fileID: fileID }
  }).then(function (res) {
    return !!(res.result && res.result.success);
  }).catch(function (err) {
    console.warn('[Cloud] 删除导出记录失败:', err);
    return false;
  });
}

/**
 * 通过云函数授权其他用户
 */
function callAuthorize(recordId, targetOpenid, permission) {
  return wx.cloud.callFunction({
    name: 'authorize',
    data: { recordId: recordId, targetOpenid: targetOpenid, permission: permission }
  }).then(function (res) {
    return res.result;
  }).catch(function (err) {
    console.error('[Cloud] callAuthorize 失败:', err);
    return { success: false, error: err.message };
  });
}

/**
 * 通过云函数撤回授权
 * @param {string} recordId
 * @param {string} targetOpenid
 * @returns {Promise<Object>}
 */
function callRevoke(recordId, targetOpenid) {
  return wx.cloud.callFunction({
    name: 'revoke',
    data: { recordId: recordId, targetOpenid: targetOpenid }
  }).then(function (res) {
    return res.result;
  }).catch(function (err) {
    console.error('[Cloud] callRevoke 失败:', err);
    return { success: false, error: err.message };
  });
}

/**
 * 通过分享卡片自动授权（不依赖 openid 输入）
 * @param {string} recordId
 * @param {string} permission - 'read' | 'write' | 'readwrite'
 * @returns {Promise<Object>}
 */
function callAuthorizeByShare(recordId, permission) {
  return wx.cloud.callFunction({
    name: 'authorizeByShare',
    data: { recordId: recordId, permission: permission }
  }).then(function (res) {
    return res.result;
  }).catch(function (err) {
    console.error('[Cloud] callAuthorizeByShare 失败:', err);
    return { success: false, error: err.message };
  });
}

/**
 * 获取记录的已授权用户列表
 * @param {string} recordId
 * @returns {Promise<Array>}
 */
function getAuthorizedList(recordId) {
  var openid = _getCachedOpenid();
  if (!openid) {
    return getOpenid().then(function (oid) {
      if (!oid) return [];
      _cacheOpenid(oid);
      return _doGetAuthorizedList(recordId, oid);
    });
  }
  return _doGetAuthorizedList(recordId, openid);
}

function _doGetAuthorizedList(recordId, openid) {
  return _db().collection('records')
    .where({ recordId: recordId, owner: openid })
    .get()
    .then(function (res) {
      if (!res.data || res.data.length === 0) return [];
      return res.data[0].sharedWith || [];
    })
    .catch(function (err) {
      console.error('[Cloud] getAuthorizedList 失败:', err);
      return [];
    });
}

/**
 * 批量分享记录到目标用户
 * @param {Array} recordIds
 * @param {string} targetOpenid
 * @param {string} permission
 * @param {Object} [recordsMap] - 可选，本地记录数据映射 { recordId: {...} }
 * @returns {Promise<Object>}
 */
function batchShareRecords(recordIds, targetOpenid, permission, recordsMap) {
  return wx.cloud.callFunction({
    name: 'batchShareRecords',
    data: {
      recordIds: recordIds,
      targetOpenid: targetOpenid,
      permission: permission,
      records: recordsMap || {}
    }
  }).then(function (res) {
    return res.result;
  }).catch(function (err) {
    console.error('[Cloud] batchShareRecords 失败:', err);
    return { success: false, error: err.message };
  });
}

// ===== 从云端获取单条记录数据 =====

/**
 * 从云端获取指定记录的完整数据（含 imageFileID）
 * @param {string} recordId
 * @returns {Promise<Object|null>}
 */
function fetchCloudRecord(recordId) {
  var openid = _getCachedOpenid();
  if (!openid) {
    return getOpenid().then(function (oid) {
      if (!oid) return null;
      _cacheOpenid(oid);
      return _doFetchCloudRecord(recordId, oid);
    });
  }
  return _doFetchCloudRecord(recordId, openid);
}

function _doFetchCloudRecord(recordId, openid) {
  return _db().collection('records')
    .where({ recordId: recordId, owner: openid })
    .get()
    .then(function (res) {
      if (!res.data || res.data.length === 0) return null;
      return res.data[0];
    })
    .catch(function () { return null; });
}

// ===== 时光机 =====

/**
 * 获取指定记录的历史版本列表
 * @param {string} recordId
 * @returns {Promise<Array>} 按版本降序排列的历史快照
 */
function getHistory(recordId) {
  return _db().collection('records_history')
    .where({ recordId: recordId })
    .orderBy('version', 'desc')
    .get()
    .then(function (res) {
      return (res.data || []).map(function (h) {
        return {
          version: h.version,
          snapshot: h.snapshot,
          changedAt: h.changedAt,
          changeType: h.changeType,
          changeSummary: h.changeSummary || '更新了记录'
        };
      });
    })
    .catch(function (err) {
      console.error('[Cloud] getHistory 失败:', err);
      return [];
    });
}

/**
 * 回滚到指定历史版本
 * @param {string} recordId
 * @param {Object} snapshot - 历史快照对象
 * @returns {Promise<Object>}
 */
function restoreVersion(recordId, snapshot) {
  // 查找当前记录
  return _db().collection('records')
    .where({ recordId: recordId })
    .get()
    .then(function (res) {
      if (!res.data || res.data.length === 0) {
        throw new Error('记录不存在');
      }
      var doc = res.data[0];
      // 保存当前版本到历史（作为回滚前的快照）
      return _saveHistorySnapshot(doc).then(function () {
        // 用快照数据覆盖当前记录
        var patch = {
          values: snapshot.values || {},
          updatedAt: Date.now(),
          version: (snapshot.version || 0) + 1,
          templateId: snapshot.templateId || doc.templateId,
          templateName: snapshot.templateName || doc.templateName,
          watermarkPosition: snapshot.watermarkPosition || doc.watermarkPosition,
          watermarkScale: snapshot.watermarkScale || doc.watermarkScale,
          customName: snapshot.customName || doc.customName
        };
        return _db().collection('records').doc(doc._id).update({ data: patch });
      });
    })
    .then(function () {
      return { success: true };
    })
    .catch(function (err) {
      console.error('[Cloud] restoreVersion 失败:', err);
      return { success: false, error: err.message };
    });
}

module.exports = {
  CLOUD_ENV: CLOUD_ENV,
  init: init,
  getOpenid: getOpenid,
  uploadFile: uploadFile,
  downloadFile: downloadFile,
  uploadExportFile: uploadExportFile,
  syncRecord: syncRecord,
  fetchRemoteChanges: fetchRemoteChanges,
  softDelete: softDelete,
  authorize: authorize,
  revoke: revoke,
  // 云函数版授权
  callAuthorize: callAuthorize,
  callRevoke: callRevoke,
  callAuthorizeByShare: callAuthorizeByShare,
  getAuthorizedList: getAuthorizedList,
  batchShareRecords: batchShareRecords,
  // 同步开关
  isSyncEnabled: isSyncEnabled,
  setSyncEnabled: setSyncEnabled,
  // 文件夹同步
  syncFolder: syncFolder,
  softDeleteFolder: softDeleteFolder,
  // 配置同步
  getConfigSyncEnabled: getConfigSyncEnabled,
  setConfigSyncEnabled: setConfigSyncEnabled,
  syncConfig: syncConfig,
  pullConfigFromCloud: pullConfigFromCloud,
  pushConfigChanges: pushConfigChanges,
  // 云端导出记录
  saveExportRecordToCloud: saveExportRecordToCloud,
  fetchExportRecordsFromCloud: fetchExportRecordsFromCloud,
  deleteExportRecordFromCloud: deleteExportRecordFromCloud,
  // 拉取
  syncFromCloud: syncFromCloud,
  fetchCloudRecord: fetchCloudRecord,
  // 时光机
  getHistory: getHistory,
  restoreVersion: restoreVersion,
  // 内部（供设置页使用）
  _getCachedOpenid: _getCachedOpenid
};

