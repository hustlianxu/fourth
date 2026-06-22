// utils/watermark.js
// 外贸手写水印渲染器
// 渲染规则：
//   - 每一项独立成行；标签一行，内容另起一行并缩进
//   - 西语描述 / 中文描述等长文本字段支持自动换行
//   - 不同项之间留一行空行分隔（或由 lineHeight 的留白）
//   - 水印块默认占图片宽的 85%，位于底部靠左

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
 * 绘制水印（保留原始图片尺寸，不做强制缩放）
 * @param {Object} params
 * @param {CanvasRenderingContext2D} params.ctx
 * @param {HTMLCanvasElement} params.canvas
 * @param {string} params.imagePath
 * @param {Object} params.template
 * @param {Object} params.values
 * @param {number} params.imgW
 * @param {number} params.imgH
 * @param {number} [params.customX] - 自定义X位置（相对于原图）
 * @param {number} [params.customY] - 自定义Y位置（相对于原图）
 * @param {number} [params.customScale] - 自定义缩放比例
 * @param {number} [params.opacity] - 透明度
 */
function drawWatermark(params) {
  const { ctx, canvas, imagePath, template, values, imgW, imgH, customX, customY, customScale, opacity } = params;
  
  // 保留原始图片尺寸，不做强制缩放以保证画质
  let targetW = imgW;
  let targetH = imgH;
  
  // 仅在图片过大时进行适度缩小（长边最大 4096，避免内存问题）
  const MAX_EDGE = 4096;
  const maxEdge = Math.max(imgW, imgH);
  if (maxEdge > MAX_EDGE) {
    const s = MAX_EDGE / maxEdge;
    targetW = Math.round(imgW * s);
    targetH = Math.round(imgH * s);
  }
  
  canvas.width = targetW;
  canvas.height = targetH;
  ctx.clearRect(0, 0, targetW, targetH);

  // 计算相对坐标（如果提供了自定义位置）
  let relX = customX != null ? (customX / imgW) * targetW : null;
  let relY = customY != null ? (customY / imgH) * targetH : null;

  return new Promise((resolve, reject) => {
    const img = canvas.createImage ? canvas.createImage() : new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, targetW, targetH);
      renderTemplate(ctx, canvas, template, values, targetW, targetH, relX, relY, customScale, opacity);
      resolve();
    };
    img.onerror = (err) => reject(err);
    img.src = imagePath;
  });
}

/**
 * 逐字段渲染水印
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {Object} template
 * @param {Object} values
 * @param {number} cw
 * @param {number} ch
 * @param {number} [customX] - 自定义X位置
 * @param {number} [customY] - 自定义Y位置
 * @param {number} [customScale] - 自定义缩放比例
 * @param {number} [customOpacity] - 自定义透明度
 */
