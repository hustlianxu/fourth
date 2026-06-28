/**
 * AI 分析报告详情页面
 */
const { formatDate } = require('../../utils/format');
const { ANALYSIS_TYPES } = require('../../utils/constants');

Page({
  data: {
    report: {},
    reportContent: '',
  },

  onLoad(options) {
    if (options.id) {
      this.loadReport(options.id);
    }
  },

  async loadReport(id) {
    try {
      const db = wx.cloud.database();
      const res = await db.collection('analysis_reports').doc(id).get();
      const report = res.data || {};

      // 中文风险等级 → 英文 CSS 类名映射
      const riskMap = {
        '保守': 'conservative', '稳健': 'steady', '进取': 'aggressive', '激进': 'radical',
        '低': 'low', '中低': 'low', '中等': 'medium', '中高': 'high', '高': 'high',
        'A': 'conservative', 'B': 'steady', 'C': 'aggressive', 'D': 'radical',
      };
      report.riskClass = riskMap[report.risk_level] || 'steady';

      // 将 report_content 转义为 rich-text 可用格式
      const content = (report.report_content || '')
        .replace(/\n/g, '<br/>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/【(.*?)】/g, '<strong style="color:#6c63ff">[$1]</strong>');

      this.setData({
        report,
        reportContent: content,
      });
    } catch (err) {
      console.error('[Report Detail] error:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  analysisTypeName(typeKey) {
    const found = ANALYSIS_TYPES.find(t => t.key === typeKey);
    return found ? found.name : typeKey || '未知';
  },

  formatDate,
});
