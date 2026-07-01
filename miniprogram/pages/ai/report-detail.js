/**
 * AI 分析报告详情页面
 * - Markdown 渲染 / 导出
 */
const { formatDate } = require('../../utils/format');
const { ANALYSIS_TYPES } = require('../../utils/constants');
const { mdToHtml } = require('../../utils/markdown');

Page({
  data: {
    report: {},
    summaryHtml: '',
    contentHtml: '',
  },

  onLoad(options) {
    if (options.id) this.loadReport(options.id);
  },

  async loadReport(id) {
    try {
      const db = wx.cloud.database();
      const res = await db.collection('analysis_reports').doc(id).get();
      const report = res.data || {};

      const riskMap = {
        '保守': 'conservative', '稳健': 'steady', '进取': 'aggressive', '激进': 'radical',
        '低': 'low', '中低': 'low', '中等': 'medium', '中高': 'high', '高': 'high',
        'A': 'conservative', 'B': 'steady', 'C': 'aggressive', 'D': 'radical',
      };
      report.riskClass = riskMap[report.risk_level] || 'steady';

      this.setData({
        report,
        summaryHtml: mdToHtml(report.summary || ''),
        contentHtml: mdToHtml(report.report_content || ''),
      });
    } catch (err) {
      console.error('[Report Detail] error:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  /** 导出报告（复制到剪贴板） */
  onCopy() {
    const { report } = this.data;
    if (!report.report_content && !report.summary) {
      wx.showToast({ title: '无内容可导出', icon: 'none' });
      return;
    }
    const text = [
      `# AI 持仓分析报告\n`,
      `**生成时间**: ${formatDate(report.created_at)}\n`,
      report.risk_level ? `**风险等级**: ${report.risk_level}\n` : '',
      `---\n`,
      report.summary ? `## 摘要\n${report.summary}\n` : '',
      report.key_findings && report.key_findings.length > 0
        ? `\n## 关键发现\n${report.key_findings.map(k => `- ${k}`).join('\n')}\n` : '',
      report.report_content ? `\n## 详细报告\n${report.report_content}\n` : '',
    ].filter(Boolean).join('\n');

    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制（Markdown 格式）', icon: 'success' }),
    });
  },

  analysisTypeName(typeKey) {
    const found = ANALYSIS_TYPES.find(t => t.key === typeKey);
    return found ? found.name : typeKey || '未知';
  },

  formatDate,
});
