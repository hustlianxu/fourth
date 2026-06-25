// pages/dict/dict.js
const translator = require('../../utils/translator.js');
const builtin = require('../../utils/builtinDict.js');

const PROVIDER_PRESETS = {
  deepseek: { baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  zhipu:   { baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  qwen:    { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' },
  mimo:    { baseURL: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-pro' },
  custom:  { baseURL: '', model: '' }
};

Page({
  data: {
    activeTab: 'custom',          // 'custom' | 'whitelist' | 'builtin' | 'api'
    // 自定义词典
    customDict: [],
    // 白名单
    customWhitelist: [],
    builtinWhitelist: [],
    newWhitelistWord: '',
    // 内置词典
    builtinDict: [],
    filteredBuiltin: [],
    searchKeyword: '',
    // 词条编辑弹层
    showEditModal: false,
    editingIndex: -1,
    editZh: '',
    editEs: '',
    // API 配置
    provider: 'deepseek',
    baseURL: '',
    apiKey: '',
    model: '',
    // Prompt
    customPrompt: '',
    promptPreview: '',
    testResult: ''
  },

  onLoad() {
    this.setData({
      customDict: translator.getUserDict(),
      customWhitelist: translator.getUserWhitelist(),
      builtinWhitelist: builtin.WHITELIST,
      builtinDict: builtin.BUILTIN_DICT,
      filteredBuiltin: builtin.BUILTIN_DICT,
      customPrompt: translator.getCustomPrompt() || ''
    });
    this._loadConfig();
    this._refreshPromptPreview();
  },

  _loadConfig() {
    const cfg = translator.getConfig() || {};
    const provider = cfg.provider || 'deepseek';
    const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom;
    // apiKey 按 provider 独立存储，切换 provider 时加载对应 key
    const apiKey = translator.getApiKey(provider);
    this.setData({
      provider: provider,
      baseURL: cfg.baseURL || preset.baseURL,
      apiKey: apiKey || '',
      model: cfg.model || preset.model
    });
  },

  // ===== Tab 切换 =====
  onSwitchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  // ===== 自定义词典 CRUD =====
  onAddItem() {
    this.setData({ showEditModal: true, editingIndex: -1, editZh: '', editEs: '' });
  },

  onEditItem(e) {
    const idx = e.currentTarget.dataset.index;
    const item = this.data.customDict[idx];
    this.setData({ showEditModal: true, editingIndex: idx, editZh: item.zh, editEs: item.es });
  },

  onDeleteItem(e) {
    const idx = e.currentTarget.dataset.index;
    const item = this.data.customDict[idx];
    const that = this;
    wx.showModal({
      title: '删除词条',
      content: '确定删除「' + item.zh + ' ↔ ' + item.es + '」？',
      success(res) {
        if (!res.confirm) return;
        const list = that.data.customDict.slice();
        list.splice(idx, 1);
        translator.setUserDict(list);
        that.setData({ customDict: list });
        wx.showToast({ title: '已删除', icon: 'success' });
      }
    });
  },

  onCloseEdit() {
    this.setData({ showEditModal: false });
  },

  onEditZhInput(e) { this.setData({ editZh: e.detail.value }); },
  onEditEsInput(e) { this.setData({ editEs: e.detail.value }); },

  onConfirmEdit() {
    const zh = this.data.editZh.trim();
    const es = this.data.editEs.trim();
    if (!zh) { wx.showToast({ title: '请输入中文', icon: 'none' }); return; }
    if (!es) { wx.showToast({ title: '请输入西语', icon: 'none' }); return; }

    const list = this.data.customDict.slice();
    if (this.data.editingIndex >= 0) {
      list[this.data.editingIndex] = { zh: zh, es: es };
    } else {
      list.push({ zh: zh, es: es });
    }
    translator.setUserDict(list);
    this.setData({ customDict: list, showEditModal: false });
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  // ===== 白名单管理 =====
  onNewWhitelistInput(e) {
    this.setData({ newWhitelistWord: e.detail.value });
  },

  onAddWhitelist() {
    const word = (this.data.newWhitelistWord || '').trim();
    if (!word) { wx.showToast({ title: '请输入词', icon: 'none' }); return; }
    // 去重（与自定义 + 内置白名单比对）
    const merged = translator.getMergedWhitelist();
    const exists = merged.some(function (w) { return w.toLowerCase() === word.toLowerCase(); });
    if (exists) { wx.showToast({ title: '该词已在白名单', icon: 'none' }); return; }

    const list = this.data.customWhitelist.slice();
    list.push(word);
    translator.setUserWhitelist(list);
    this.setData({ customWhitelist: list, newWhitelistWord: '' });
    this._refreshPromptPreview();
    wx.showToast({ title: '已添加', icon: 'success' });
  },

  onRemoveWhitelist(e) {
    const idx = e.currentTarget.dataset.index;
    const list = this.data.customWhitelist.slice();
    const removed = list[idx];
    list.splice(idx, 1);
    translator.setUserWhitelist(list);
    this.setData({ customWhitelist: list });
    this._refreshPromptPreview();
    wx.showToast({ title: '已移除 ' + removed, icon: 'none' });
  },

  // ===== Prompt 管理 =====
  onPromptInput(e) {
    this.setData({ customPrompt: e.detail.value });
  },

  onSavePrompt() {
    const p = this.data.customPrompt.trim();
    translator.setCustomPrompt(p);
    this._refreshPromptPreview();
    wx.showToast({ title: p ? 'Prompt 已保存' : '已恢复默认 Prompt', icon: 'success' });
  },

  onResetPrompt() {
    this.setData({ customPrompt: '' });
    translator.setCustomPrompt('');
    this._refreshPromptPreview();
    wx.showToast({ title: '已恢复默认', icon: 'none' });
  },

  // 刷新 prompt 预览（用示例文本 con luz y música 演示）
  _refreshPromptPreview() {
    const preview = translator.buildPrompt('con luz y música', 'es', 'zh');
    this.setData({ promptPreview: preview });
  },

  // ===== 内置词典搜索 =====
  onSearchInput(e) {
    const kw = (e.detail.value || '').trim().toLowerCase();
    if (!kw) {
      this.setData({ searchKeyword: kw, filteredBuiltin: this.data.builtinDict });
      return;
    }
    const filtered = this.data.builtinDict.filter(function (item) {
      return item.zh.toLowerCase().indexOf(kw) >= 0 || item.es.toLowerCase().indexOf(kw) >= 0;
    });
    this.setData({ searchKeyword: kw, filteredBuiltin: filtered });
  },

  // ===== API 配置 =====
  onPickProvider(e) {
    const p = e.currentTarget.dataset.provider;
    // 先保存当前 provider 的 key（避免切换时丢失）
    if (this.data.apiKey) {
      translator.setApiKey(this.data.provider, this.data.apiKey.trim());
    }
    const preset = PROVIDER_PRESETS[p];
    // 加载目标 provider 的 key
    const newApiKey = translator.getApiKey(p);
    this.setData({
      provider: p,
      baseURL: preset.baseURL || this.data.baseURL,
      model: preset.model || this.data.model,
      apiKey: newApiKey || ''
    });
  },

  onBaseURLInput(e) { this.setData({ baseURL: e.detail.value }); },
  onModelInput(e) { this.setData({ model: e.detail.value }); },
  onAPIKeyInput(e) {
    const v = e.detail.value;
    this.setData({ apiKey: v });
    // 实时按 provider 单独存（边输入边保存，避免丢失）
    translator.setApiKey(this.data.provider, v.trim());
  },

  onSaveConfig() {
    const cfg = {
      provider: this.data.provider,
      baseURL: this.data.baseURL.trim(),
      apiKey: this.data.apiKey.trim(),
      model: this.data.model.trim()
    };
    if (!cfg.baseURL || !cfg.apiKey || !cfg.model) {
      wx.showToast({ title: '请填写完整配置', icon: 'none' });
      return;
    }
    translator.setConfig(cfg);
    wx.showToast({ title: '配置已保存', icon: 'success' });
  },

  onTestTranslate() {
    const cfg = translator.getConfig();
    if (!cfg || !cfg.apiKey) {
      wx.showToast({ title: '请先填写并保存 API Key', icon: 'none' });
      return;
    }
    this.setData({ testResult: '翻译中（调用 ' + cfg.provider + '）...' });
    const that = this;
    // withDebug=true 返回 {result, debug}
    translator.translate('con luz y música', 'es', 'zh', true).then(function (r) {
      const result = (r && r.result) || '(无结果)';
      const d = (r && r.debug) || {};
      let sourceLabel = '';
      if (d.source === 'api') {
        sourceLabel = '✅ 走了 API（' + d.provider + '，耗时 ' + d.elapsed + 'ms）';
      } else if (d.source === 'local_all') {
        sourceLabel = '⚠ 全部本地命中，未调 API';
      } else if (d.source === 'local_no_api') {
        sourceLabel = '⚠ 未配置 API，仅本地翻译';
      } else if (d.source === 'local_api_fail') {
        sourceLabel = '❌ API 调用失败（' + (d.elapsed || 0) + 'ms），降级本地';
      } else {
        sourceLabel = '来源: ' + d.source;
      }
      const missInfo = d.missSegments && d.missSegments.length
        ? '\n未命中本地词库: ' + d.missSegments.join(', ')
        : '';
      const reasonInfo = d.reason ? '\n原因: ' + d.reason : '';
      that.setData({
        testResult: 'con luz y música  →  ' + result +
          '\n\n' + sourceLabel + missInfo + reasonInfo
      });
    });
  }
});