function renderTemplate(ctx, canvas, template, values, cw, ch, customX, customY, customScale, customOpacity) {
  const style = template.style || {};
  const position = template.position || 'bottom-left';

  const ratio = cw / 750;
  const scale = customScale || 1;
  const fontSize = Math.max(14, Math.round((style.fontSize || 22) * ratio * scale));
  const lineHeight = Math.round(fontSize * (style.lineHeight || 1.7));
  const padding = Math.round((style.padding || 14) * ratio * scale);
  const borderRadius = Math.round((style.borderRadius || 10) * ratio);

  // 水印块宽度：图片宽度的 42%（紧凑，不遮挡主体画面）
  const blockW = Math.round(cw * 0.42 * scale);
  const indent = Math.round(fontSize * 1.4);

  // 文本可写宽度
  const textInnerW = blockW - padding * 2;

  // 先计算每个字段要渲染的物理行（含标签单独一行，内容自动换行）
  const fieldLineGroups = [];
  (template.fields || []).forEach((f) => {
    const raw = (values && values[f.key]);
    if (raw == null) return;
    let v = String(raw).trim();
    if (!v) return; // 可留空

    const lines = [];
    // 标签单独一行（如 "Modelo:"）
    lines.push({
      text: f.label + ':',
      isLabel: true,
      type: f.type,
      color: '#ffe58f'
    });

    // 内容按 \n 分段，每段再按单词/字符自动换行
    const paragraphs = v.split(/\r?\n/);
    paragraphs.forEach((p) => {
      if (!p.trim() && paragraphs.length > 1) {
        // 用户自己输入的空行保留
        lines.push({ text: '', isLabel: false, type: f.type, color: style.color });
        return;
      }
      wrapText(ctx, p, textInnerW - indent, fontSize).forEach((sub) => {
        lines.push({ text: sub, isLabel: false, type: f.type, color: style.color });
      });
    });

    fieldLineGroups.push({ lines });
  });

  if (fieldLineGroups.length === 0) return;

  // 总文本行
  const allLines = [];
  fieldLineGroups.forEach((g, idx) => {
    g.lines.forEach((ln) => allLines.push(ln));
    // 字段间插一行空白（最后不加）
    if (idx < fieldLineGroups.length - 1) {
      allLines.push({ text: '', isLabel: false, type: 'spacer', color: style.color, spacer: true });
    }
  });

  const blockH = padding * 2 + allLines.length * lineHeight;

  // 计算坐标（水印块定位，支持9个位置 + 自定义位置）
  const margin = Math.round(cw * 0.04);
  const cx = (cw - blockW) / 2;
  let x = margin;
  let y = margin;

  // 如果提供了自定义位置，优先使用
  if (customX != null) {
    x = customX;
  } else if (position === 'top-left') {
    x = margin;
  } else if (position === 'top-center') {
    x = cx;
  } else if (position === 'top-right') {
    x = cw - blockW - margin;
  } else if (position === 'center-left') {
    x = margin;
  } else if (position === 'center') {
    x = cx;
  } else if (position === 'center-right') {
    x = cw - blockW - margin;
  } else if (position === 'bottom-left') {
    x = margin;
  } else if (position === 'bottom-center') {
    x = cx;
  } else if (position === 'bottom-right') {
    x = cw - blockW - margin;
  }

  if (customY != null) {
    y = customY;
  } else if (position === 'top-left' || position === 'top-center' || position === 'top-right') {
    y = margin;
  } else if (position === 'center-left' || position === 'center' || position === 'center-right') {
    y = (ch - blockH) / 2;
  } else {
    y = ch - blockH - margin;
  }

  // 保证水印不会超出边界
  x = Math.max(margin, Math.min(x, cw - blockW - margin));
  y = Math.max(margin, Math.min(y, ch - blockH - margin));

  // 绘制深色背景（支持自定义透明度）
  const bgColor = parseColor(style.background, customOpacity != null ? customOpacity : 0.72);
  roundRect(ctx, x, y, blockW, blockH, borderRadius, bgColor);

  // 绘制文字
  ctx.textBaseline = 'top';
  const textColor = parseColor(style.color || '#ffffff', 1);
  ctx.font = fontSize + 'px -apple-system, "PingFang SC", sans-serif';
  ctx.lineWidth = Math.max(2, Math.round(fontSize / 8));

  allLines.forEach((ln, i) => {
    if (ln.spacer) return; // 空行
    const tx = x + padding + (ln.isLabel ? 0 : indent);
    const ty = y + padding + i * lineHeight;

    if (ln.text) {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.strokeText(ln.text, tx, ty);
      ctx.fillStyle = ln.isLabel ? '#ffe58f' : textColor;
      ctx.fillText(ln.text, tx, ty);
    }
  });
}

/**
 * 按宽度把一段文字自动换行
 * 英文按单词换行，中文/长英文按字符换行
 */
function wrapText(ctx, text, maxWidth, fontSize) {
  if (!text) return [];
  // 按空白符拆分（西语主要使用西语主要西语使用英文空格分词
  // 简化处理：先按空格拆成 word token，然后逐个累加，超过宽度就换行
  // 同时对超长的单个西语单词按字符继续折行
  const tokens = text.split(/(\s+)/).filter((t) => t.length > 0);
  const lines = [];
  let current = '';
  tokens.forEach((tk) => {
    const candidate = current ? current + (current.endsWith(' ') ? '' : ' ') + tk : tk;
    const w = ctx.measureText(candidate).width;
    if (w <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current.trim());
      // 单个 token 本身太宽：按字符折行
      if (ctx.measureText(tk).width > maxWidth) {
        let sub = '';
        for (let i = 0; i < tk.length; i++) {
          const test = sub + tk[i];
          if (ctx.measureText(test).width > maxWidth) {
            if (sub) lines.push(sub);
            sub = tk[i];
          } else {
            sub = test;
          }
        }
        current = sub;
      } else {
        current = tk;
      }
    }
  });
  if (current) lines.push(current.trim());
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

function canvasToTempFilePath(canvas, options = {}) {
  const { destWidth, destHeight } = options;
  
  return new Promise((resolve, reject) => {
    // 显式设置导出尺寸，确保高质量输出
    const exportOptions = {
      canvas: canvas,
      fileType: 'jpg',
      quality: 0.98
    };
    
    // 如果提供了目标尺寸，使用目标尺寸
    if (destWidth && destHeight) {
      exportOptions.destWidth = destWidth;
      exportOptions.destHeight = destHeight;
    }
    
    console.log('canvasToTempFilePath:', {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      destWidth: exportOptions.destWidth,
      destHeight: exportOptions.destHeight,
      quality: exportOptions.quality
    });
    
    wx.canvasToTempFilePath(exportOptions, {
      success: (res) => {
        // 获取导出后的文件信息
        wx.getFileInfo({
          filePath: res.tempFilePath,
          success: (info) => {
            console.log('导出后文件大小:', info.size, '字节');
          },
          fail: (err) => {
            console.error('获取文件信息失败:', err);
          }
        });
        resolve(res.tempFilePath);
      },
      fail: (err) => {
        console.error('canvasToTempFilePath 失败:', err);
        reject(err);
      }
    });
  });
}

module.exports = {
  drawWatermark,
  renderTemplate,
  canvasToTempFilePath
};
