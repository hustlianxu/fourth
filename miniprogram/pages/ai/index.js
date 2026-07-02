/**
 * AI 持仓分析页面
 * - 支持多 AI 协作：选中多个分析师独立分析，再由汇总模型综合
 * - 单选时退化为单模型分析（向后兼容）
 * - Markdown 渲染 / 超时续传 / 结果导出
 */
const api = require('../../utils/api');
const { formatMoney, formatDate, getPriceColor } = require('../../utils/format');
const { ANALYSIS_TYPES, LLM_PROVIDERS } = require('../../utils/constants');
const { mdToHtml } = require('../../utils/markdown');

const DB = wx.cloud.database();

Page({
  data: {
    loading: true,
    analyzing: false,
    canAnalyze: false,
    providerConfigured: false,
    configuredProviders: [],
    analysts: [],
    analystSelected: {},      // { providerKey: true } 供 WXML 成员访问判断选中态（WXML 不支持 .indexOf()）
    synthIndex: 0,
    synthNames: [],
    selectedType: 'portfolio_health',
    analysisTypes: ANALYSIS_TYPES,
    summary: { totalAssets: 0, totalPnL: 0, holdings: [], holdingCount: 0, accountCount: 0 },
    result: {
      show: false,
      summary: '', summaryHtml: '',
      keyFindings: [],
      riskLevel: '',
      content: '', contentHtml: '',
      date: '',
      multiMode: false,
      subReports: [],
    },
    showSubReports: false,
    historyReports: [],
    qaQuestion: '',
    qaAnswer: '', qaAnswerHtml: '',
    canAsk: false,
    pnlColor: 'price-flat',
    progress: '',               // 分析进度文案
    taskId: '',                 // 异步任务 ID（超时续传用）
    timedOut: false,            // 是否超时
  },

  onShow() {
    this.loadData();
    this.loadLLMConfig();
    this.loadHistory();
  },

  async loadData() {
    this.setData({ loading: true });
    try {
      const summary = await api.getPortfolioSummary();
      const accountCount = summary.accounts ? summary.accounts.length : 0;
      this.setData({
        summary: { ...summary, accountCount },
        pnlColor: getPriceColor(summary.totalAllPnL != null ? summary.totalAllPnL : summary.totalPnL),
        loading: false,
      });
      this.updateCanAnalyze();
    } catch (err) {
      console.error('[AI] loadData error:', err);
      this.setData({ loading: false });
    }
  },

  async loadLLMConfig() {
    try {
      const config = await api.getLLMConfig();
      let configuredProviders = [];
      if (config && config.providers) {
        configuredProviders = LLM_PROVIDERS
          .filter(p => config.providers[p.key] && config.providers[p.key].enabled && config.providers[p.key].api_key)
          .map(p => ({ key: p.key, name: p.name }));
      }
      const providerConfigured = configuredProviders.length > 0;
      let analysts = this.data.analysts;
      if (analysts.length === 0 && configuredProviders.length > 0) {
        analysts = [configuredProviders[0].key];
      } else if (configuredProviders.length > 0) {
        analysts = analysts.filter(k => configuredProviders.some(p => p.key === k));
        if (analysts.length === 0) analysts = [configuredProviders[0].key];
      } else {
        analysts = [];
      }
      this.setData({ configuredProviders, providerConfigured, analysts });
      this._syncAnalystSelected();
      this.updateSynthNames();
      this.updateCanAnalyze();
    } catch (err) {
      console.error('[AI] loadLLMConfig error:', err);
    }
  },

  /** 由 analysts 数组派生 analystSelected 对象 map（WXML 不支持 .indexOf()，改用成员访问） */
  _syncAnalystSelected() {
    const map = {};
    this.data.analysts.forEach(k => { map[k] = true; });
    this.setData({ analystSelected: map });
  },

  async loadHistory() {
    try {
      const reports = await api.getAnalysisReports();
      this.setData({ historyReports: reports });
      if (reports.length > 0 && !this.data.result.show) {
        const latest = reports[0];
        this.setData({
          result: {
            show: true,
            summary: latest.summary || '',
            summaryHtml: mdToHtml(latest.summary || ''),
            keyFindings: latest.key_findings || [],
            riskLevel: latest.risk_level || '',
            content: latest.report_content || '',
            contentHtml: mdToHtml(latest.report_content || ''),
            date: formatDate(new Date(latest.created_at)),
            multiMode: false,
            subReports: [],
          },
        });
      }
    } catch (err) {
      console.error('[AI] loadHistory error:', err);
    }
  },

  updateCanAnalyze() {
    this.setData({
      canAnalyze: this.data.summary.holdings &&
                  this.data.summary.holdings.length > 0 &&
                  this.data.providerConfigured &&
                  this.data.analysts.length > 0,
    });
  },

  onToggleAnalyst(e) {
    const key = e.currentTarget.dataset.key;
    let analysts = this.data.analysts.slice();
    const idx = analysts.indexOf(key);
    if (idx >= 0) {
      if (analysts.length <= 1) {
        wx.showToast({ title: '至少选择 1 个模型', icon: 'none' });
        return;
      }
      analysts.splice(idx, 1);
    } else {
      analysts.push(key);
    }
    this.setData({ analysts });
    this._syncAnalystSelected();
    this.updateSynthNames();
    this.updateCanAnalyze();
  },

  updateSynthNames() {
    const selected = this.data.configuredProviders.filter(p => this.data.analysts.indexOf(p.key) >= 0);
    const synthNames = selected.map(p => p.name);
    let synthIndex = this.data.synthIndex;
    if (synthIndex >= synthNames.length) synthIndex = 0;
    this.setData({ synthNames, synthIndex });
  },

  onSynthChange(e) {
    this.setData({ synthIndex: parseInt(e.detail.value, 10) });
  },

  onTypeSelect(e) {
    this.setData({ selectedType: e.currentTarget.dataset.key });
  },

  // ==============================
  //  分析主流程（含超时续传）
  // ==============================
  async onStartAnalysis() {
    if (!this.data.canAnalyze || this.data.analyzing) return;
    const analysts = this.data.analysts;
    if (analysts.length === 0) return;

    this.setData({
      analyzing: true,
      showSubReports: false,
      timedOut: false,
      taskId: '',
      progress: '',
      'result.show': false,
    });

    const multi = analysts.length > 1;
    // 用 showLoading 但每隔 8s 更新文案，让用户感知进度
    this.showProgress(multi ? `多模型分析中（第 1/${analysts.length} 步）...` : 'AI 分析中...');

    try {
      // 预先在 DB 创建一条任务记录（用于超时后续传）
      const taskRes = await DB.collection('analysis_tasks').add({
        data: {
          _openid: wx.cloud.getWXContext ? '' : '',
          type: this.data.selectedType,
          analysts,
          status: 'processing',
          progress: 0,
          created_at: DB.serverDate(),
          updated_at: DB.serverDate(),
        },
      });
      const taskId = taskRes._id;
      this.setData({ taskId });

      let res;
      if (multi) {
        const synthKey = this.data.analysts[this.data.synthIndex] || analysts[0];
        this.setData({ progress: `多模型协作分析中（${analysts.length} 个模型并行）...` });
        res = await api.analyzePortfolioMulti(this.data.selectedType, analysts, synthKey);
      } else {
        res = await api.analyzePortfolio(this.data.selectedType, analysts[0]);
      }

      // 标记任务完成
      this.finishTask(taskId, 'completed');

      if (res && res.success) {
        this.showResult(res, multi, taskId);
        wx.hideLoading();
        this.loadHistory();
      } else {
        wx.hideLoading();
        wx.showToast({ title: res?.message || '分析失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      // 超时 vs 其他错误
      if (err.errCode === -1 || (err.message && err.message.indexOf('timeout') >= 0)) {
        this.setData({ timedOut: true, progress: '分析超时，部分结果已保存' });
        wx.showModal({
          title: '分析超时',
          content: '由于大模型响应较慢，分析未在 60 秒内完成。已保存部分结果，可点击「继续分析」续传。',
          confirmText: '继续分析',
          success: (r) => { if (r.confirm) this.onContinueAnalysis(); },
        });
      } else {
        wx.showToast({ title: '网络错误或 API Key 无效', icon: 'none' });
        console.error('[AI] analysis error:', err);
      }
    }

    this.setData({ analyzing: false });
  },

  /** 续传超时的分析任务 */
  async onContinueAnalysis() {
    const taskId = this.data.taskId;
    if (!taskId) {
      wx.showToast({ title: '无续传任务', icon: 'none' });
      return;
    }
    this.setData({ analyzing: true, timedOut: false, progress: '续传分析中...' });
    wx.showLoading({ title: '续传中...', mask: true });

    try {
      // 从 DB 读取已保存的部分结果
      const taskRes = await DB.collection('analysis_tasks').doc(taskId).get();
      const task = taskRes.data;
      if (!task || task.status === 'completed') {
        wx.hideLoading();
        wx.showToast({ title: '该任务已完成', icon: 'success' });
        this.setData({ analyzing: false });
        return;
      }

      // 重新发起分析（云函数会检测 taskId 并续传）
      const analysts = this.data.analysts;
      const multi = analysts.length > 1;
      const synthKey = multi ? (this.data.analysts[this.data.synthIndex] || analysts[0]) : undefined;

      const res = multi
        ? await api.analyzePortfolioMulti(this.data.selectedType, analysts, synthKey)
        : await api.analyzePortfolio(this.data.selectedType, analysts[0]);

      this.finishTask(taskId, 'completed');

      if (res && res.success) {
        this.showResult(res, multi, taskId);
        wx.hideLoading();
        this.loadHistory();
      } else {
        wx.hideLoading();
        wx.showToast({ title: res?.message || '分析失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '续传失败，请重试', icon: 'none' });
      this.setData({ analyzing: false, timedOut: true });
    }
    this.setData({ analyzing: false });
  },

  /** 展示分析结果（含 Markdown 转 HTML） */
  showResult(res, multi, taskId) {
    const report = res.report || {};
    const summaryHtml = mdToHtml(report.summary || '');
    const contentHtml = mdToHtml(report.report_content || '');
    const subReports = (res.subReports || []).map(sr => ({
      ...sr,
      contentHtml: mdToHtml(sr.content || ''),
    }));

    this.setData({
      taskId: taskId || '',
      'result.show': true,
      'result.summary': report.summary || '',
      'result.summaryHtml': summaryHtml,
      'result.keyFindings': report.key_findings || [],
      'result.riskLevel': report.risk_level || '',
      'result.content': report.report_content || '',
      'result.contentHtml': contentHtml,
      'result.date': formatDate(new Date()),
      'result.multiMode': !!res.multiMode,
      'result.subReports': subReports,
    });
  },

  /** 更新任务状态 */
  async finishTask(taskId, status) {
    if (!taskId) return;
    try {
      await DB.collection('analysis_tasks').doc(taskId).update({
        data: { status, updated_at: DB.serverDate() },
      });
    } catch (e) { /* ignore */ }
  },

  /** 可定制的 loading 更新 */
  showProgress(title) {
    wx.showLoading({ title, mask: true });
  },

  // ==============================
  //  导出功能
  // ==============================
  onCopyReport() {
    const { content, summary, keyFindings, riskLevel } = this.data.result;
    if (!content && !summary) {
      wx.showToast({ title: '无报告可导出', icon: 'none' });
      return;
    }
    const text = [
      `# AI 持仓分析报告\n`,
      `**生成时间**: ${this.data.result.date}\n`,
      riskLevel ? `**风险等级**: ${riskLevel}\n` : '',
      `## 摘要\n${summary}\n`,
      keyFindings.length > 0 ? `## 关键发现\n${keyFindings.map(k => `- ${k}`).join('\n')}\n` : '',
      content ? `## 详细报告\n${content}\n` : '',
    ].filter(Boolean).join('\n');

    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制到剪贴板（Markdown 格式）', icon: 'success' }),
    });
  },

  onDownloadReport() {
    const { content, summary, keyFindings, riskLevel, date } = this.data.result;
    if (!content && !summary) {
      wx.showToast({ title: '无报告可导出', icon: 'none' });
      return;
    }
    const text = [
      `# AI 持仓分析报告\n`,
      `生成时间: ${date}\n`,
      riskLevel ? `风险等级: ${riskLevel}\n` : '',
      `---\n`,
      `## 摘要\n${summary}\n`,
      keyFindings.length > 0 ? `\n## 关键发现\n${keyFindings.map(k => `- ${k}`).join('\n')}\n` : '',
      content ? `\n## 详细报告\n${content}\n` : '',
    ].filter(Boolean).join('\n');

    // 保存为 .md 文件到用户缓存目录
    const fs = wx.getFileSystemManager();
    const fileName = `分析报告_${date || new Date().toISOString().slice(0, 10)}.md`;
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
    try {
      fs.writeFileSync(filePath, text, 'utf8');
      wx.openDocument({
        filePath,
        showMenu: true,
        success: () => wx.showToast({ title: '已生成报告文件', icon: 'success' }),
        fail: () => {
          // openDocument 失败 → 走分享方式
          wx.shareFileMessage({ filePath });
        },
      });
    } catch (err) {
      // 写文件失败 → 降级到剪贴板
      wx.setClipboardData({
        data: text,
        success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'success' }),
      });
    }
  },

  onCopySubReport(e) {
    const idx = e.currentTarget.dataset.index;
    const sub = this.data.result.subReports[idx];
    if (!sub || !sub.content) {
      wx.showToast({ title: '无内容可导出', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: `## ${sub.provider} 分析报告\n\n${sub.content}`,
      success: () => wx.showToast({ title: '已复制', icon: 'success' }),
    });
  },

  onToggleSubReports() {
    this.setData({ showSubReports: !this.data.showSubReports });
  },

  onViewHistory(e) {
    const report = e.currentTarget.dataset.report;
    wx.navigateTo({ url: `/pages/ai/report-detail?id=${report._id}` });
  },

  async onAskQuestion() {
    const question = this.data.qaQuestion.trim();
    if (!question) return;
    const provider = this.data.analysts[0] || 'deepseek';

    this.setData({ qaAnswer: '' });
    wx.showLoading({ title: '思考中...', mask: true });

    try {
      const res = await api.askAI(question, provider);
      wx.hideLoading();
      if (res && res.success) {
        this.setData({
          qaAnswer: res.answer || '暂无回答',
          qaAnswerHtml: mdToHtml(res.answer || ''),
        });
      } else {
        wx.showToast({ title: res?.message || '回答失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  onQaInputChange(e) {
    this.setData({ canAsk: (e.detail.value || '').trim().length > 0 });
  },

  onQuickQuestion(e) {
    const q = e.currentTarget.dataset.q;
    this.setData({ qaQuestion: q, canAsk: true }, () => this.onAskQuestion());
  },

  analysisTypeName(typeKey) {
    const found = ANALYSIS_TYPES.find(t => t.key === typeKey);
    return found ? found.name : typeKey;
  },

  formatMoney,
  formatDate,
});
