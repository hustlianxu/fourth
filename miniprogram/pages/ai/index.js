/**
 * AI 持仓分析页面
 */
const api = require('../../utils/api');
const { formatMoney, formatDate, getPriceColor } = require('../../utils/format');
const { ANALYSIS_TYPES, LLM_PROVIDERS } = require('../../utils/constants');

Page({
  data: {
    loading: true,
    analyzing: false,
    canAnalyze: false,
    providerConfigured: false,
    providerIndex: 0,
    providerNames: [],
    selectedProviderName: '',
    selectedProvider: 'deepseek',
    selectedType: 'portfolio_health',
    analysisTypes: ANALYSIS_TYPES,
    summary: {
      totalAssets: 0,
      totalPnL: 0,
      holdings: [],
      holdingCount: 0,
      accountCount: 0,
    },
    result: {
      show: false,
      summary: '',
      keyFindings: [],
      riskLevel: '',
      content: '',
      date: '',
    },
    historyReports: [],
    qaQuestion: '',
    qaAnswer: '',
    pnlColor: 'price-flat',
  },

  onLoad() {
    this.initProviders();
  },

  onShow() {
    this.loadData();
    this.loadLLMConfig();
    this.loadHistory();
  },

  initProviders() {
    const names = LLM_PROVIDERS.map(p => `${p.icon} ${p.name}`);
    this.setData({
      providerNames: names,
      selectedProviderName: names[0] || '请选择模型',
    });
  },

  async loadData() {
    this.setData({ loading: true });
    try {
      const summary = await api.getPortfolioSummary();
      const accountCount = summary.accounts ? summary.accounts.length : 0;
      this.setData({
        summary: { ...summary, accountCount },
        pnlColor: getPriceColor(summary.totalPnL),
        canAnalyze: summary.holdings && summary.holdings.length > 0 && this.data.providerConfigured,
        loading: false,
      });
    } catch (err) {
      console.error('[AI] loadData error:', err);
      this.setData({ loading: false });
    }
  },

  async loadLLMConfig() {
    try {
      const config = await api.getLLMConfig();
      if (config && config.providers) {
        const configured = Object.entries(config.providers)
          .filter(([k, v]) => v.enabled && v.api_key)
          .map(([k]) => k);
        this.setData({
          providerConfigured: configured.length > 0,
        });
        // 检查当前选中的模型是否已配置
        if (configured.includes(this.data.selectedProvider)) {
          this.setData({ providerConfigured: true });
        }
      }
      this.updateCanAnalyze();
    } catch (err) {
      console.error('[AI] loadLLMConfig error:', err);
    }
  },

  async loadHistory() {
    try {
      const reports = await api.getAnalysisReports();
      this.setData({ historyReports: reports });
    } catch (err) {
      console.error('[AI] loadHistory error:', err);
    }
  },

  updateCanAnalyze() {
    this.setData({
      canAnalyze: this.data.summary.holdings &&
                  this.data.summary.holdings.length > 0 &&
                  this.data.providerConfigured,
    });
  },

  onProviderChange(e) {
    const index = e.detail.value;
    const provider = LLM_PROVIDERS[index];
    this.setData({
      providerIndex: index,
      selectedProvider: provider.key,
      selectedProviderName: `${provider.icon} ${provider.name}`,
    });
    this.loadLLMConfig();
  },

  onTypeSelect(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ selectedType: key });
  },

  async onStartAnalysis() {
    if (!this.data.canAnalyze || this.data.analyzing) return;

    this.setData({ analyzing: true });
    wx.showLoading({ title: 'AI 分析中...', mask: true });

    try {
      const res = await api.analyzePortfolio(
        this.data.selectedType,
        this.data.selectedProvider
      );

      if (res && res.success) {
        const report = res.report || {};
        this.setData({
          result: {
            show: true,
            summary: report.summary || '',
            keyFindings: report.key_findings || [],
            riskLevel: report.risk_level || '',
            content: report.report_content || '',
            date: formatDate(new Date()),
          },
        });
        wx.hideLoading();
        // 刷新历史报告
        this.loadHistory();
      } else {
        wx.hideLoading();
        wx.showToast({ title: res?.message || '分析失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '网络错误或 API Key 无效', icon: 'none' });
      console.error('[AI] analysis error:', err);
    }

    this.setData({ analyzing: false });
  },

  onViewHistory(e) {
    const report = e.currentTarget.dataset.report;
    wx.navigateTo({
      url: `/pages/ai/report-detail?id=${report._id}`,
    });
  },

  async onAskQuestion() {
    const question = this.data.qaQuestion.trim();
    if (!question) return;

    this.setData({ qaAnswer: '' });
    wx.showLoading({ title: '思考中...', mask: true });

    try {
      const res = await api.askAI(question, this.data.selectedProvider);
      wx.hideLoading();

      if (res && res.success) {
        this.setData({ qaAnswer: res.answer || '暂无回答' });
      } else {
        wx.showToast({ title: res?.message || '回答失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  onQuickQuestion(e) {
    const q = e.currentTarget.dataset.q;
    this.setData({ qaQuestion: q }, () => {
      this.onAskQuestion();
    });
  },

  analysisTypeName(typeKey) {
    const found = ANALYSIS_TYPES.find(t => t.key === typeKey);
    return found ? found.name : typeKey;
  },

  formatMoney,
  formatDate,
});
