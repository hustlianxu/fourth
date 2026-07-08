// pages/dict/dict.js
const translator = require('../../utils/translator.js');
const builtin = require('../../utils/builtinDict.js');

const PROVIDER_PRESETS = {
  deepseek: { baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' },
  glm:      { baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  qwen:     { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' },
  bailian:  { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  minimax:  { baseURL: 'https://api.minimaxi.com/v1', model: 'MiniMax-M3' },
  mimo:     { baseURL: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-pro' },
  custom:   { baseURL: '', model: '' }
};

const PROVIDER_LABELS = {
  deepseek: 'DeepSeek',
  glm:      '智谱GLM',
  qwen:     '通义千问',
  bailian:  '阿里百炼',
  minimax:  'MiniMax',
  mimo:     '小米MiMo',
  custom:   '自定义'
};

const PROVIDER_KEYS = ['deepseek', 'glm', 'qwen', 'bailian', 'minimax', 'mimo', 'custom'];

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
    providerList: [],
    baseURL: '',
    apiKey: '',
    model: '',
    // Prompt
    customPrompt: '',
    promptPreview: '',
    testResult: '',
    // 免费词典层
    freeDictEnabled: false,
    freeDictProvider: '',
    youdaoAppId: '',
    youdaoSecret: '',
    navTotalHeight: 0,
    freeDictTestResult: ''
  },


  onLoad() {
    this.setData({
      customDict: translator.getUserDict(),
      customWhitelist: translator.getUserWhitelist(),
      builtinWhitelist: builtin.WHITELIST,
      builtinDict: builtin.BUILTIN_DICT,
      filteredBuiltin: builtin.BUILTIN_DICT,
      customPrompt: translator.getCustomPrompt() || '',
      llmFirst: translator.getLLMFirst()
    });
    this._loadConfig();
    this._loadFreeDictConfig();
    this._refreshPromptPreview();
  },

  // ===== 免费词典层配置 =====
  _loadFreeDictConfig() {
    const fcfg = translator.getFreeDictConfig();
    const yd = translator.getYoudaoCreds();
    this.setData({
      freeDictEnabled: fcfg.enabled,
      freeDictProvider: fcfg.provider,
      youdaoAppId: yd.appId,
      youdaoSecret: yd.secret
    });
  },

  onToggleFreeDict(e) {
    const enabled = e.detail.value;
    const provider = enabled ? (this.data.freeDictProvider || 'mymemory') : '';
    translator.setFreeDictConfig({ enabled: enabled, provider: provider });
    this.setData({ freeDictEnabled: enabled, freeDictProvider: provider });
  },

  onPickFreeDictProvider(e) {
    const p = e.currentTarget.dataset.provider;
    translator.setFreeDictConfig({ enabled: true, provider: p });
    this.setData({ freeDictProvider: p });
  },

  onYoudaoAppIdInput(e) {
    this.setData({ youdaoAppId: e.detail.value });
  },

  onYoudaoSecretInput(e) {
    this.setData({ youdaoSecret: e.detail.value });
  },

  onSaveYoudao() {
    const appId = (this.data.youdaoAppId || '').trim();
    const secret = (this.data.youdaoSecret || '').trim();
    if (!appId || !secret) {
      wx.showToast({ title: '请填写 App ID 和密钥', icon: 'none' });
      return;
    }
    translator.setYoudaoCreds({ appId: appId, secret: secret });
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  onTestFreeDict() {
    const fcfg = translator.getFreeDictConfig();
    if (!fcfg.enabled || !fcfg.provider) {
      wx.showToast({ title: '请先开启免费词典', icon: 'none' });
      return;
    }
    if (fcfg.provider === 'youdao') {
      const yd = translator.getYoudaoCreds();
      if (!yd.appId || !yd.secret) {
        wx.showToast({ title: '请先配置有道凭证', icon: 'none' });
        return;
      }
    }
    this.setData({ freeDictTestResult: '翻译中（' + fcfg.provider + '）...' });
    const that = this;
    // 用一个本地未命中的中文词测试（如「西班牙语」）
    translator.callFreeDict('西班牙语', 'zh', 'es').then(function (r) {
      if (r) {
        that.setData({ freeDictTestResult: '西班牙语  →  ' + r + '\n（来源：' + fcfg.provider + '）' });
      } else {
        that.setData({ freeDictTestResult: '调用失败或返回空，请检查网络/凭证/配额' });
      }
    });
  },

  _loadConfig() {
    const cfg = translator.getConfig() || {};
    let provider = cfg.provider || 'deepseek';
    // 数据迁移：旧版用 'zhipu'，现统一为 'glm'
    if (provider === 'zhipu') {
      provider = 'glm';
      const oldKey = translator.getApiKey('zhipu');
      if (oldKey) translator.setApiKey('glm', oldKey);
      translator.setConfig({ provider: 'glm' });
    }
    const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom;
    // baseURL/model/apiKey 按 provider 独立读取，未存过则用预设填充
    let baseURL = translator.getBaseURL(provider);
    if (!baseURL) { baseURL = preset.baseURL; translator.setBaseURL(provider, baseURL); }
    let model = translator.getModel(provider);
    if (!model) { model = preset.model; translator.setModel(provider, model); }
    let apiKey = translator.getApiKey(provider);
    // 旧版数据迁移：STORAGE_APIKEYS_KEY → STORAGE_PROFILES_KEY
    if (!apiKey) {
      try {
        const oldKeys = wx.getStorageSync('watermark_translator_apikeys');
        if (oldKeys && oldKeys[provider]) {
          apiKey = oldKeys[provider];
          translator.setApiKey(provider, apiKey);
        }
      } catch (e) {}
    }
    this.setData({
      provider: provider,
      baseURL: baseURL,
      apiKey: apiKey || '',
      model: model,
      providerList: PROVIDER_KEYS.map(k => ({
        key: k,
        label: PROVIDER_LABELS[k] || k,
        active: k === provider
      }))
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
    // 1) 先保存当前 provider 的 baseURL/model/apiKey（避免切换时丢失）
    translator.setBaseURL(this.data.provider, this.data.baseURL.trim());
    translator.setModel(this.data.provider, this.data.model.trim());
    if (this.data.apiKey) {
      translator.setApiKey(this.data.provider, this.data.apiKey.trim());
    }
    // 2) 加载目标 provider 的配置（未存过则用预设填充）
    const preset = PROVIDER_PRESETS[p] || PROVIDER_PRESETS.custom;
    let newBaseURL = translator.getBaseURL(p);
    if (!newBaseURL) { newBaseURL = preset.baseURL; translator.setBaseURL(p, newBaseURL); }
    let newModel = translator.getModel(p);
    if (!newModel) { newModel = preset.model; translator.setModel(p, newModel); }
    const newApiKey = translator.getApiKey(p);
    // 3) 自动保存当前选中的 provider（切页面回来仍能记住）
    translator.setConfig({ provider: p });
    this.setData({
      provider: p,
      baseURL: newBaseURL || '',
      model: newModel || '',
      apiKey: newApiKey || '',
      providerList: PROVIDER_KEYS.map(k => ({
        key: k,
        label: PROVIDER_LABELS[k] || k,
        active: k === p
      }))
    });
  },

  onBaseURLInput(e) {
    const v = e.detail.value;
    this.setData({ baseURL: v });
    // 实时按 provider 单独存（边输入边保存）
    translator.setBaseURL(this.data.provider, v.trim());
  },
  onModelInput(e) {
    const v = e.detail.value;
    this.setData({ model: v });
    // 实时按 provider 单独存
    translator.setModel(this.data.provider, v.trim());
  },
  onAPIKeyInput(e) {
    const v = e.detail.value;
    this.setData({ apiKey: v });
    // 实时按 provider 单独存
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

  onLLMFirstToggle(e) {
    const enabled = e.detail.value;
    translator.setLLMFirst(enabled);
    this.setData({ llmFirst: enabled });
    wx.showToast({ title: enabled ? '已开启 LLM 优先' : '已关闭 LLM 优先', icon: 'success' });
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
  },

  onNavReady(e) {
    this.setData({ navTotalHeight: e.detail.totalNavBarHeight });
  },

});
