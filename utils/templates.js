// utils/templates.js
// 外贸场景通用水印模板
// 字段类型：text / number / select / date / time / datetime / location
// 支持的 position：top-left / top-right / bottom-left / bottom-right / top-center / bottom-center
// 每条字段 label 采用 "中文名 · English"，便于工厂/外商同时识别

const TEMPLATES = [
  {
    id: 'product',
    name: '产品展示',
    description: 'Product Showcase · SKU/规格/材质/产地，适合商品详情图',
    position: 'bottom-right',
    style: {
      fontSize: 26,
      color: '#ffffff',
      background: 'rgba(0,0,0,0.70)',
      padding: 20,
      borderRadius: 10,
      lineHeight: 1.7
    },
    fields: [
      { key: 'productName', label: '产品名称 · Product', type: 'text', placeholder: '如：Stainless Steel Mug 500ml', required: true },
      { key: 'sku', label: 'SKU', type: 'text', placeholder: '如：SKU-SSM-001', required: true },
      { key: 'material', label: '材质 · Material', type: 'text', placeholder: '如：18/8 Stainless Steel', required: false },
      { key: 'spec', label: '规格 · Spec', type: 'text', placeholder: '如：500ml / 500pcs/ctn', required: false },
      { key: 'origin', label: '产地 · Origin', type: 'text', placeholder: 'Made in China', required: false,
        default: 'Made in China' },
      { key: 'datetime', label: '拍摄日期 · Date', type: 'datetime', required: true },
      { key: 'location', label: '地点 · Location', type: 'location', required: false }
    ]
  },

  {
    id: 'packaging',
    name: '包装质检',
    description: 'Packaging QC · PO/箱号/数量/检验结果，外箱拍照留档',
    position: 'bottom-left',
    style: {
      fontSize: 26,
      color: '#ffffff',
      background: 'rgba(7,193,96,0.82)',
      padding: 20,
      borderRadius: 10,
      lineHeight: 1.7
    },
    fields: [
      { key: 'po', label: '订单号 · PO#', type: 'text', placeholder: '如：PO-20260621', required: true },
      { key: 'cartonNo', label: '箱号 · Carton#', type: 'text', placeholder: '如：1/50', required: true },
      { key: 'qty', label: '数量 · QTY', type: 'number', placeholder: '如：500', required: true },
      { key: 'productName', label: '品名 · Product', type: 'text', placeholder: '如：LED Bulb E27 9W', required: true },
      { key: 'inspector', label: '检验员 · Inspector', type: 'text', placeholder: '如：QC-Li', required: true },
      { key: 'result', label: '检验结果 · Result', type: 'select',
        options: ['PASS / 合格', 'REJECT / 不合格', 'PENDING / 待定', 'NEED REWORK / 需返工'],
        required: true },
      { key: 'datetime', label: '日期时间 · Date', type: 'datetime', required: true },
      { key: 'location', label: '地点 · Location', type: 'location', required: false }
    ]
  },

  {
    id: 'loading',
    name: '装柜出货',
    description: 'Container Loading · 柜号/封条号/起运港/目的港，装柜照片留档',
    position: 'top-left',
    style: {
      fontSize: 26,
      color: '#ffffff',
      background: 'rgba(24,144,255,0.82)',
      padding: 20,
      borderRadius: 10,
      lineHeight: 1.7
    },
    fields: [
      { key: 'containerNo', label: '柜号 · Container#', type: 'text', placeholder: '如：MSKU1234567', required: true },
      { key: 'sealNo', label: '封条号 · Seal#', type: 'text', placeholder: '如：SL-8812345', required: true },
      { key: 'po', label: '订单号 · PO#', type: 'text', placeholder: '如：PO-20260621', required: false },
      { key: 'pol', label: '起运港 · POL', type: 'text', placeholder: '如：Shanghai', required: true },
      { key: 'pod', label: '目的港 · POD', type: 'text', placeholder: '如：Los Angeles', required: true },
      { key: 'qty', label: '装柜数量 · QTY', type: 'number', placeholder: '如：12000', required: true },
      { key: 'datetime', label: '装柜日期 · Date', type: 'datetime', required: true },
      { key: 'location', label: '地点 · Location', type: 'location', required: false }
    ]
  },

  {
    id: 'factory',
    name: '验厂/跟单',
    description: 'Factory Audit · 工厂名/访客/陪同/车间，验厂与拜访记录',
    position: 'bottom-right',
    style: {
      fontSize: 24,
      color: '#ffffff',
      background: 'rgba(250,140,22,0.82)',
      padding: 20,
      borderRadius: 10,
      lineHeight: 1.7
    },
    fields: [
      { key: 'factoryName', label: '工厂名 · Factory', type: 'text', placeholder: '如：XX Electric Factory', required: true },
      { key: 'visitor', label: '访客 · Visitor / Buyer', type: 'text', placeholder: '如：Mike (ABC Trading)', required: true },
      { key: 'accompany', label: '陪同 · Escorted by', type: 'text', placeholder: '如：Lily / Sales', required: false },
      { key: 'workshop', label: '车间 · Workshop / Line', type: 'text', placeholder: '如：Workshop A / Line 3', required: false },
      { key: 'datetime', label: '日期 · Date', type: 'datetime', required: true },
      { key: 'location', label: '地点 · Location', type: 'location', required: false }
    ]
  },

  {
    id: 'label',
    name: '标签/唛头',
    description: 'Shipping Mark · 唛头信息/收货方/Made in，拍外箱/挂牌标签',
    position: 'bottom-center',
    style: {
      fontSize: 26,
      color: '#111111',
      background: 'rgba(255,255,255,0.92)',
      padding: 20,
      borderRadius: 10,
      lineHeight: 1.7
    },
    fields: [
      { key: 'consignee', label: '收货方 · Consignee', type: 'text', placeholder: '如：ABC Co., Ltd', required: true },
      { key: 'markNo', label: '唛头号 · Mark#', type: 'text', placeholder: '如：MARK-001', required: false },
      { key: 'sku', label: 'SKU', type: 'text', placeholder: '如：SKU-SSM-001', required: true },
      { key: 'ctnNo', label: '箱号 · Carton#', type: 'text', placeholder: '如：1/200', required: true },
      { key: 'origin', label: '产地 · Origin', type: 'text', placeholder: 'Made in China', required: true,
        default: 'Made in China' },
      { key: 'datetime', label: '日期 · Date', type: 'datetime', required: true }
    ]
  }
];

function getTemplateById(id) {
  return TEMPLATES.find((t) => t.id === id);
}

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
    } else if (f.default !== undefined) {
      values[f.key] = f.default;
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
