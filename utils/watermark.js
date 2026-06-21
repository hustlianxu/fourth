// utils/watermark.js
// 将模板渲染为 Canvas 上的水印：生成最终图像（原图 + 水印）
// 兼容新版 Canvas 2D 接口（外贸场景默认输出 1920 长边高清图，便于印刷与机读）

function hexToRgba(hex, alpha) {
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function parseColor(color, defaultAlpha) {
  if (!color) return 'rgba(0,0,0,0.6)';
  if (color.indexOf('rgba') === 0 || color.indexOf('rgb') === 0) return color;
  if (color.indexOf('#') === 0) return hexToRgba(color, defaultAlpha != null ? defaultAlpha : 1);
  return color;
}

/**
 * 在图片上绘制水印（输出高清尺寸 1920 长边，方便印刷/机读）
 */
function drawWatermark(params) {
  const { ctx, canvas, imagePath, template, values, imgW, imgH } = params;
  // 目标长边：1920（跨境电商产品图常用长边尺寸）
  const MAX_EDGE = 1920;
  let targetW = imgW;
  let targetH = imgH;
  const maxEdge = Math.max(imgW, imgH);
  if (maxEdge > MAX_EDGE || maxEdge < 800) {
    const s = MAX_EDGE / maxEdge;
    targetW = Math.round(imgW * s);
    targetH = Math.round(imgH * s);
  }

  canvas.width = targetW;
  canvas.height = targetH;
  ctx.clearRect(0, 0, targetW, targetH);

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
  // 以图片宽为 750 为基准做字号/间距自适应，保证不同图片尺寸下字号稳定可读
  const ratio = cw / 750;
  const fontSize = Math.max(18, Math.round((style.fontSize || 24) * ratio));
  const lineHeight = Math.round(fontSize * (style.lineHeight || 1.65));
  const padding = Math.round((style.padding || 18) * ratio);
  const borderRadius = Math.round((style.borderRadius || 10) * ratio);

  const lines = buildLines(template, values);

  // 用英文排版：标签用 "Label : "
  ctx.font = fontSize + 'px -apple-system, "PingFang SC", sans-serif';
  let maxLineWidth = 0;
  const computed = lines.map((line) => {
    const labelText = line.label + ' : ';
    const valueText = line.value || '—';
    const full = labelText + valueText;
    const m = ctx.measureText(full);
    if (m.width > maxLineWidth) maxLineWidth = m.width;
    return { labelText, valueText, type: line.type };
  });

  const finalBlockWidth = Math.min(cw * 0.78, maxLineWidth + padding * 2 + 20);
  const blockHeight = padding * 2 + computed.length * lineHeight;

  const margin = Math.round(cw * 0.035);
  let x = margin;
  let y = margin;
  if (position === 'top-left') {
    x = margin; y = margin;
  } else if (position === 'top-right') {
    x = cw - finalBlockWidth - margin; y = margin;
  } else if (position === 'top-center') {
    x = (cw - finalBlockWidth) / 2; y = margin;
  } else if (position === 'bottom-left') {
    x = margin; y = ch - blockHeight - margin;
  } else if (position === 'bottom-right') {
    x = cw - finalBlockWidth - margin; y = ch - blockHeight - margin;
  } else if (position === 'bottom-center') {
    x = (cw - finalBlockWidth) / 2; y = ch - blockHeight - margin;
  }

  // 先绘制深色背景（印刷级高对比）
  const bgColor = parseColor(style.background, 0.7);
  roundRect(ctx, x, y, finalBlockWidth, blockHeight, borderRadius, bgColor);

  // 文字部分（加描边以保障机读性）
  ctx.textBaseline = 'top';
  const textColor = parseColor(style.color || '#ffffff', 1);
  const strokeWidth = Math.max(2, Math.round(fontSize / 8));
  computed.forEach((line, i) => {
    const tx = x + padding;
    const ty = y + padding + i * lineHeight;
    ctx.font = fontSize + 'px -apple-system, "PingFang SC", sans-serif';
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.strokeText(line.labelText + line.valueText, tx, ty);

    // 标签
    ctx.fillStyle = textColor;
    ctx.fillText(line.labelText, tx, ty);
    const labelWidth = ctx.measureText(line.labelText).width;
    // 关键字段（日期/SKU/定位用金色/蓝色，保证一眼抓到重点
    if (line.type === 'datetime' || line.type === 'date' || line.type === 'time') {
      ctx.fillStyle = '#ffe58f';
    } else if (line.type === 'location') {
      ctx.fillStyle = '#91d5ff';
    } else {
      ctx.fillStyle = textColor;
    }
    ctx.fillText(line.valueText, tx + labelWidth, ty);
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
