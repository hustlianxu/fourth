// utils/watermark.js
// 将模板渲染为 Canvas 上的水印：生成最终图像（原图 + 水印）
// 兼容新版 Canvas 2D 接口

function hexToRgba(hex, alpha) {
  // 支持 #rgb / #rrggbb
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('');
  }
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

/**
 * 解析颜色：支持 #rrggbb、rgb(...)、rgba(...)
 */
function parseColor(color, defaultAlpha) {
  if (!color) return 'rgba(0,0,0,0.6)';
  if (color.indexOf('rgba') === 0 || color.indexOf('rgb') === 0) return color;
  if (color.indexOf('#') === 0) {
    return hexToRgba(color, defaultAlpha != null ? defaultAlpha : 1);
  }
  return color;
}

/**
 * 在图片上绘制水印，返回图片临时文件路径
 * @param {Object} params
 * @param {CanvasRenderingContext2D} params.ctx - Canvas 2D 上下文
 * @param {Object} params.canvas - 对应 canvas 元素（用于 toTempFilePath）
 * @param {string} params.imagePath - 原图路径
 * @param {Object} params.template - 模板对象（来自 templates.js）
 * @param {Object} params.values - 填写后的值 { key: value }
 * @param {number} params.imgW - 图片宽
 * @param {number} params.imgH - 图片高
 */
function drawWatermark(params) {
  const { ctx, canvas, imagePath, template, values, imgW, imgH } = params;
  // 根据图片大小按比例缩放 canvas
  const maxSize = 1280;
  let targetW = imgW;
  let targetH = imgH;
  const scale = Math.min(1, maxSize / Math.max(imgW, imgH));
  targetW = Math.round(imgW * scale);
  targetH = Math.round(imgH * scale);

  canvas.width = targetW;
  canvas.height = targetH;

  ctx.clearRect(0, 0, targetW, targetH);

  // 绘制原图
  return new Promise((resolve, reject) => {
    const img = canvas.createImage ? canvas.createImage() : new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, targetW, targetH);
      renderTemplate(ctx, canvas, template, values, targetW, targetH);
      resolve();
    };
    img.onerror = (err) => reject(err);
    img.src = imagePath;
  });
}

/**
 * 在 canvas 上绘制模板水印
 */
function renderTemplate(ctx, canvas, template, values, cw, ch) {
  const style = template.style || {};
  const position = template.position || 'bottom-left';
  // 基础字号根据图片宽度自适应
  const baseFontSize = Math.max(20, Math.round(cw * 0.03));
  const fontSize = Math.round((style.fontSize || 22) / 750 * cw) || baseFontSize;
  const lineHeight = fontSize * (style.lineHeight || 1.6);
  const padding = Math.round((style.padding || 16) / 750 * cw);
  const borderRadius = Math.round((style.borderRadius || 8) / 750 * cw);

  const lines = buildLines(template, values);
  // 估算文本宽度：取最长一行
  const longLine = lines.map((l) => l.label + '：' + (l.value || '')).reduce(
    (a, b) => (a.length > b.length ? a : b),
    ''
  );
  ctx.font = fontSize + 'px -apple-system, "PingFang SC", sans-serif';
  const textMetrics = ctx.measureText(longLine);
  const textWidth = textMetrics.width;
  const blockWidth = Math.min(cw * 0.72, textWidth + padding * 2 + 40);
  const blockHeight = padding * 2 + Math.ceil(lines.length) * lineHeight;

  // 实际最大行宽
  let maxLineWidth = 0;
  lines.forEach((l) => {
    const m = ctx.measureText(l.label + '：' + (l.value || ''));
    if (m.width > maxLineWidth) maxLineWidth = m.width;
  });
  const finalBlockWidth = Math.min(cw * 0.72, maxLineWidth + padding * 2 + 20);

  // 计算坐标
  const margin = Math.round(cw * 0.03);
  let x = margin;
  let y = margin;
  if (position === 'top-left') {
    x = margin;
    y = margin;
  } else if (position === 'top-right') {
    x = cw - finalBlockWidth - margin;
    y = margin;
  } else if (position === 'top-center') {
    x = (cw - finalBlockWidth) / 2;
    y = margin;
  } else if (position === 'bottom-left') {
    x = margin;
    y = ch - blockHeight - margin;
  } else if (position === 'bottom-right') {
    x = cw - finalBlockWidth - margin;
    y = ch - blockHeight - margin;
  } else if (position === 'bottom-center') {
    x = (cw - finalBlockWidth) / 2;
    y = ch - blockHeight - margin;
  }

  // 绘制圆角背景
  const bgColor = parseColor(style.background, 0.6);
  roundRect(ctx, x, y, finalBlockWidth, blockHeight, borderRadius, bgColor);

  // 绘制每行文字（加描边保证可读性）
  ctx.textBaseline = 'top';
  const textColor = parseColor(style.color || '#ffffff', 1);
  lines.forEach((line, i) => {
    const tx = x + padding;
    const ty = y + padding + i * lineHeight;
    const labelText = line.label + '：';
    const valueText = line.value || '—';
    ctx.font = fontSize + 'px -apple-system, "PingFang SC", sans-serif';
    // 描边提升可读性
    ctx.lineWidth = Math.max(2, Math.round(fontSize / 10));
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.strokeText(labelText + valueText, tx, ty);
    // 标签
    ctx.fillStyle = textColor;
    ctx.fillText(labelText, tx, ty);
    const labelWidth = ctx.measureText(labelText).width;
    // 数值：高亮一些关键字段
    if (line.type === 'datetime' || line.type === 'date' || line.type === 'time') {
      ctx.fillStyle = '#ffe58f';
    } else if (line.type === 'location') {
      ctx.fillStyle = '#bae7ff';
    } else {
      ctx.fillStyle = textColor;
    }
    ctx.fillText(valueText, tx + labelWidth, ty);
  });
}

function buildLines(template, values) {
  const lines = [];
  (template.fields || []).forEach((f) => {
    lines.push({
      key: f.key,
      label: f.label,
      type: f.type,
      value: (values && values[f.key] != null && values[f.key] !== '') ? String(values[f.key]) : ''
    });
  });
  return lines;
}

function roundRect(ctx, x, y, w, h, r, fill) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * 将 Canvas 导出为临时文件
 */
function canvasToTempFilePath(canvas) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas: canvas,
      fileType: 'jpg',
      quality: 0.92,
      success: (res) => resolve(res.tempFilePath),
      fail: reject
    });
  });
}

module.exports = {
  drawWatermark,
  renderTemplate,
  canvasToTempFilePath
};
