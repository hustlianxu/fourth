// pages/list/list.js
const storage = require('../../utils/storage.js');
const templates = require('../../utils/templates.js');
const exporter = require('../../utils/exporter.js');
const cloud = require('../../utils/cloud.js');
const translator = require('../../utils/translator.js');

const MAX_FOLDERS = 30;

/**
 * 检查本地文件是否存在
 */
function _checkFileExists(filePath) {
  if (!filePath) return false;
  try {
    wx.getFileSystemManager().accessSync(filePath);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 从云端下载图片并更新列表记录
 * @param {Object} pc - {count: N} 可变的 pending 计数器引用
 */
function _downloadCloudImage(item, listIdx, pending, pc, that, token, flush) {
  if (token !== that._fillToken) { if (pc) pc.count--; return; }
  const cloud = require('../../utils/cloud.js');
  cloud.downloadFile(item._cloudFileId).then(function (localPath) {
    if (token !== that._fillToken) { if (pc) pc.count--; return; }
    if (localPath) {
      storage.update(item.id, { imagePath: localPath });
      pending['list[' + listIdx + '].imagePath'] = localPath;
      const fs = wx.getFileSystemManager();
      fs.getFileInfo({
        filePath: localPath,
        success: function (res) {
          if (token !== that._fillToken) return;
          var size = res.size || 0;
          var kb;
          if (size >= 1048576) {
            kb = (size / 1048576).toFixed(1) + 'MB';
          } else if (size > 1024) {
            kb = (size / 1024).toFixed(0) + 'KB';
          } else {
            kb = size + 'B';
          }
          pending['list[' + listIdx + '].sizeText'] = item.metaText ? (item.metaText + ' · ' + kb) : ('· ' + kb);
          if (--pc.count <= 0) flush();
        },
        fail: function () {
          if (token !== that._fillToken) return;
          if (item.metaText) pending['list[' + listIdx + '].sizeText'] = item.metaText;
          if (--pc.count <= 0) flush();
        }
      });
      return;
    }
    if (item.metaText) pending['list[' + listIdx + '].sizeText'] = item.metaText;
    if (--pc.count <= 0) flush();
  });
}

// 左滑操作按钮总宽度（4个按钮 × 70px ≈ 280px）
const SWIPE_ACTION_WIDTH = 280;
// 右滑选中触发阈值（px）
const SWIPE_SELECT_THRESHOLD = 60;

// 分页相关：每页记录数、当前已渲染页数、是否还有更多、是否正在加载更多
const PAGE_SIZE = 20;

// touchmove 节流间隔（ms），避免高频 setData 拖垮渲染
const SWIPE_THROTTLE_MS = 16;

Page({
  data: {
    list: [],
    folders: [],
    loading: true,
    activeFolderId: null,        // null=全部, '__uncategorized__'=未分类, 其他=folder.id（普通模式使用）
    totalCount: 0,
    filteredCount: 0,
    uncategorizedCount: 0,
    // 分页：list 仅渲染前 _renderedCount 条，onReachBottom 追加
    hasMore: false,
    loadingMore: false,
    // 导出模式
    exportMode: false,
    selectedCount: 0,
    selectedFolderIds: [],         // 导出模式下选中的文件夹ID列表，'__uncategorized__'=未分类
    allFoldersSelected: false,     // 导出模式下是否已全选所有文件夹
    uncategorizedExportSelected: false, // 导出模式下未分类是否选中
    // 文件夹创建/重命名弹层
    showFolderModal: false,
    editingFolderId: null,
    folderNameInput: '',
    // 记录重命名弹层
    showRenameModal: false,
    renameRecordId: '',
    renameInput: '',
    // 导出文件名弹层
    showExportNameModal: false,
    exportFileName: '',
    // 文件夹选择器底部弹层（移动/复制）
    showFolderPicker: false,
    pickerMode: '',
    pickerRecordId: '',
    // 删除文件夹确认弹层
    showDeleteFolderModal: false,
    deleteFolderId: '',
    deleteFolderName: '',
    deleteFolderCount: 0,
    // 批量选择模式（右滑触发，与导出模式独立）
    batchMode: false,
    batchSelectedCount: 0,
    showBatchDeleteModal: false,
    // 搜索：普通模式下按货号/描述/价格/体积等 values 字段 + 自定义名/模板名模糊匹配
    searchKeyword: '',     // 实际生效的搜索关键词（防抖后落地）
    searchInput: '',       // 输入框实时值（受控）
    searchActive: false,   // 是否处于搜索态（输入框有焦点或有关键词）
    // 回收站
    trashMode: false,
    trashList: [],
    navTotalHeight: 0,
    trashCount: 0,
  },

  onShow() {
    this._loadFolders();
    this._loadList();
    // 模拟短暂加载状态（让骨架屏可见）
    setTimeout(() => this.setData({ loading: false }), 300);
    // 同步开启时从云端拉取变更
    if (cloud.isSyncEnabled()) {
      var that = this;
      cloud.syncFromCloud().then(function (result) {
        if (result && result.reload) {
          if (that && that._loadList) {
            that._loadFolders();
            that._loadList();
          }
        }
      });
    }
  },

  // ===== 左滑/右滑手势状态 =====
  _swipeStartX: 0,
  _swipeStartY: 0,
  _swipeRecordId: '',
  _swipeStartSwipeX: 0,
  _swipeMoved: false,
  _swipeDirection: '',  // 'left' 左滑操作 | 'right' 右滑选中

  // 记录卡片触摸开始
  onRecordTouchStart(e) {
    if (this.data.exportMode) return;
    const id = e.currentTarget.dataset.id;
    this._swipeStartX = e.touches[0].clientX;
    this._swipeStartY = e.touches[0].clientY;
    this._swipeRecordId = id;
    this._swipeMoved = false;
    this._swipeDirection = '';
    this._lastSwipeDx = null;
    this._lastSwipeNewX = null;
    this._lastSwipeMoveTs = 0;
    const record = this.data.list.find(r => r.id === id);
    this._swipeStartSwipeX = record ? record._swipeX : 0;
  },

  // 记录卡片触摸移动
  onRecordTouchMove(e) {
    if (this.data.exportMode) return;
    if (!this._swipeRecordId) return;
    const dx = e.touches[0].clientX - this._swipeStartX;
    const dy = e.touches[0].clientY - this._swipeStartY;
    // 水平滑动为主才处理
    if (Math.abs(dx) < Math.abs(dy)) return;
    this._swipeMoved = true;
    // 确定方向（首次移动时锁定）
    if (!this._swipeDirection) {
      this._swipeDirection = dx > 0 ? 'right' : 'left';
    }

    if (this._swipeDirection === 'right') {
      // 右滑：选中流程，不移动卡片
      return;
    }

    // 左滑：展开操作按钮（仅普通模式）
    if (this.data.batchMode) return;
    // 始终缓存最新 dx，供 touchEnd 兜底重算（节流丢帧时 _swipeX 可能过期）
    let newX = this._swipeStartSwipeX - dx;
    newX = Math.max(0, Math.min(newX, SWIPE_ACTION_WIDTH));
    this._lastSwipeDx = dx;
    this._lastSwipeNewX = newX;
    // 节流：两次 setData 间隔不小于 SWIPE_THROTTLE_MS，避免高频 setData 拖垮渲染
    const now = Date.now();
    if (this._lastSwipeMoveTs && now - this._lastSwipeMoveTs < SWIPE_THROTTLE_MS) return;
    this._lastSwipeMoveTs = now;
    this._updateRecordSwipe(this._swipeRecordId, { _swipeX: newX, _swiping: true, _swipeAnim: false, _swipeActionsW: SWIPE_ACTION_WIDTH });
  },

  // 记录卡片触摸结束
  onRecordTouchEnd() {
    if (this.data.exportMode) return;
    if (!this._swipeRecordId) return;
    const record = this.data.list.find(r => r.id === this._swipeRecordId);
    if (!record) {
      this._swipeRecordId = '';
      this._swipeDirection = '';
      return;
    }
    const direction = this._swipeDirection;
    this._swipeRecordId = '';
    this._swipeDirection = '';

    // 右滑：选中流程
    if (direction === 'right' && this._swipeMoved) {
      // 左滑展开状态下右滑 → 先收起回原位，不触发选中
      if (this._swipeStartSwipeX > 0) {
        this._updateRecordSwipe(record.id, { _swipeX: 0, _swiping: false, _swipeAnim: true, _swipeActionsW: 0 });
        return;
      }
      // 原位右滑 → 切换选中态（已进入选中态）或进入选中态
      if (this.data.batchMode) {
        this.onBatchToggle({ currentTarget: { dataset: { id: record.id } } });
      } else {
        this._enterBatchAndToggle(record.id);
      }
      return;
    }

    // 左滑：滑动超过一半则展开，否则收起（仅普通模式）
    if (this.data.batchMode) return;
    const threshold = SWIPE_ACTION_WIDTH / 2;
    // 节流丢帧时 record._swipeX 可能是过期值，用缓存的末次位移兜底重算
    const lastNewX = (typeof this._lastSwipeNewX === 'number') ? this._lastSwipeNewX : record._swipeX;
    const finalX = lastNewX >= threshold ? SWIPE_ACTION_WIDTH : 0;
    this._lastSwipeDx = null;
    this._lastSwipeNewX = null;
    this._updateRecordSwipe(record.id, { _swipeX: finalX, _swiping: false, _swipeAnim: true, _swipeActionsW: finalX });
  },

  // 更新单条记录的滑动状态（路径式 setData，避免重建整个 list 数组导致抖动）
  _updateRecordSwipe(id, patch) {
    const idx = this.data.list.findIndex(r => r.id === id);
    if (idx < 0) return;
    const data = {};
    Object.keys(patch).forEach(k => {
      data['list[' + idx + '].' + k] = patch[k];
    });
    this.setData(data);
  },

  // 收起所有展开的记录
  _collapseAllSwipe() {
    const list = this.data.list.map(r => Object.assign({}, r, {
      _swipeX: 0,
      _swiping: false,
      _swipeAnim: true,
      _swipeActionsW: 0
    }));
    this.setData({ list });
  },

  // 点击已展开的记录时收起（而非进入详情）
  onRecordTapCollapse(e) {
    const id = e.currentTarget.dataset.id;
    this._updateRecordSwipe(id, { _swipeX: 0, _swiping: false, _swipeAnim: true, _swipeActionsW: 0 });
  },

  // ===== 数据加载 =====

  _loadFolders() {
    const folders = storage.getAllFolders();
    const allRecords = storage.getAll();
    const selectedIds = this.data.selectedFolderIds || [];
    const trashCount = storage.getTrashCount();
    const foldersWithCount = folders.map(f => ({
      id: f.id,
      name: f.name,
      count: allRecords.filter(r => r.folderId === f.id).length,
      _exportSelected: selectedIds.indexOf(f.id) >= 0
    }));
    const uncategorizedCount = allRecords.filter(r => r.folderId === null).length;
    this.setData({
      folders: foldersWithCount,
      uncategorizedCount: uncategorizedCount,
      totalCount: allRecords.length,
      uncategorizedExportSelected: selectedIds.indexOf('__uncategorized__') >= 0,
      allFoldersSelected: this._allFoldersSelected(),
      trashCount: trashCount
    });
  },

  _loadList() {
    var raw;

    if (this.data.exportMode) {
      // 导出模式：显示选中文件夹下记录的并集
      raw = this._getExportModeRecords();
    } else {
      // 普通模式：按 activeFolderId 过滤
      if (this.data.activeFolderId === null) {
        raw = storage.getAll();
      } else if (this.data.activeFolderId === '__uncategorized__') {
        raw = storage.getByFolderId(null);
      } else {
        raw = storage.getByFolderId(this.data.activeFolderId);
      }
    }

    // batchMode 下保留已有选中态（防止 onShow 切回前台时 _checked 被重置）
    const prevCheckedMap = {};
    if (this.data.batchMode) {
      this.data.list.forEach(r => {
        if (r._checked) prevCheckedMap[r.id] = true;
      });
    }
    let all = raw.map((item) => {
      const date = new Date(item.createdAt);
      // 分辨率暗文：宽×高 + 文件大小（KB），异步填充 sizeText
      const resolutionText = (item.width && item.height)
        ? (item.width + '×' + item.height)
        : '';
      return Object.assign({}, item, {
        timeText: templates.formatDateTime(date),
        metaText: resolutionText ? '· ' + resolutionText : '',
        sizeText: '',  // 异步填充
        summary: this._buildSummary(item),
        _checked: !!prevCheckedMap[item.id],
        _syncStatus: item._syncStatus || 'off',
        _swipeX: 0,
        _swiping: false,
        _swipeAnim: true,
        _swipeActionsW: 0
      });
    });
    // 按创建时间倒序
    all.sort((a, b) => b.createdAt - a.createdAt);

    // 导出模式下，如果有选中文件夹则自动勾选所有记录
    if (this.data.exportMode && this.data.selectedFolderIds.length > 0) {
      all.forEach(item => { item._checked = true; });
    }

    // 普通模式搜索过滤：对货号/西语描述/中文描述/价格/装箱数/件数/体积/重量等
    // 所有 values 字段 + customName + templateName 做模糊匹配（不区分大小写）
    var kw = (this.data.searchKeyword || '').trim().toLowerCase();
    if (kw && !this.data.exportMode) {
      all = all.filter(function (item) {
        // customName / templateName
        if (String(item.customName || '').toLowerCase().indexOf(kw) >= 0) return true;
        if (String(item.templateName || '').toLowerCase().indexOf(kw) >= 0) return true;
        // 所有 values 字段
        var vals = item.values || {};
        var keys = Object.keys(vals);
        for (var i = 0; i < keys.length; i++) {
          if (String(vals[keys[i]] || '').toLowerCase().indexOf(kw) >= 0) return true;
        }
        return false;
      });
    }

    // 保留全量记录到 _allRecords，分页渲染前 PAGE_SIZE 条
    this._allRecords = all;
    this._allRecordsCount = all.length;
    this.setData({ filteredCount: all.length });
    this._renderedCount = 0;
    // 列表整体重建：自增 token 使在途回调失效，分页追加时不应自增
    this._fillToken = (this._fillToken || 0) + 1;
    this._renderMore(true);
  },

  // 渲染下一页（首屏或触底加载更多）
  // isReset=true 时渲染首屏（替换 list），否则追加
  _renderMore(isReset) {
    if (!this._allRecords) return;
    const total = this._allRecords.length;
    if (isReset) {
      this._renderedCount = 0;
    }
    const target = Math.min(this._renderedCount + PAGE_SIZE, total);
    if (target <= this._renderedCount) {
      // 无新数据可加载：reset 时需清空旧列表（切换到空文件夹/删除全部场景）
      this.setData({
        list: isReset ? [] : this.data.list,
        selectedCount: 0,
        hasMore: false,
        loadingMore: false
      });
      return;
    }
    const slice = this._allRecords.slice(this._renderedCount, target);
    this._renderedCount = target;
    // 异步回填图片大小（仅对新切片）
    this._fillImageSizes(slice, this._renderedCount - slice.length);

    if (isReset) {
      const count = this._allRecords.filter(i => i._checked).length;
      this.setData({
        list: slice,
        selectedCount: count,
        hasMore: this._renderedCount < total,
        loadingMore: false
      });
    } else {
      // 追加：保留已渲染 list，concat 新切片
      const newList = this.data.list.concat(slice);
      // selectedCount 始终基于全量记录，避免分页追加时选中计数掉到已渲染切片范围
      const count = this._allRecords.filter(i => i._checked).length;
      this.setData({
        list: newList,
        selectedCount: count,
        hasMore: this._renderedCount < total,
        loadingMore: false
      });
    }
  },

  // 页面级滚动触底，加载下一页
  onReachBottom() {
    if (!this._allRecords) return;
    if (this._renderedCount >= this._allRecords.length) return;
    if (this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    // 延迟一帧，避免与 setData 抢主线程；分页数据已在内存中，开销很小
    // 记录 timer，供 onUnload / _loadList 清理，防止切换文件夹后旧回调追加错位
    if (this._loadMoreTimer) clearTimeout(this._loadMoreTimer);
    this._loadMoreTimer = setTimeout(() => {
      this._loadMoreTimer = null;
      this._renderMore(false);
    }, 50);
  },

  // 页面卸载：清理触底加载定时器 + 失效图片大小回填回调 + 兜底关闭屏幕常亮
  onUnload() {
    if (this._loadMoreTimer) {
      clearTimeout(this._loadMoreTimer);
      this._loadMoreTimer = null;
    }
    // 自增 token 使在途的 getFileInfo 回调短路，避免对已销毁页面 setData
    this._fillToken = (this._fillToken || 0) + 1;
    wx.setKeepScreenOn && wx.setKeepScreenOn({ keepScreenOn: false });
  },

  /**
   * 获取导出模式下选中文件夹的并集记录
   */
  _getExportModeRecords() {
    const selectedIds = this.data.selectedFolderIds;
    if (selectedIds.length === 0) {
      // 未选中任何文件夹时显示全部记录但不自动勾选
      return storage.getAll();
    }

    // 收集所有选中的记录，去重
    const seen = {};
    const result = [];
    selectedIds.forEach(fid => {
      var records;
      if (fid === '__uncategorized__') {
        records = storage.getByFolderId(null);
      } else {
        records = storage.getByFolderId(fid);
      }
      records.forEach(r => {
        if (!seen[r.id]) {
          seen[r.id] = true;
          result.push(r);
        }
      });
    });
    return result;
  },

  /**
   * 检查是否所有可选的文件夹都已被选中
   */
  _allFoldersSelected() {
    const allIds = [];
    if (this.data.uncategorizedCount > 0) {
      allIds.push('__uncategorized__');
    }
    this.data.folders.forEach(f => allIds.push(f.id));
    if (allIds.length === 0) return false;
    return allIds.every(id => this.data.selectedFolderIds.indexOf(id) >= 0);
  },

  _buildSummary(item) {
    if (!item.values) return '';
    return Object.keys(item.values).slice(0, 3).map((k) => {
      return k + ': ' + (item.values[k] || '');
    }).join(' · ');
  },

  // ===== 搜索 =====
  // 防抖：输入停顿 300ms 后落地关键词并重新过滤
  _searchTimer: null,
  onSearchInput(e) {
    const val = e.detail.value || '';
    this.setData({ searchInput: val, searchActive: true });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    const that = this;
    this._searchTimer = setTimeout(function () {
      that._searchTimer = null;
      that.setData({ searchKeyword: val });
      that._loadList();
    }, 300);
  },
  onSearchFocus() {
    this.setData({ searchActive: true });
  },
  onSearchBlur() {
    // 失焦但有关键词时保持搜索态；无关键词则退出
    if (!this.data.searchInput) this.setData({ searchActive: false });
  },
  onSearchClear() {
    if (this._searchTimer) { clearTimeout(this._searchTimer); this._searchTimer = null; }
    this.setData({ searchInput: '', searchKeyword: '', searchActive: false });
    this._loadList();
  },

  // 异步读取每条记录图片的文件大小，回填 sizeText（与分辨率一起作为暗文显示）
  // startIdx 为 slice 在已渲染 list 中的起始下标（用于路径式 setData 定位）
  // token 由 _loadList 自增，分页追加时复用同一 token，避免误杀上一页在途回调
  _fillImageSizes(list, startIdx) {
    const fs = wx.getFileSystemManager();
    const that = this;
    const token = this._fillToken;
    const offset = startIdx || 0;
    // 收集结果一次性 setData，避免每条记录单独 setData 造成 N 次跨层通信
    const pending = {};
    const pc = { count: 0 }; // 可变的计数器引用，供异步回调共用
    const flush = function () {
      if (pc.count === 0 && token === that._fillToken) {
        that.setData(pending);
      }
    };
    list.forEach((item, idx) => {
      if (!item.imagePath && !item._cloudFileId) return;
      pc.count++;
      const listIdx = offset + idx;
      // 本地文件缺失但有云端备份 → 尝试下载
      if ((!item.imagePath || !_checkFileExists(item.imagePath)) && item._cloudFileId) {
        _downloadCloudImage(item, listIdx, pending, pc, that, token, flush);
        return;
      }
      fs.getFileInfo({
        filePath: item.imagePath,
        success: function (res) {
          if (token !== that._fillToken) return; // 列表已重建，丢弃旧回调
          const size = res.size || 0;
          var kb;
          if (size >= 1024 * 1024) {
            kb = (size / (1024 * 1024)).toFixed(1) + 'MB';
          } else if (size > 1024) {
            kb = (size / 1024).toFixed(0) + 'KB';
          } else {
            kb = size + 'B';
          }
          const sizeText = item.metaText ? (item.metaText + ' · ' + kb) : ('· ' + kb);
          pending['list[' + listIdx + '].sizeText'] = sizeText;
          if (--pc.count === 0) flush();
        },
        fail: function () {
          if (token !== that._fillToken) return;
          if (item.metaText) {
            pending['list[' + listIdx + '].sizeText'] = item.metaText;
          }
          if (--pc.count === 0) flush();
        }
      });
    });
  },

  // ===== 页面导航 =====

  goDetail(e) {
    if (this.data.exportMode) return;
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },


  goCamera() {
    wx.navigateTo({ url: '/pages/camera/camera' });
  },

  goDict() {
    wx.navigateTo({ url: '/pages/dict/dict' });
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },

  // ===== 从相册恢复数据 =====

  async onRestoreFromAlbum() {
    // 1. 检查 API 配置
    var cfg = translator.getConfig();
    if (!cfg || !cfg.apiKey || !cfg.baseURL) {
      wx.showModal({
        title: '需要配置 LLM',
        content: '「从相册恢复」功能需要调用多模态 AI 识别照片中的水印文字。\n请前往「词典 → 翻译引擎」配置并保存 API Key（需支持视觉能力的模型，如 GPT-4o / Claude / Gemini 等）。',
        confirmText: '去配置',
        cancelText: '取消',
        success: function (r) {
          if (r.confirm) {
            wx.navigateTo({ url: '/pages/dict/dict?tab=api' });
          }
        }
      });
      return;
    }

    // 2. 选择图片（最多 9 张）
    var that = this;
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sourceType: ['album'],
      success: function (mediaRes) {
        if (!mediaRes.tempFiles || mediaRes.tempFiles.length === 0) return;
        that._processAlbumImages(mediaRes.tempFiles);
      }
    });
  },

  async _processAlbumImages(tempFiles) {
    var total = tempFiles.length;
    var successCount = 0;
    var failCount = 0;
    var failedNames = [];

    wx.showLoading({ title: '识别中 0/' + total, mask: true });

    for (var i = 0; i < total; i++) {
      var file = tempFiles[i];
      wx.showLoading({ title: '识别中 ' + (i + 1) + '/' + total, mask: true });

      try {
        // 压缩图片（水印文字大，压缩后仍可识别，减少传输量）
        var compressedPath = await new Promise(function (resolve) {
          wx.compressImage({
            src: file.tempFilePath,
            quality: 80,
            success: function (cr) { resolve(cr.tempFilePath); },
            fail: function () { resolve(file.tempFilePath); }
          });
        });

        // 调用多模态 AI 识别
        var fields = await translator.recognizeWatermark(compressedPath);
        if (!fields || Object.keys(fields).length === 0) {
          failCount++;
          failedNames.push(file.tempFilePath.slice(-20));
          continue;
        }

        // 复制图片到持久存储
        var destPath = wx.env.USER_DATA_PATH + '/restore_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '.jpg';
        wx.getFileSystemManager().copyFileSync(compressedPath, destPath);

        // 创建记录
        var record = {
          id: storage.genId(),
          values: {},
          imagePath: destPath,
          width: file.width || 1080,
          height: file.height || 1440,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          templateId: '',
          templateName: '',
          customName: fields.customName || fields.modelo || '',
          folderId: null,
          watermarkPosition: 'bottom-right',
          watermarkScale: 0.42,
          watermarkOpacity: 0.85,
          watermarkWidthRatio: 0.42,
          _syncStatus: 'off'
        };

        // 填入识别到的字段
        var fieldKeys = ['modelo', 'desEs', 'desZh', 'precio', 'pzs', 'cajas', 'volumen', 'peso'];
        fieldKeys.forEach(function (k) {
          if (fields[k] != null && String(fields[k]).trim()) {
            record.values[k] = String(fields[k]).trim();
          }
        });

        // 额外字段（如果有）
        if (fields.customName) {
          record.customName = String(fields.customName).trim();
        }

        storage.add(record);
        successCount++;
      } catch (e) {
        console.warn('[List] 图片识别失败:', file.tempFilePath, e);
        failCount++;
        failedNames.push(file.tempFilePath.slice(-20));
      }
    }

    wx.hideLoading();

    // 提示结果
    var msg = '成功恢复 ' + successCount + ' 条记录';
    if (failCount > 0) msg += '，' + failCount + ' 条失败';
    wx.showToast({ title: msg, icon: successCount > 0 ? 'success' : 'none', duration: 3000 });

    if (successCount > 0) {
      this._loadList();
    }
  },

  // ===== 文件夹Tab交互 =====

  onSelectFolder(e) {
    const folderId = e.currentTarget.dataset.folderId;
    // folderId: '' → "全部", '__uncategorized__' → 未分类, 其他 → folder.id

    if (this.data.exportMode) {
      // 导出模式：切换文件夹的选中状态
      this._toggleFolderSelection(folderId);
    } else {
      // 普通模式：切换到该文件夹的视图
      const activeFolderId = folderId === '' ? null : folderId;
      this.setData({ activeFolderId: activeFolderId }, () => {
        this._loadList();
      });
    }
  },

  /**
   * 导出模式下切换文件夹选中状态
   */
  _toggleFolderSelection(folderId) {
    var selectedIds = this.data.selectedFolderIds.slice();

    if (folderId === '') {
      // "全部"：如果已全选则取消全部，否则全选
      if (this._allFoldersSelected()) {
        selectedIds = [];
      } else {
        selectedIds = [];
        if (this.data.uncategorizedCount > 0) {
          selectedIds.push('__uncategorized__');
        }
        this.data.folders.forEach(f => selectedIds.push(f.id));
      }
    } else {
      const fid = folderId; // '__uncategorized__' 或 folder.id
      const idx = selectedIds.indexOf(fid);
      if (idx >= 0) {
        selectedIds.splice(idx, 1);
      } else {
        selectedIds.push(fid);
      }
    }

    this.setData({ selectedFolderIds: selectedIds });
    this._loadFolders(); // 更新Tab视觉状态
    this._loadList();
  },

  onFolderLongPress(e) {
    if (this.data.exportMode) return; // 导出模式下禁用长按
    const folderId = e.currentTarget.dataset.folderId;
    const folder = this.data.folders.find(f => f.id === folderId);
    if (!folder) return;

    const that = this;
    wx.showActionSheet({
      itemList: ['重命名', '删除'],
      success(res) {
        if (res.tapIndex === 0) {
          that.setData({
            showFolderModal: true,
            editingFolderId: folderId,
            folderNameInput: folder.name
          });
        } else if (res.tapIndex === 1) {
          that.setData({
            showDeleteFolderModal: true,
            deleteFolderId: folderId,
            deleteFolderName: folder.name,
            deleteFolderCount: folder.count
          });
        }
      }
    });
  },

  onUncategorizedLongPress() {
    wx.showToast({ title: '未分类为系统分组', icon: 'none' });
  },

  onAddFolder() {
    if (this.data.exportMode) return;
    if (this.data.folders.length >= MAX_FOLDERS) {
      wx.showToast({ title: '文件夹数量已达上限(' + MAX_FOLDERS + '个)', icon: 'none' });
      return;
    }
    this.setData({
      showFolderModal: true,
      editingFolderId: null,
      folderNameInput: ''
    });
  },

  // ===== 文件夹创建/重命名弹层 =====

  onFolderNameInput(e) {
    this.setData({ folderNameInput: e.detail.value });
  },

  onConfirmFolder() {
    const name = this.data.folderNameInput.trim();
    if (!name) {
      wx.showToast({ title: '请输入文件夹名称', icon: 'none' });
      return;
    }
    if (name.length > 20) {
      wx.showToast({ title: '名称不能超过20个字符', icon: 'none' });
      return;
    }

    const exists = this.data.folders.some(f =>
      f.id !== this.data.editingFolderId &&
      f.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (exists) {
      wx.showToast({ title: '文件夹名称已存在', icon: 'none' });
      return;
    }

    const isRename = !!this.data.editingFolderId;

    if (isRename) {
      storage.updateFolder(this.data.editingFolderId, { name: name });
    } else {
      storage.addFolder(name);
    }

    // 获取文件夹对象（用于后续云端同步，需在 setData 清空 editingFolderId 前）
    var folderForSync = null;
    if (cloud.isSyncEnabled()) {
      if (isRename) {
        folderForSync = storage.getFolderById(this.data.editingFolderId);
      } else {
        folderForSync = storage.getFolderByName(name);
      }
    }

    this.setData({ showFolderModal: false, editingFolderId: null, folderNameInput: '' });
    this._loadFolders();

    // 同步文件夹到云端
    if (folderForSync) {
      cloud.getOpenid().then(function (oid) {
        if (oid) cloud.syncFolder(folderForSync, oid);
      });
    }

    wx.showToast({ title: isRename ? '已重命名' : '文件夹已创建', icon: 'success' });
  },

  closeFolderModal() {
    this.setData({ showFolderModal: false, editingFolderId: null, folderNameInput: '' });
  },

  // ===== 删除文件夹确认弹层 =====

  onDeleteFolderWithRecords() {
    const folderId = this.data.deleteFolderId;
    const records = storage.getByFolderId(folderId);

    var trashedIds = [];
    records.forEach(function (r) { storage.moveToTrash(r.id); trashedIds.push(r.id); });
    storage.removeFolder(folderId);

    // 同步开启时云端软删除
    if (cloud.isSyncEnabled() && trashedIds.length > 0) {
      cloud.getOpenid().then(function (openid) {
        if (openid) {
          trashedIds.forEach(function (id) {
            cloud.softDelete(id, openid).catch(function (err) {
              console.warn('[List] 文件夹删除, 云端软删除失败:', id, err);
            });
          });
          cloud.softDeleteFolder(folderId, openid);
        }
      });
    }

    this.setData({ showDeleteFolderModal: false });

    if (this.data.activeFolderId === folderId) {
      this.setData({ activeFolderId: null });
    }

    // 同时从导出选中列表中移除
    var selectedIds = this.data.selectedFolderIds.slice();
    const idx = selectedIds.indexOf(folderId);
    if (idx >= 0) selectedIds.splice(idx, 1);
    this.setData({ selectedFolderIds: selectedIds });

    this._loadFolders();
    this._loadList();
    wx.showToast({ title: '已移入回收站', icon: 'success' });
  },

  onDeleteFolderKeepRecords() {
    const folderId = this.data.deleteFolderId;
    const records = storage.getByFolderId(folderId);

    records.forEach(r => storage.update(r.id, { folderId: null }));
    storage.removeFolder(folderId);

    // 同步开启时云端软删除文件夹
    if (cloud.isSyncEnabled()) {
      cloud.getOpenid().then(function (oid) {
        if (oid) cloud.softDeleteFolder(folderId, oid);
      });
    }

    this.setData({ showDeleteFolderModal: false });

    if (this.data.activeFolderId === folderId) {
      this.setData({ activeFolderId: null });
    }

    // 同时从导出选中列表中移除
    var selectedIds = this.data.selectedFolderIds.slice();
    const idx = selectedIds.indexOf(folderId);
    if (idx >= 0) selectedIds.splice(idx, 1);
    this.setData({ selectedFolderIds: selectedIds });

    this._loadFolders();
    this._loadList();
    wx.showToast({ title: '文件夹已删除，记录已移入未分类', icon: 'success' });
  },

  closeDeleteFolderModal() {
    this.setData({ showDeleteFolderModal: false });
  },

  // ===== 记录左滑按钮事件 =====

  onSwipeRename(e) {
    const id = e.currentTarget.dataset.id;
    this._collapseAllSwipe();
    this.onRenameStart(id);
  },

  onSwipeMove(e) {
    const id = e.currentTarget.dataset.id;
    this._collapseAllSwipe();
    this.onMoveStart(id);
  },

  onSwipeCopy(e) {
    const id = e.currentTarget.dataset.id;
    this._collapseAllSwipe();
    this.onCopyStart(id);
  },

  onSwipeDelete(e) {
    const id = e.currentTarget.dataset.id;
    this._collapseAllSwipe();
    this.onRecordDelete(id);
  },

  // ===== 记录长按操作 =====

  onRecordLongPress(e) {
    if (this.data.exportMode) return;
    if (this.data.batchMode) return;  // 批量模式下禁止长按操作，避免 _loadList 清掉分页外的选中态
    const id = e.currentTarget.dataset.id;
    const record = this.data.list.find(r => r.id === id);
    if (!record) return;

    const that = this;
    wx.showActionSheet({
      itemList: ['重命名', '移动到文件夹', '复制到文件夹', '删除'],
      success(res) {
        switch (res.tapIndex) {
          case 0:
            that.onRenameStart(id);
            break;
          case 1:
            that.onMoveStart(id);
            break;
          case 2:
            that.onCopyStart(id);
            break;
          case 3:
            that.onRecordDelete(id);
            break;
        }
      }
    });
  },

  // ===== 记录重命名 =====

  onRenameStart(id) {
    const record = storage.getById(id);
    if (!record) return;
    this.setData({
      showRenameModal: true,
      renameRecordId: id,
      renameInput: record.customName || ''
    });
  },

  onRenameInput(e) {
    this.setData({ renameInput: e.detail.value });
  },

  onConfirmRename() {
    const newName = this.data.renameInput.trim();
    const id = this.data.renameRecordId;

    storage.update(id, { customName: newName || null });

    // 同步开启时上传新名称到云端
    if (cloud.isSyncEnabled()) {
      var record = storage.getById(id);
      if (record) {
        cloud.getOpenid().then(function (oid) {
          if (oid) {
            return cloud.syncRecord(record, oid, false);
          }
        }).then(function (res) {
          if (res && res.success) {
            storage.update(id, { _syncStatus: 'synced' });
          }
        }).catch(function (err) {
          console.warn('[List] 重命名同步失败:', err);
        });
      }
    }

    this.setData({ showRenameModal: false, renameRecordId: '', renameInput: '' });
    this._loadList();
    wx.showToast({ title: newName ? '已重命名' : '已恢复默认名称', icon: 'success' });
  },

  closeRenameModal() {
    this.setData({ showRenameModal: false, renameRecordId: '', renameInput: '' });
  },

  // ===== 记录移动/复制 =====

  onMoveStart(id) {
    this.openFolderPicker('move', id);
  },

  onCopyStart(id) {
    this.openFolderPicker('copy', id);
  },

  openFolderPicker(mode, recordId) {
    this.setData({
      showFolderPicker: true,
      pickerMode: mode,
      pickerRecordId: recordId
    });
  },

  closeFolderPicker() {
    this.setData({
      showFolderPicker: false,
      pickerMode: '',
      pickerRecordId: ''
    });
  },

  onPickTargetFolder(e) {
    const targetFolderId = e.currentTarget.dataset.folderId;
    const record = storage.getById(this.data.pickerRecordId);
    if (!record) {
      wx.showToast({ title: '记录不存在', icon: 'none' });
      this.closeFolderPicker();
      return;
    }

    const actualTargetId = targetFolderId === '__uncategorized__' ? null : targetFolderId;

    if (this.data.pickerMode === 'move') {
      const currentFolderId = this.data.activeFolderId === '__uncategorized__'
        ? null
        : this.data.activeFolderId;
      if (actualTargetId === currentFolderId && this.data.activeFolderId !== null) {
        wx.showToast({ title: '已在当前文件夹', icon: 'none' });
        return;
      }
    }

    this.onConfirmMoveOrCopy(actualTargetId);
  },

  async onConfirmMoveOrCopy(targetFolderId) {
    const recordId = this.data.pickerRecordId;
    const mode = this.data.pickerMode;

    if (mode === 'move') {
      storage.update(recordId, { folderId: targetFolderId });
      this.closeFolderPicker();
      this._loadFolders();
      this._loadList();
      wx.showToast({ title: '已移动', icon: 'success' });
    } else if (mode === 'copy') {
      wx.showLoading({ title: '复制中...', mask: true });
      try {
        const record = storage.getById(recordId);
        if (!record) throw new Error('记录不存在');
        await this._copyRecordToFolder(record, targetFolderId);
        wx.hideLoading();
        this.closeFolderPicker();
        this._loadFolders();
        this._loadList();
        wx.showToast({ title: '已复制', icon: 'success' });
      } catch (e) {
        wx.hideLoading();
        console.error('[List] 复制记录失败:', e);
        wx.showToast({ title: '复制失败', icon: 'none' });
      }
    }
  },

  // ===== 文件复制辅助 =====

  _copyFile(srcPath) {
    return new Promise((resolve) => {
      if (!srcPath) {
        resolve(null);
        return;
      }
      const destPath = wx.env.USER_DATA_PATH + '/copy_' + Date.now() + '_'
        + Math.random().toString(36).slice(2, 6) + '.jpg';
      wx.getFileSystemManager().copyFile({
        srcPath: srcPath,
        destPath: destPath,
        success: () => resolve(destPath),
        fail: (err) => {
          console.warn('[List] copyFile 失败，降级使用原路径:', srcPath, err);
          resolve(srcPath);
        }
      });
    });
  },

  async _copyRecordToFolder(record, targetFolderId) {
    const newImagePath = await this._copyFile(record.imagePath);
    var newOriginalPath = null;
    if (record.originalPath) {
      newOriginalPath = await this._copyFile(record.originalPath);
    }

    const newRecord = Object.assign({}, record, {
      id: storage.genId(),
      folderId: targetFolderId,
      customName: null,
      imagePath: newImagePath,
      originalPath: newOriginalPath,
      createdAt: Date.now()
    });

    storage.add(newRecord);
  },

  // ===== 记录删除 =====

  onRecordDelete(id) {
    const that = this;
    wx.showModal({
      title: '删除确认',
      content: '确定要删除本条记录吗？（将移入回收站，30天后自动清理）',
      success(res) {
        if (res.confirm) {
          storage.moveToTrash(id);
          // 同步开启时云端软删除
          if (cloud.isSyncEnabled()) {
            cloud.getOpenid().then(function (openid) {
              if (openid) {
                cloud.softDelete(id, openid).catch(function (err) {
                  console.warn('[List] 云端软删除失败:', err);
                });
              }
            });
          }
          that._loadFolders();
          that._loadList();
          wx.showToast({ title: '已移入回收站', icon: 'success' });
        }
      }
    });
  },

  // ===== 导出模式 =====

  toggleExportMode() {
    if (this.data.list.length === 0 && this.data.totalCount === 0) return;
    const entering = !this.data.exportMode;

    if (entering) {
      // 进入导出模式：清空文件夹选中，显示全部记录
      this.setData({
        exportMode: true,
        selectedFolderIds: []
      }, () => {
        this._loadList();
      });
    } else {
      // 退出导出模式：恢复普通视图
      this.setData({
        exportMode: false,
        selectedFolderIds: [],
        selectedCount: 0
      }, () => {
        this._loadList();
      });
    }
  },

  toggleSelect(e) {
    const id = e.currentTarget.dataset.id;
    // 同步更新全量记录，保证分页下未渲染记录的选中态一致
    const all = (this._allRecords || this.data.list).map(item => {
      if (item.id === id) item._checked = !item._checked;
      return item;
    });
    this._allRecords = all;
    const count = all.filter(i => i._checked).length;
    // 路径式更新当前可见项（若该记录已渲染）
    const idx = this.data.list.findIndex(r => r.id === id);
    if (idx >= 0) {
      this.setData({
        ['list[' + idx + ']._checked']: all.find(r => r.id === id)._checked,
        selectedCount: count
      });
    } else {
      this.setData({ selectedCount: count });
    }
  },

  selectAll() {
    // 选中全量记录（含未渲染的分页），导出时才能拿到完整集合
    const all = (this._allRecords || this.data.list).map(item => {
      item._checked = true;
      return item;
    });
    this._allRecords = all;
    const list = this.data.list.map(item => Object.assign({}, item, { _checked: true }));
    this.setData({ list, selectedCount: all.length });
  },

  deselectAll() {
    const all = (this._allRecords || this.data.list).map(item => {
      item._checked = false;
      return item;
    });
    this._allRecords = all;
    const list = this.data.list.map(item => Object.assign({}, item, { _checked: false }));
    this.setData({ list, selectedCount: 0 });
  },

  // ===== 批量选择模式（右滑触发，渐进式选中态，不替换顶部栏） =====

  // 右滑触发：进入选中态并选中当前记录
  _enterBatchAndToggle(id) {
    // 进入选中态：清空全量记录选中态并选中当前记录（分页下未渲染记录也需清空）
    const all = (this._allRecords || this.data.list).map(item => Object.assign({}, item, { _checked: false }));
    const target = all.find(r => r.id === id);
    if (target) target._checked = true;
    this._allRecords = all;
    const list = this.data.list.map(item => Object.assign({}, item, { _checked: item.id === id }));
    this._collapseAllSwipe();
    this.setData({ list, batchMode: true, batchSelectedCount: 1 });
  },

  // 选中态下点击记录：切换选中态
  onBatchToggle(e) {
    if (!this.data.batchMode) return;
    const id = e.currentTarget.dataset.id;
    // 同步全量记录选中态
    const all = (this._allRecords || this.data.list).map(item => {
      if (item.id === id) item._checked = !item._checked;
      return item;
    });
    this._allRecords = all;
    const count = all.filter(i => i._checked).length;
    // 路径式更新当前可见项
    const idx = this.data.list.findIndex(r => r.id === id);
    const patch = { batchSelectedCount: count };
    if (idx >= 0) {
      patch['list[' + idx + ']._checked'] = all.find(r => r.id === id)._checked;
    }
    // 选中数归0 → 自动退出选中态
    if (count === 0) {
      this._exitBatchMode(this.data.list);
    } else {
      this.setData(patch);
    }
  },

  // 选中态：全选（含未渲染的分页记录）
  onBatchSelectAll() {
    const all = (this._allRecords || this.data.list).map(item => Object.assign({}, item, { _checked: true }));
    this._allRecords = all;
    const list = this.data.list.map(item => Object.assign({}, item, { _checked: true }));
    this.setData({ list, batchSelectedCount: all.length });
  },

  // 退出选中态（点✕或取消）
  onBatchCancel() {
    this._exitBatchMode();
  },

  // 内部：退出选中态，清空选中标记（含未渲染记录）
  _exitBatchMode(list) {
    if (this._allRecords) {
      this._allRecords = this._allRecords.map(item => Object.assign({}, item, { _checked: false }));
    }
    const newList = (list || this.data.list).map(item => Object.assign({}, item, { _checked: false }));
    this.setData({ list: newList, batchMode: false, batchSelectedCount: 0 });
  },

  // 批量删除：弹出二次确认
  onBatchDeleteStart() {
    if (this.data.batchSelectedCount === 0) return;
    this.setData({ showBatchDeleteModal: true });
  },

  closeBatchDeleteModal() {
    this.setData({ showBatchDeleteModal: false });
  },

  // 确认批量删除
  onBatchDeleteConfirm() {
    // 从全量记录取选中项，分页下未渲染的记录也能被删除
    const selected = (this._allRecords || this.data.list).filter(item => item._checked);
    const ids = selected.map(item => item.id);
    this.setData({ showBatchDeleteModal: false });
    wx.showLoading({ title: '移入回收站...', mask: true });
    try {
      ids.forEach(function (id) { storage.moveToTrash(id); });
      // 同步开启时云端批量软删除
      if (cloud.isSyncEnabled()) {
        cloud.getOpenid().then(function (openid) {
          if (openid) {
            ids.forEach(function (id) {
              cloud.softDelete(id, openid).catch(function (err) {
                console.warn('[List] 云端软删除失败:', err);
              });
            });
          }
        });
      }
      wx.hideLoading();
      wx.showToast({ title: '已移入回收站 ' + ids.length + ' 条', icon: 'success' });
      this.setData({ batchMode: false, batchSelectedCount: 0 });
      this._loadFolders();
      this._loadList();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  // ===== 导出 =====

  doExport() {
    // 从全量记录取选中项，分页下未渲染的记录也能被导出
    const selected = (this._allRecords || this.data.list).filter(item => item._checked);
    if (selected.length === 0) {
      wx.showToast({ title: '请先选择记录', icon: 'none' });
      return;
    }

    // 预填文件名
    var defaultName = '';
    const selIds = this.data.selectedFolderIds;
    if (selIds.length === 1) {
      if (selIds[0] === '__uncategorized__') {
        defaultName = '未分类';
      } else {
        const folder = this.data.folders.find(f => f.id === selIds[0]);
        if (folder) defaultName = folder.name;
      }
    }
    if (!defaultName) {
      defaultName = '水印照片导出';
    }
    // 默认文件名带时间戳，方便用户区分导出时间
    defaultName += '_' + this._formatTimeForFile();

    this.setData({
      showExportNameModal: true,
      exportFileName: defaultName
    });
  },

  onExportNameInput(e) {
    this.setData({ exportFileName: e.detail.value });
  },

  async onConfirmExport() {
    // 用 _allRecords 取选中项，避免分页下漏选（this.data.list 仅含已渲染切片）
    const selected = (this._allRecords || this.data.list).filter(item => item._checked);
    if (selected.length === 0) return;

    const customFileName = this.data.exportFileName.trim() || null;
    const that = this;

    // 选择导出格式：xlsx（真实 OOXML，图片原始字节不压缩）/ xls（伪 xls，HTML+VML，base64 图片）
    wx.showActionSheet({
      itemList: [
        'xlsx（推荐·图片不压缩）',
        'xls（伪 xls·兼容老版本）',
        'xlsx + 上传到云端'
      ],
      success: function (res) {
        const tapIndex = res.tapIndex;
        if (tapIndex === 2) {
          // 导出到云端
          if (selected.length > 200) {
            wx.showModal({
              title: '导出数量较大',
              content: '选中 ' + selected.length + ' 条记录，数量较多可能耗时较长，是否继续？',
              confirmText: '继续导出',
              cancelText: '取消',
              success: function (m) {
                if (m.confirm) {
                  that._doExportToCloud(selected, customFileName).catch(that._onExportError);
                }
              }
            });
            return;
          }
          that._doExportToCloud(selected, customFileName).catch(that._onExportError);
          return;
        }
        const fmt = tapIndex === 0 ? 'xlsx' : 'xls';
        // 大数量导出提示：记录过多可能因内存/IO 紧张导致生成慢或失败
        if (selected.length > 200) {
          wx.showModal({
            title: '导出数量较大',
            content: '选中 ' + selected.length + ' 条记录，数量较多可能耗时较长，是否继续？',
            confirmText: '继续导出',
            cancelText: '取消',
            success: function (m) {
              if (m.confirm) {
                that._doExport(selected, customFileName, fmt).catch(that._onExportError);
              }
            }
          });
          return;
        }
        that._doExport(selected, customFileName, fmt).catch(that._onExportError);
      },
      fail: function () { /* 用户取消选择，无需处理 */ }
    });
  },

  // ===== 导出到云端（云端生成 xlsx，绕过本地存储配额）=====

  async _doExportToCloud(selected, customFileName) {
    wx.showToast({ title: '正在上传图片...', icon: 'none', duration: 15000 });
    var toastTimer = setTimeout(function () {
      wx.showToast({ title: '正在上传图片，请稍候...', icon: 'none', duration: 10000 });
    }, 15000);

    try {
      // 1. 获取 openid
      var openid = cloud._getCachedOpenid();
      if (!openid) {
        openid = await cloud.getOpenid();
      }
      if (!openid) throw new Error('无法获取用户身份');

      // 2. 构造记录数据，已有云端图片的复用 fileID（免重复上传）
      var ts = this._formatTimeForFile();
      var baseName = customFileName
        ? customFileName.replace(/[/\:*?"<>|]/g, '_')
        : ('export_' + ts);
      var fileName = baseName + '.xlsx';

      // 3. 翻译预处理：填充缺失的 desEs/desZh（双语文案），LLM 优先模式下直接走大模型
      await exporter.preTranslateRecords(selected, null);

      var cloudRecords = [];
      var uploadTasks = [];    // 真正需要上传的图片
      var BATCH_SIZE = 3;

      for (var i = 0; i < selected.length; i++) {
        var rec = selected[i];
        var recordData = {
          modelo: (rec.values && rec.values.modelo) || '',
          desEs: (rec.values && rec.values.desEs) || '',
          desZh: (rec.values && rec.values.desZh) || '',
          precio: (rec.values && rec.values.precio) || '',
          pzs: (rec.values && rec.values.pzs) || '',
          cajas: (rec.values && rec.values.cajas) || '',
          volumen: (rec.values && rec.values.volumen) || '',
          peso: (rec.values && rec.values.peso) || '',
          imageFileID: null,
          width: rec.width || 0,
          height: rec.height || 0
        };

        if (rec.imagePath) {
          if (rec._cloudFileId) {
            // 已有云端图片 → 直接复用，免上传
            recordData.imageFileID = rec._cloudFileId;
          } else {
            // 本地图片 → 加入上传队列，成功后回写 _cloudFileId 到本地存储
            var recIdx = cloudRecords.length;
            var recId = rec.id;
            var cloudPath = 'temp_excel/' + openid + '/' + Date.now() + '_' + (rec.id || i) + '.jpg';
            uploadTasks.push(
              (function (idx, id, path, cPath) {
                return cloud.uploadFile(path, cPath).then(function (fileID) {
                  if (fileID) {
                    cloudRecords[idx].imageFileID = fileID;
                    // 回写 _cloudFileId，下次导出不再重复上传
                    if (id) {
                      try { storage.update(id, { _cloudFileId: fileID }); } catch (e) {}
                    }
                  }
                }).catch(function (err) {
                  console.warn('[List] 图片上传失败:', path, err);
                });
              })(recIdx, recId, rec.imagePath, cloudPath)
            );
          }
        }

        cloudRecords.push(recordData);
      }

      // 执行图片上传（分批并发，避免连接数过多）
      if (uploadTasks.length > 0) {
        wx.showToast({ title: '正在上传 ' + uploadTasks.length + ' 张图片...', icon: 'none', duration: 15000 });
        for (var tStart = 0; tStart < uploadTasks.length; tStart += BATCH_SIZE) {
          var tEnd = Math.min(tStart + BATCH_SIZE, uploadTasks.length);
          await Promise.all(uploadTasks.slice(tStart, tEnd));
        }
      }

      if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
      wx.showToast({ title: '正在云端生成 Excel...', icon: 'none', duration: 20000 });
      toastTimer = setTimeout(function () {
        wx.showToast({ title: '生成中，大数据量可能需要较长时间...', icon: 'none', duration: 10000 });
      }, 20000);

      // 4. 调用云函数生成 xlsx
      var result = await cloud.generateXlsxOnCloud(cloudRecords, fileName, openid);
      if (!result || !result.success || !result.fileID) {
        throw new Error(result && result.error ? result.error : '云端生成失败，请重试');
      }

      wx.hideToast();
      if (toastTimer) clearTimeout(toastTimer);
      wx.setKeepScreenOn && wx.setKeepScreenOn({ keepScreenOn: false });

      // 5. 保存导出记录（等待完成，确保设置页可见）
      var finalFileName = result.fileName || fileName;
      storage.addExportRecord({ fileID: result.fileID, fileName: finalFileName });
      try {
        await cloud.saveExportRecordToCloud(openid, result.fileID, finalFileName);
      } catch (saveErr) {
        console.warn('[List] 云端保存导出记录失败（不影响本地记录）:', saveErr);
      }

      // 6. 提示成功
      wx.showModal({
        title: '导出完成',
        content: '文件 "' + finalFileName + '" 已上传到云端。\n前往「设置」→「云端导出文件」可随时下载。',
        confirmText: '确认',
        showCancel: false
      });
    } catch (e) {
      wx.hideToast();
      if (toastTimer) clearTimeout(toastTimer);
      wx.setKeepScreenOn && wx.setKeepScreenOn({ keepScreenOn: false });
      throw e;
    }

    // 退出导出模式
    this.setData({
      exportMode: false,
      selectedFolderIds: [],
      selectedCount: 0,
      showExportNameModal: false,
      exportFileName: ''
    }, () => {
      this._loadList();
    });
  },

  _formatTimeForFile() {
    var d = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear()
      + pad(d.getMonth() + 1)
      + pad(d.getDate()) + '_'
      + pad(d.getHours())
      + pad(d.getMinutes())
      + pad(d.getSeconds());
  },

  // 导出异常统一处理
  _onExportError(err) {
    wx.hideLoading();
    wx.setKeepScreenOn && wx.setKeepScreenOn({ keepScreenOn: false });
    console.error('[List] 导出失败:', err);
    wx.showToast({ title: '导出失败: ' + ((err && err.message) || err || ''), icon: 'none', duration: 3000 });
  },

  async _doExport(selected, customFileName, format) {
    wx.showLoading({ title: '正在生成...', mask: true });
    // 保持屏幕常亮，防止息屏导致翻译中断（切到后台仍会被微信挂起，属平台限制）
    wx.setKeepScreenOn && wx.setKeepScreenOn({ keepScreenOn: true });

    try {
      const onProgress = function (msg) {
        wx.showLoading({ title: msg, mask: true });
      };

      if (format === 'xlsx') {
        // 真实 xlsx（图片原始字节嵌入不压缩，失败不回退以暴露问题）
        await exporter.exportToXlsx(selected, customFileName, onProgress);
      } else if (format === 'xls') {
        // 伪 xls（HTML + VML，base64 图片）
        await exporter.exportToLegacyXls(selected, customFileName, onProgress);
      } else {
        // 自动模式：先 xlsx 失败回退伪 xls
        await exporter.exportToExcel(selected, customFileName, onProgress);
      }

      wx.hideLoading();
      wx.setKeepScreenOn && wx.setKeepScreenOn({ keepScreenOn: false });
      wx.showToast({ title: '导出完成', icon: 'success' });

      // 退出导出模式
      this.setData({
        exportMode: false,
        selectedFolderIds: [],
        selectedCount: 0,
        showExportNameModal: false,
        exportFileName: ''
      }, () => {
        this._loadList();
      });
    } catch (e) {
      wx.hideLoading();
      wx.setKeepScreenOn && wx.setKeepScreenOn({ keepScreenOn: false });
      console.error('[List] 导出失败:', e);
      wx.showToast({ title: '导出失败: ' + (e.message || e || ''), icon: 'none' });
    }
  },

  closeExportNameModal() {
    this.setData({ showExportNameModal: false, exportFileName: '' });
  },

  // ===== 清空 =====

  // ===== 回收站 =====

  formatTrashTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  },

  onShowTrash() {
    var trash = storage.getTrash();
    this.setData({ trashMode: true, trashList: trash, trashCount: trash.length });
    this._collapseAllSwipe();
  },

  onExitTrash() {
    this.setData({ trashMode: false, trashList: [], trashCount: storage.getTrashCount() });
    this._loadFolders();
    this._loadList();
  },

  onRestoreFromTrash(e) {
    var id = e.currentTarget.dataset.id;
    storage.restoreFromTrash(id);
    var trash = storage.getTrash();
    this.setData({ trashList: trash, trashCount: trash.length });
    wx.showToast({ title: '已恢复', icon: 'success' });
    if (trash.length === 0) {
      this.onExitTrash();
    }
  },

  onEmptyTrash() {
    var that = this;
    wx.showModal({
      title: '清空回收站',
      content: '将永久删除回收站中的所有记录，此操作不可恢复。',
      success: function (res) {
        if (res.confirm) {
          storage.emptyTrash();
          that.setData({ trashMode: false, trashList: [], trashCount: 0 });
          that._loadFolders();
          that._loadList();
          wx.showToast({ title: '回收站已清空', icon: 'success' });
        }
      }
    });
  },

  onClear() {
    if (this.data.list.length === 0) return;
    const that = this;
    wx.showModal({
      title: '清空确认',
      content: '将删除本地所有未同步到云端的记录和文件夹。已同步到云端的记录仍在云存储中，重新开启同步后会再次下载到本地。\n\n注意：已保存到系统相册的照片不受影响。',
      success(res) {
        if (res.confirm) {
          storage.clearAll();
          that.setData({ activeFolderId: null, selectedFolderIds: [] });
          that._loadFolders();
          that._loadList();
        }
      }
    });
  },

  onNavReady(e) {
    this.setData({ navTotalHeight: e.detail.totalNavBarHeight });
  },

});
