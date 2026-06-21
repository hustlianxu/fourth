// utils/templates.js
// 水印模板定义：每个模板包含 id、名称、样式、字段列表（字段可由用户填写）
// 字段类型：text（文本）、number（数字）、date（自动日期）、time（自动时间）、datetime（自动）、location（位置）
// 支持的 position：top-left、top-right、bottom-left、bottom-right、bottom-center、top-center

const TEMPLATES = [
  {
    id: 'simple',
    name: '简约打卡',
    description: '时间 + 地点 + 备注，适合日常记录',
    position: 'bottom-left',
    style: {
      fontSize: 24,
      color: '#ffffff',
      background: 'rgba(0,0,0,0.55)',
      padding: 16,
      borderRadius: 8,
      lineHeight: 1.6
    },
    fields: [
      { key: 'datetime', label: '时间', type: 'datetime', required: true },
      { key: 'location', label: '地点', type: 'location', required: false },
      { key: 'note', label: '备注', type: 'text', placeholder: '写点什么...', required: false }
    ]
  },
  {
    id: 'engineering',
    name: '工程巡检',
    description: '项目名称 + 位置 + 温度 + 检查人，适合工程巡检',
    position: 'bottom-right',
    style: {
      fontSize: 22,
      color: '#ffffff',
      background: 'rgba(7,193,96,0.80)',
      padding: 18,
      borderRadius: 12,
      lineHeight: 1.7
    },
    fields: [
      { key: 'project', label: '项目名称', type: 'text', placeholder: '如：XX 工地 3 号楼', required: true },
      { key: 'location', label: '具体位置', type: 'location', required: true },
      { key: 'datetime', label: '巡检时间', type: 'datetime', required: true },
      { key: 'temperature', label: '温度(℃)', type: 'number', placeholder: '如：28', required: false },
      { key: 'inspector', label: '检查人', type: 'text', placeholder: '请输入姓名', required: true },
      { key: 'note', label: '现场说明', type: 'text', placeholder: '描述巡检结果', required: false }
    ]
  },
  {
    id: 'attendance',
    name: '考勤打卡',
    description: '姓名 + 工号 + 打卡时间 + 定位',
    position: 'top-left',
    style: {
      fontSize: 22,
      color: '#ffffff',
      background: 'rgba(24,144,255,0.80)',
      padding: 18,
      borderRadius: 12,
      lineHeight: 1.7
    },
    fields: [
      { key: 'name', label: '姓名', type: 'text', placeholder: '请输入姓名', required: true },
      { key: 'staffId', label: '工号', type: 'text', placeholder: '请输入工号', required: true },
      { key: 'datetime', label: '打卡时间', type: 'datetime', required: true },
      { key: 'location', label: '定位', type: 'location', required: true },
      { key: 'type', label: '打卡类型', type: 'select', options: ['上班', '下班', '外勤', '其他'], required: true }
    ]
  },
  {
    id: 'delivery',
    name: '货物签收',
    description: '订单号 + 货物 + 签收人 + 地点',
    position: 'bottom-center',
    style: {
      fontSize: 22,
      color: '#222222',
      background: 'rgba(255,255,255,0.90)',
      padding: 18,
      borderRadius: 12,
      lineHeight: 1.7
    },
    fields: [
      { key: 'orderNo', label: '订单号', type: 'text', placeholder: '请输入订单号', required: true },
      { key: 'goods', label: '货物名称', type: 'text', placeholder: '如：建材 / 设备', required: true },
      { key: 'receiver', label: '签收人', type: 'text', placeholder: '请输入姓名', required: true },
      { key: 'datetime', label: '签收时间', type: 'datetime', required: true },
      { key: 'location', label: '地点', type: 'location', required: false }
    ]
  }
];

/**
 * 根据模板 id 获取模板
 */
function getTemplateById(id) {
  return TEMPLATES.find((t) => t.id === id);
}

/**
 * 获取模板的默认值：对 datetime/date/time 自动填充当前时间；其他为空
 */
function getDefaultValues(template, extras = {}) {
  const values = {};
  const now = new Date();
  template.fields.forEach((f) => {
    if (f.type === 'datetime') {
      values[f.key] = formatDateTime(now);
    } else if (f.type === 'date') {
      values[f.key] = formatDate(now);
    } else if (f.type === 'time') {
      values[f.key] = formatTime(now);
    } else if (f.type === 'location') {
      values[f.key] = extras.location || '';
    } else if (f.type === 'select') {
      values[f.key] = (f.options && f.options[0]) || '';
    } else {
      values[f.key] = '';
    }
  });
  return values;
}

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function formatDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function formatTime(d) {
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function formatDateTime(d) {
  return formatDate(d) + ' ' + formatTime(d);
}

module.exports = {
  TEMPLATES,
  getTemplateById,
  getDefaultValues,
  formatDate,
  formatTime,
  formatDateTime
};
