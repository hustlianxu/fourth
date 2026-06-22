// utils/templates.js
// 外贸手写水印模板（双语 ES / 中文）
// 风格：每一项独立成行，可留空；西语描述 / 中文描述会给更大空间并自动换行
// 参考用户图片里的手写格式：modelo / descripción español / 中文描述 / precio / pzs/caja / cajas / volumen ...

const TEMPLATES = [
  {
    id: 'handwrite',
    name: '手写·双语',
    description: 'Formato anotación · 货号 + 西语描述 + 中文描述 + 单价 + 装箱数 + 件数 + 体积 + 日期',
    position: 'bottom-right',
    style: {
      fontSize: 22,
      color: '#ffffff',
      background: 'rgba(0,0,0,0.70)',
      padding: 14,
      borderRadius: 10,
      lineHeight: 1.7
    },
    fields: [
      { key: 'modelo', label: '货号 · Modelo / Código', type: 'text', placeholder: '如：RL-034 · HB098', required: false },
      { key: 'desEs', label: 'Descripción ES · 西语描述', type: 'textarea',
        placeholder: '如：6 estrellas grande + 6 estrellas chicas · 8 secuencias · sin música', required: false, multiline: true },
      { key: 'desZh', label: 'Descripción ZH · 中文描述', type: 'textarea',
        placeholder: '如：6 大星星 + 6 小星星挂灯 · 8 种闪烁模式 · 不带音乐', required: false, multiline: true },
      { key: 'precio', label: '单价 · Precio unitario', type: 'text', placeholder: '如：¥11 · $0.65', required: false },
      { key: 'pzs', label: '每箱件数 · Pzs / caja', type: 'text', placeholder: '如：48 pzs / caja', required: false },
      { key: 'cajas', label: '件数 · Total cajas / pzs', type: 'text', placeholder: '如：50 cajas · 1200 pzs', required: false },
      { key: 'volumen', label: '体积 · Volumen', type: 'text', placeholder: '如：0.125 m³ / 2 cajas', required: false },
      { key: 'nota', label: '备注 · Nota', type: 'textarea', placeholder: '如：con luz y música · movimiento · poner más opp en la caja', required: false, multiline: true },
      { key: 'fecha', label: '日期 · Fecha', type: 'datetime', required: false }
    ]
  },

  {
    id: 'handwriteSimple',
    name: '手写·精简',
    description: 'Formato corto · 货号 + 西语描述 + 单价 + 装箱数 + 日期',
    position: 'bottom-right',
    style: {
      fontSize: 24,
      color: '#ffffff',
      background: 'rgba(0,0,0,0.70)',
      padding: 14,
      borderRadius: 10,
      lineHeight: 1.7
    },
    fields: [
      { key: 'modelo', label: '货号 · Modelo', type: 'text', placeholder: '如：RL-034', required: true },
      { key: 'desEs', label: 'Descripción ES', type: 'textarea',
        placeholder: '如：3ctn × 48 pcs × 29 rmb · con luz y música', required: false, multiline: true },
      { key: 'precio', label: '单价 · Precio', type: 'text', placeholder: '如：¥11', required: false },
      { key: 'pzs', label: '每箱 · Pzs / caja', type: 'text', placeholder: '如：48 pzs / caja', required: false },
      { key: 'cajas', label: '件数 · Total', type: 'text', placeholder: '如：10 cajas', required: false },
      { key: 'fecha', label: '日期 · Fecha', type: 'datetime', required: false }
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
