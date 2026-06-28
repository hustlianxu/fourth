// pages/settings/settings.js
const cloud = require('../../utils/cloud.js');
const storage = require('../../utils/storage.js');

Page({
  data: {
    syncEnabled: false,
    configSyncEnabled: false,
    openid: '',
    lastSyncText: '',
    syncing: false,
    exports: [],
    navTotalHeight: 0,
    exporting: false
  },


  onShow() {
    this.load();
  },

  load() {
    var that = this;
    var localExports = storage.getExportRecords();
    var oid = cloud._getCachedOpenid ? cloud._getCachedOpenid() : '';

    this.setData({
      syncEnabled: storage.getSyncEnabled(),
      configSyncEnabled: storage.getConfigSyncEnabled(),
      openid: oid,
      lastSyncText: this._formatLastSync(storage.getLastSyncTime()),
      exports: localExports
    });

    // 配置同步开启时，自动拉取云端配置
    if (storage.getConfigSyncEnabled() && oid) {
      cloud.pullConfigFromCloud(oid).then(function (changed) {
        if (changed) {
          // 配置有更新，刷新当前设置显示
          that.setData({
            syncEnabled: storage.getSyncEnabled(),
            configSyncEnabled: storage.getConfigSyncEnabled()
          });
          wx.showToast({ title: '已同步云端配置', icon: 'success', duration: 1500 });
        }
      });
    }

    // 从云端拉取导出记录（跨设备可见）
    if (oid) {
      cloud.fetchExportRecordsFromCloud(oid).then(function (cloudExports) {
        if (cloudExports.length === 0) return;
        var seen = {};
        var merged = cloudExports.slice();
        merged.forEach(function (e) { seen[e.fileID] = true; });
        localExports.forEach(function (e) {
          if (!seen[e.fileID]) {
            merged.push(e);
            seen[e.fileID] = true;
          }
        });
        that.setData({ exports: merged });
      }).catch(function () {});
    }
  },

  onSyncToggle(e) {
    var enabled = e.detail.value;
    storage.setSyncEnabled(enabled);
    this.setData({ syncEnabled: enabled });

    if (enabled) {
      var that = this;
      cloud.getOpenid().then(function (oid) {
        if (oid) {
          try {
            wx.setStorageSync('watermark_openid_cache', oid);
          } catch (e) {}
          that.setData({ openid: oid });
        }
      });
    }
  },

  onConfigSyncToggle(e) {
    var enabled = e.detail.value;
    var that = this;
    storage.setConfigSyncEnabled(enabled);
    this.setData({ configSyncEnabled: enabled });

    if (enabled) {
      // 开启时立即获取 openid 并上传当前配置
      var oid = cloud._getCachedOpenid();
      if (!oid) {
        cloud.getOpenid().then(function (oid2) {
          if (oid2) {
            try { wx.setStorageSync('watermark_openid_cache', oid2); } catch (e) {}
            that.setData({ openid: oid2 });
            cloud.syncConfig(oid2);
          }
        });
      } else {
        that.setData({ openid: oid });
        cloud.syncConfig(oid);
      }
    }
  },

  onManualSync() {
    var that = this;
    this.setData({ syncing: true });
    wx.showLoading({ title: '同步中...', mask: true });

    cloud.syncFromCloud().then(function (result) {
      wx.hideLoading();
      that.setData({
        syncing: false,
        lastSyncText: that._formatLastSync(storage.getLastSyncTime())
      });
      var count = result ? (result.merged || 0) : 0;
      wx.showToast({ title: '同步完成' + (count > 0 ? '，' + count + ' 条更新' : ''), icon: 'success', duration: 2000 });
    }).catch(function (err) {
      wx.hideLoading();
      that.setData({ syncing: false });
      wx.showToast({ title: '同步失败', icon: 'none' });
      console.error('[Settings] 同步失败:', err);
    });
  },

  // ===== 云端导出文件 =====

  onDownloadExport(e) {
    var fileID = e.currentTarget.dataset.fileid;
    var fileName = e.currentTarget.dataset.filename || 'export.xlsx';
    var that = this;

    wx.showLoading({ title: '下载中...', mask: true });
    cloud.downloadFile(fileID).then(function (localPath) {
      if (localPath) {
        var fs = wx.getFileSystemManager();
        var destPath = wx.env.USER_DATA_PATH + '/' + fileName;
        try {
          fs.copyFileSync(localPath, destPath);
        } catch (copyErr) {
          console.warn('[Settings] copyFileSync 失败:', copyErr);
          destPath = localPath;
        }
        wx.hideLoading();
        wx.openDocument({
          filePath: destPath,
          fileType: 'xlsx',
          showMenu: true,
          success: function () {},
          fail: function () {
            wx.showToast({ title: '打开文件失败', icon: 'none' });
          }
        });
      } else {
        wx.hideLoading();
        wx.showToast({ title: '下载失败，文件可能已过期', icon: 'none' });
      }
    }).catch(function (err) {
      wx.hideLoading();
      console.error('[Settings] 下载导出文件失败:', err);
      wx.showToast({ title: '下载失败: ' + ((err && err.message) || '').slice(0, 15), icon: 'none' });
    });
  },

  onDeleteExport(e) {
    var fileID = e.currentTarget.dataset.fileid;
    var fileName = e.currentTarget.dataset.filename || '';
    var that = this;
    wx.showModal({
      title: '删除记录',
      content: '确定要删除「' + fileName + '」吗？将从所有设备删除，云存储文件30天后自动清理。',
      success: function (res) {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...', mask: true });
          var deletePromise = cloud.deleteExportRecordFromCloud(fileID);
          storage.removeExportRecord(fileID);
          deletePromise.then(function () {
            wx.hideLoading();
            that.setData({ exports: storage.getExportRecords() });
            setTimeout(function () { that.load(); }, 500);
          }).catch(function () {
            wx.hideLoading();
            that.setData({ exports: storage.getExportRecords() });
          });
        }
      }
    });
  },

  _formatLastSync(ts) {
    if (!ts) return '';
    var date = new Date(ts);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
      + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  },

  onNavReady(e) {
    this.setData({ navTotalHeight: e.detail.totalNavBarHeight });
  },

});
