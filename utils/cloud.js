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

  return _db().collection('records')
    .where({
      owner: openid,
      deletedAt: null
    })
    .get()
    .then(function (res) {
      var remoteRecords = res.data || [];
      if (remoteRecords.length === 0) {
        console.log('[Cloud] 云端无记录');
        return { merged: 0, images: 0 };
      }

      var localRecords = storage.getAll();
      var localMap = {};
      localRecords.forEach(function (r) { localMap[r.id] = r; });

      var mergedCount = 0;
      var downloadTasks = [];
      var needsReload = false;  // 是否需要前端刷新列表

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
            _syncStatus: 'synced'
          });
          mergedCount++;
          needsReload = true;

          // 本地无水印图或云端有更新 → 下载
          if (!localRec.imagePath && r.imageFileID) {
            downloadTasks.push(
              _downloadAndUpdate(r.recordId, r.imageFileID, r.originalFileID)
            );
          }
        }
      });

      storage.setLastSyncTime(Date.now());

      // 等待图片全部下载完成
      var allDonePromise;
      if (downloadTasks.length > 0) {
        allDonePromise = Promise.all(downloadTasks).then(function (results) {
          var ok = results.filter(function (r) { return r; }).length;
          console.log('[Cloud] 图片下载完成:', ok, '/', results.length, '张');
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
  return downloadFile(imageFileID).then(function (localPath) {
    if (localPath) {
      storage.update(recordId, { imagePath: localPath });
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

// ===== 授权管理（云函数版） =====

/**
 * 通过云函数授权其他用户
 * @param {string} recordId
 * @param {string} targetOpenid
 * @param {string} permission - 'read' | 'write' | 'readwrite'
 * @returns {Promise<Object>}
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
  syncRecord: syncRecord,
  fetchRemoteChanges: fetchRemoteChanges,
  softDelete: softDelete,
  authorize: authorize,
  revoke: revoke,
  // 云函数版授权
  callAuthorize: callAuthorize,
  callRevoke: callRevoke,
  getAuthorizedList: getAuthorizedList,
  batchShareRecords: batchShareRecords,
  // 同步开关
  isSyncEnabled: isSyncEnabled,
  setSyncEnabled: setSyncEnabled,
  // 拉取
  syncFromCloud: syncFromCloud,
  fetchCloudRecord: fetchCloudRecord,
  // 时光机
  getHistory: getHistory,
  restoreVersion: restoreVersion,
  // 内部（供设置页使用）
  _getCachedOpenid: _getCachedOpenid
};

