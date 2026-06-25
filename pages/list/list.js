// pages/list/list.js
const storage = require('../../utils/storage.js');
const templates = require('../../utils/templates.js');
const exporter = require('../../utils/exporter.js');

const MAX_FOLDERS = 30;

// 左滑操作按钮总宽度（4个按钮 × 70px ≈ 280px）
const SWIPE_ACTION_WIDTH = 280;
// 右滑选中触发阈值（px）
const SWIPE_SELECT_THRESHOLD = 60;

Page({
  data: {
    list: [],
    folders: [],
    loading: true,
    activeFolderId: null,        // null=全部, '__uncategorized__'=未分类, 其他=folder.id（普通模式使用）
    totalCount: 0,
    uncategorizedCount: 0,
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
  },

  onShow() {
    this._loadFolders();
    this._loadList();
    // 模拟短暂加载状态（让骨架屏可见）
    setTimeout(() => this.setData({ loading: false }), 300);
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
    let newX = this._swipeStartSwipeX - dx;
    newX = Math.max(0, Math.min(newX, SWIPE_ACTION_WIDTH));
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
    const finalX = record._swipeX >= threshold ? SWIPE_ACTION_WIDTH : 0;
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
      allFoldersSelected: this._allFoldersSelected()
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
    const list = raw.map((item) => {
      const date = new Date(item.createdAt);
      return Object.assign({}, item, {
        timeText: templates.formatDateTime(date),
        summary: this._buildSummary(item),
        _checked: !!prevCheckedMap[item.id],
        _swipeX: 0,
        _swiping: false,
        _swipeAnim: true,
        _swipeActionsW: 0
      });
    });
    // 按创建时间倒序
    list.sort((a, b) => b.createdAt - a.createdAt);

    // 导出模式下，如果有选中文件夹则自动勾选所有记录
    if (this.data.exportMode && this.data.selectedFolderIds.length > 0) {
      list.forEach(item => { item._checked = true; });
    }

    const count = list.filter(i => i._checked).length;
    this.setData({ list: list, selectedCount: count });
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

    this.setData({ showFolderModal: false, editingFolderId: null, folderNameInput: '' });
    this._loadFolders();
    wx.showToast({ title: isRename ? '已重命名' : '文件夹已创建', icon: 'success' });
  },

  closeFolderModal() {
    this.setData({ showFolderModal: false, editingFolderId: null, folderNameInput: '' });
  },

  // ===== 删除文件夹确认弹层 =====

  onDeleteFolderWithRecords() {
    const folderId = this.data.deleteFolderId;
    const records = storage.getByFolderId(folderId);

    records.forEach(r => storage.remove(r.id));
    storage.removeFolder(folderId);

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
    wx.showToast({ title: '已删除文件夹及记录', icon: 'success' });
  },

  onDeleteFolderKeepRecords() {
    const folderId = this.data.deleteFolderId;
    const records = storage.getByFolderId(folderId);

    records.forEach(r => storage.update(r.id, { folderId: null }));
    storage.removeFolder(folderId);

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
      content: '确定要删除本条记录吗？',
      success(res) {
        if (res.confirm) {
          storage.remove(id);
          that._loadFolders();
          that._loadList();
          wx.showToast({ title: '已删除', icon: 'success' });
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
    var count = 0;
    const list = this.data.list.map(item => {
      if (item.id === id) {
        item._checked = !item._checked;
      }
      if (item._checked) count++;
      return item;
    });
    this.setData({ list, selectedCount: count });
  },

  selectAll() {
    const list = this.data.list.map(item => {
      item._checked = true;
      return item;
    });
    this.setData({ list, selectedCount: list.length });
  },

  deselectAll() {
    const list = this.data.list.map(item => {
      item._checked = false;
      return item;
    });
    this.setData({ list, selectedCount: 0 });
  },

  // ===== 批量选择模式（右滑触发，渐进式选中态，不替换顶部栏） =====

  // 右滑触发：进入选中态并选中当前记录
  _enterBatchAndToggle(id) {
    // 进入选中态：清空旧选中态并选中当前记录
    const list = this.data.list.map(item => Object.assign({}, item, { _checked: false }));
    const idx = list.findIndex(r => r.id === id);
    if (idx >= 0) list[idx]._checked = true;
    this._collapseAllSwipe();
    this.setData({ list, batchMode: true, batchSelectedCount: 1 });
  },

  // 选中态下点击记录：切换选中态
  onBatchToggle(e) {
    if (!this.data.batchMode) return;
    const id = e.currentTarget.dataset.id;
    let count = 0;
    const list = this.data.list.map(item => {
      if (item.id === id) item._checked = !item._checked;
      if (item._checked) count++;
      return item;
    });
    // 选中数归0 → 自动退出选中态
    if (count === 0) {
      this._exitBatchMode(list);
    } else {
      this.setData({ list, batchSelectedCount: count });
    }
  },

  // 选中态：全选当前列表
  onBatchSelectAll() {
    const list = this.data.list.map(item => Object.assign({}, item, { _checked: true }));
    this.setData({ list, batchSelectedCount: list.length });
  },

  // 退出选中态（点✕或取消）
  onBatchCancel() {
    this._exitBatchMode();
  },

  // 内部：退出选中态，清空选中标记
  _exitBatchMode(list) {
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
    const selected = this.data.list.filter(item => item._checked);
    const ids = selected.map(item => item.id);
    this.setData({ showBatchDeleteModal: false });
    wx.showLoading({ title: '删除中...', mask: true });
    try {
      ids.forEach(id => storage.remove(id));
      wx.hideLoading();
      wx.showToast({ title: '已删除 ' + ids.length + ' 条', icon: 'success' });
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
    const selected = this.data.list.filter(item => item._checked);
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

    this.setData({
      showExportNameModal: true,
      exportFileName: defaultName
    });
  },

  onExportNameInput(e) {
    this.setData({ exportFileName: e.detail.value });
  },

  async onConfirmExport() {
    const selected = this.data.list.filter(item => item._checked);
    if (selected.length === 0) return;

    const customFileName = this.data.exportFileName.trim() || null;

    wx.showLoading({ title: '正在生成...', mask: true });

    try {
      await exporter.exportToExcel(selected, customFileName, function (msg) {
        wx.showLoading({ title: msg, mask: true });
      });

      wx.hideLoading();
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
      console.error('[List] 导出失败:', e);
      wx.showToast({ title: '导出失败: ' + (e.message || '').slice(0, 15), icon: 'none' });
    }
  },

  closeExportNameModal() {
    this.setData({ showExportNameModal: false, exportFileName: '' });
  },

  // ===== 清空 =====

  onClear() {
    if (this.data.list.length === 0) return;
    const that = this;
    wx.showModal({
      title: '清空确认',
      content: '将删除本地所有记录和文件夹（仅删除数据库记录，已保存到相册的照片不受影响）。',
      success(res) {
        if (res.confirm) {
          storage.clearAll();
          that.setData({ activeFolderId: null, selectedFolderIds: [] });
          that._loadFolders();
          that._loadList();
        }
      }
    });
  }
});
