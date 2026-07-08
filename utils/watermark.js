// utils/watermark.js
// 外贸手写水印渲染器（基于 wx.createOffscreenCanvas，无需 DOM Canvas）
// 渲染规则：
//   - 每一项独立成行；标签一行，内容另起一行并缩进
//   - 西语描述 / 中文描述等长文本字段支持自动换行
//   - 不同项之间留一行空行分隔（或由 lineHeight 的留白）
//   - 水印块默认占图片宽的 42%，定位支持 9 个预设位置 + 自定义坐标

function hexToRgba(hex, alpha) {
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  // 校验：仅允许 6 位十六进制字符，非法值回退默认黑色，避免产出 rgba(NaN,...)
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    return 'rgba(0,0,0,' + alpha + ')';
  }
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function parseColor(color, defaultAlpha) {
  if (!color) return 'rgba(0,0,0,0.6)';
  // rgba 格式：如果提供了自定义透明度，替换原来的 alpha 值
  if (color.indexOf('rgba') === 0) {
    if (defaultAlpha != null) {
      return color.replace(/[\d.]+\)$/, defaultAlpha + ')');
    }
    return color;
  }
  // rgb 格式：转换为 rgba 并应用透明度
  if (color.indexOf('rgb(') === 0) {
    if (defaultAlpha != null) {
      return color.replace('rgb(', 'rgba(').replace(')', ', ' + defaultAlpha + ')');
    }
    return color.replace('rgb(', 'rgba(').replace(')', ', 1)');
  }
  // hex 格式：转换为 rgba
  if (color.indexOf('#') === 0) return hexToRgba(color, defaultAlpha != null ? defaultAlpha : 1);
  return color;
}

/**
 * 核心入口：使用离屏 Canvas 渲染带水印的图片并导出
 *
 * @param {Object} params
 * @param {string} params.imagePath    - 原始图片路径
 * @param {Object} params.template     - 模板对象
 * @param {Object} params.values       - 字段值键值对
 * @param {number} params.imgW         - 原始图片宽度
 * @param {number} params.imgH         - 原始图片高度
 * @param {number} [params.customX]    - 水印 X 偏移（相对原图）
 * @param {number} [params.customY]    - 水印 Y 偏移（相对原图）
 * @param {number} [params.customScale] - 水印缩放倍数
 * @param {number} [params.opacity]    - 水印背景透明度 0-1
 * @param {number} [params.maxEdge]    - 渲染长边最大像素，默认 4096
 * @returns {Promise<string>} 导出后的临时文件路径
 */
async function renderWatermarkedImage(params) {
  const { imagePath, template, values, imgW, imgH, customX, customY, customScale, opacity, maxEdge: maxEdgeOverride, widthRatio } = params;

  console.log('[Watermark] renderWatermarkedImage 开始, imagePath:', imagePath, 'imgSize:', imgW + 'x' + imgH);

  // 1. 参数校验
  if (!imagePath || typeof imagePath !== 'string' || !imagePath.trim()) {
    throw new Error('无效的图片路径');
  }
  if (!template || !template.fields) {
    throw new Error('无效的模板');
  }

  // 2. 创建离屏 Canvas（无需 DOM 元素，纯内存操作）
  let canvas;
  try {
    canvas = wx.createOffscreenCanvas({ type: '2d' });
  } catch (e) {
    throw new Error('创建离屏 Canvas 失败: ' + (e.message || '设备可能不支持'));
  }
  const ctx = canvas.getContext('2d');

  // 3. 计算渲染尺寸（长边最大 4096，避免内存不足；Android 分配失败时自动降级）
  const deviceInfo = wx.getDeviceInfo();
  const isAndroid = deviceInfo.platform === 'android';
  const defaultMaxEdge = 4096;
  const MAX_EDGE = maxEdgeOverride || defaultMaxEdge;

  console.log('[Watermark] 平台:', deviceInfo.platform, '默认maxEdge:', defaultMaxEdge, '实际maxEdge:', MAX_EDGE);

  let targetW = imgW;
  let targetH = imgH;
  const rawMaxEdge = Math.max(imgW, imgH);

  if (rawMaxEdge > MAX_EDGE) {
    const s = MAX_EDGE / rawMaxEdge;
    targetW = Math.round(imgW * s);
    targetH = Math.round(imgH * s);
    console.log('[Watermark] 图片缩放至:', targetW + 'x' + targetH, '(maxEdge:', MAX_EDGE + ')');
  }

  // 4. 设置 Canvas 缓冲区尺寸
  try {
    canvas.width = targetW;
    canvas.height = targetH;
    console.log('[Watermark] Canvas 缓冲区:', targetW + 'x' + targetH);
  } catch (e) {
    // Android 设备内存不足时降级
    const fallbackEdge = isAndroid ? 2048 : 3072;
    console.warn('[Watermark] Canvas 尺寸设置失败，降级到', fallbackEdge, ':', e);
    const s = rawMaxEdge > fallbackEdge ? fallbackEdge / rawMaxEdge : 1;
    targetW = Math.round(imgW * s);
    targetH = Math.round(imgH * s);
    canvas.width = targetW;
    canvas.height = targetH;
  }
  ctx.clearRect(0, 0, targetW, targetH);

  // 5. 计算水印坐标
  let relX = customX != null ? (customX / imgW) * targetW : null;
  let relY = customY != null ? (customY / imgH) * targetH : null;

  // 6. 加载并绘制原图
  const img = await loadImageOnCanvas(canvas, imagePath);
  console.log('[Watermark] 图片加载完成, 尺寸:', img.width + 'x' + img.height);
  ctx.drawImage(img, 0, 0, targetW, targetH);
  console.log('[Watermark] drawImage 完成');

  // 7. 渲染水印
  renderTemplate(ctx, canvas, template, values, targetW, targetH, relX, relY, customScale, opacity, widthRatio);
  console.log('[Watermark] 模板渲染完成');

  // 8. 导出为临时文件
  const outPath = await exportCanvasToFile(canvas, targetW, targetH);
  console.log('[Watermark] 导出完成:', outPath);

  return outPath;
}

/**
 * 从带水印的图片中去除水印，恢复出原始图片
 *
 * 原理（双背景采样法）：
 *   ① 水印渲染在黑背景 (#000) → black_px = wm_contribution（水印贡献值）
 *   ② 水印渲染在白背景 (#FFF) → white_px = wm_contribution + 255×(1-wm_alpha)
 *   ③ 每个像素独立计算：
 *        1 - wm_alpha = (white_px - black_px) / 255
 *        original_px = (watermarked_px - black_px) × 255 / (white_px - black_px)
 *      当 white_px ≈ black_px 时跳过（无水印影响的像素）
 *
 * @param {Object} params - 水印参数（同 renderWatermarkedImage）
 * @returns {Promise<string>} 去水印后的图片路径
 */
async function removeWatermark(params) {
  const { imagePath, template, values, imgW, imgH, customX, customY, customScale, opacity, widthRatio } = params;
  console.log('[Watermark] removeWatermark 开始, imagePath:', imagePath);

  var canvas, ctx, targetW, targetH;
  try {
    canvas = wx.createOffscreenCanvas({ type: '2d' });
    ctx = canvas.getContext('2d');
  } catch (e) {
    throw new Error('创建离屏 Canvas 失败: ' + (e.message || ''));
  }

  const rawMaxEdge = Math.max(imgW, imgH);
  const MAX_EDGE = 4096;
  if (rawMaxEdge > MAX_EDGE) {
    const s = MAX_EDGE / rawMaxEdge;
    targetW = Math.round(imgW * s);
    targetH = Math.round(imgH * s);
  } else { targetW = imgW; targetH = imgH; }
  canvas.width = targetW;
  canvas.height = targetH;
  const sx = targetW / imgW, sy = targetH / imgH;

  // 加载带水印的图片
  const img = await loadImageOnCanvas(canvas, imagePath);
  ctx.drawImage(img, 0, 0, targetW, targetH);
  var wmData = ctx.getImageData(0, 0, targetW, targetH);
  var wmPixels = wmData.data;

  const relX = customX != null ? customX * sx : null;
  const relY = customY != null ? customY * sy : null;

  // ① 黑背景 → 水印贡献值
  ctx.clearRect(0, 0, targetW, targetH);
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, targetW, targetH);
  renderTemplate(ctx, canvas, template, values, targetW, targetH, relX, relY, customScale, opacity, widthRatio);
  var blackData = ctx.getImageData(0, 0, targetW, targetH);
  var bp = blackData.data;

  // ② 白背景 → 白色参考值
  ctx.clearRect(0, 0, targetW, targetH);
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, targetW, targetH);
  renderTemplate(ctx, canvas, template, values, targetW, targetH, relX, relY, customScale, opacity, widthRatio);
  var whiteData = ctx.getImageData(0, 0, targetW, targetH);
  var wp = whiteData.data;

  // ③ 计算水印包围盒
  var box = _calcWatermarkBox(ctx, template, values, targetW, targetH, customX != null ? customX * sx : null, customY != null ? customY * sy : null, customScale, widthRatio);
  if (!box) { console.log('[Watermark] removeWatermark: 水印无内容，跳过'); return await exportCanvasToFile(canvas, targetW, targetH); }

  // ④ 双背景反向还原
  var out = new Uint8Array(wmPixels.length);
  out.set(wmPixels);
  for (var py = box.top; py < box.bottom; py++) {
    for (var px = box.left; px < box.right; px++) {
      var idx = (py * targetW + px) * 4;
      if (bp[idx + 3] < 5) continue;
      for (var ch = 0; ch < 3; ch++) {
        var b = bp[idx + ch], w = wp[idx + ch], diff = w - b;
        if (diff < 2) { out[idx + ch] = wmPixels[idx + ch]; }
        else { out[idx + ch] = Math.max(0, Math.min(255, Math.round((wmPixels[idx + ch] - b) * 255 / diff))); }
      }
      out[idx + 3] = 255;
    }
  }

  // ⑤ 导出
  var id = ctx.createImageData(targetW, targetH);
  id.data.set(out);
  ctx.putImageData(id, 0, 0);
  var result = await exportCanvasToFile(canvas, targetW, targetH);
  console.log('[Watermark] removeWatermark 完成:', result);
  return result;
}

/** 计算水印包围盒像素坐标 */
function _calcWatermarkBox(ctx, template, values, cw, ch, customX, customY, customScale, widthRatio) {
  const style = template.style || {};
  const ratio = cw / 750, sc = customScale || 1;
  const fontSize = Math.max(14, Math.round((style.fontSize || 22) * ratio * sc));
  const lineHeight = Math.round(fontSize * (style.lineHeight || 1.7));
  const padding = Math.round((style.padding || 14) * ratio * sc);
  const blockW = Math.round(cw * (widthRatio || 0.42) * sc);
  const textInnerW = blockW - padding * 2;
  ctx.font = fontSize + 'px -apple-system, "PingFang SC", sans-serif';
  var nLines = 0, has = false;
  (template.fields || []).forEach(function (f) {
    var v = values && values[f.key];
    if (v == null || !String(v).trim()) return;
    has = true; nLines++;
    String(v).split(/\r?\n/).forEach(function (p) {
      if (!p.trim()) { nLines++; return; }
      var cur = '';
      p.split(/(\s+)/).filter(function (t) { return t; }).forEach(function (tk) {
        var c = cur ? cur + (cur.endsWith(' ') ? '' : ' ') + tk : tk;
        if (ctx.measureText(c).width <= textInnerW) { cur = c; } else { if (cur) nLines++; cur = tk; }
      });
      if (cur) nLines++;
    });
  });
  if (!has) return null;
  var blockH = padding * 2 + nLines * lineHeight;
  var margin = Math.round(cw * 0.04), cx2 = (cw - blockW) / 2;
  var pos = template.position || 'bottom-left';
  var x = margin, y = margin;
  if (customX != null) x = customX;
  else if (pos === 'bottom-center' || pos === 'top-center' || pos === 'center') x = cx2;
  else if (pos.indexOf('right') >= 0) x = cw - blockW - margin;
  if (customY != null) y = customY;
  else if (pos.indexOf('top') >= 0) y = margin;
  else if (pos.indexOf('center') >= 0) y = (ch - blockH) / 2;
  else y = ch - blockH - margin;
  x = Math.max(margin, Math.min(x, cw - blockW - margin));
  y = Math.max(margin, Math.min(y, ch - blockH - margin));
  return { left: Math.max(0, Math.floor(x - 2)), top: Math.max(0, Math.floor(y - 2)), right: Math.min(cw, Math.ceil(x + blockW + 2)), bottom: Math.min(ch, Math.ceil(y + blockH + 2)) };
}

/**
 * 在 Canvas 上加载一张图片
 */
function loadImageOnCanvas(canvas, src) {
  return new Promise((resolve, reject) => {
    const img = canvas.createImage();
    if (!img) return reject(new Error('Canvas createImage 不可用'));

    const TIMEOUT = 10000;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error('图片加载超时（10秒）: ' + src));
    }, TIMEOUT);

    img.onload = () => {
      if (timedOut) return;
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = (err) => {
      if (timedOut) return;
      clearTimeout(timer);
      reject(err || new Error('图片加载失败: ' + src));
    };
    img.src = src;
  });
}

/**
 * 导出 Canvas 为临时文件
 */
function exportCanvasToFile(canvas, targetW, targetH) {
  return new Promise((resolve, reject) => {
    console.log('[Watermark] 开始导出, 尺寸:', targetW + 'x' + targetH);

    const EXPORT_TIMEOUT = 15000;
    let exportTimedOut = false;
    const exportTimer = setTimeout(() => {
      exportTimedOut = true;
      reject(new Error('Canvas 导出超时（15秒）'));
    }, EXPORT_TIMEOUT);

    const onSuccess = (res) => {
      if (exportTimedOut) return;
      clearTimeout(exportTimer);
      console.log('[Watermark] 导出成功:', res.tempFilePath);
      wx.getFileSystemManager().getFileInfo({
        filePath: res.tempFilePath,
        success: (info) => {
          console.log('[Watermark] 文件大小:', (info.size / 1024).toFixed(1) + 'KB');
        },
        fail: () => {}
      });
      resolve(res.tempFilePath);
    };

    const onFail = (err) => {
      if (exportTimedOut) return;
      clearTimeout(exportTimer);
      console.error('[Watermark] 导出失败:', JSON.stringify(err));
      reject(err || new Error('Canvas 导出失败'));
    };

    // 离屏 Canvas：尝试 toTempFilePath 方法（较新基础库支持）
    if (typeof canvas.toTempFilePath === 'function') {
      canvas.toTempFilePath({
        x: 0, y: 0,
        width: targetW, height: targetH,
        destWidth: targetW, destHeight: targetH,
        fileType: 'jpg', quality: 0.98,
        success: onSuccess,
        fail: onFail
      });
    } else {
      // 降级：使用 wx.canvasToTempFilePath，回调放在 options 对象内
      wx.canvasToTempFilePath({
        canvas: canvas,
        x: 0, y: 0,
        width: targetW, height: targetH,
        destWidth: targetW, destHeight: targetH,
        fileType: 'jpg', quality: 0.98,
        success: onSuccess,
        fail: onFail
      });
    }
  });
}

/**
 * 逐字段渲染水印
 */
function renderTemplate(ctx, canvas, template, values, cw, ch, customX, customY, customScale, customOpacity, customWidthRatio) {
  const style = template.style || {};
  const position = template.position || 'bottom-left';

  const ratio = cw / 750;
  const scale = customScale || 1;
  const widthRatio = customWidthRatio || 0.42;
  const fontSize = Math.max(14, Math.round((style.fontSize || 22) * ratio * scale));
  const lineHeight = Math.round(fontSize * (style.lineHeight || 1.7));
  const padding = Math.round((style.padding || 14) * ratio * scale);
  const borderRadius = Math.round((style.borderRadius || 10) * ratio);

  const blockW = Math.round(cw * widthRatio * scale);
  const indent = Math.round(fontSize * 1.4);
  const textInnerW = blockW - padding * 2;

  // 必须在 wrapText 之前设置字体，否则 measureText 使用默认字体导致换行计算错误
  ctx.font = fontSize + 'px -apple-system, "PingFang SC", sans-serif';

  // 逐字段分行
  const isWide = (widthRatio || 0.42) >= 0.5;
  const fieldLineGroups = [];
  (template.fields || []).forEach((f) => {
    const raw = (values && values[f.key]);
    if (raw == null) return;
    let v = String(raw).trim();
    if (!v) return;

    const labelText = f.label + ':';
    const isMultiline = f.multiline || f.type === 'textarea';
    const lines = [];

    if (isWide && !isMultiline && !v.includes('\n')) {
      // 宽模式 + 单行内容：尝试 label:value 同行
      const combined = labelText + ' ' + v;
      if (ctx.measureText(combined).width <= textInnerW) {
        lines.push({
          text: combined,
          labelPart: labelText,
          valuePart: v,
          isInline: true,
          type: f.type
        });
      } else {
        // 放不下，降级为两行
        lines.push({ text: labelText, isLabel: true, type: f.type, color: '#ffe58f' });
        lines.push({ text: v, isLabel: false, type: f.type, color: style.color });
      }
    } else {
      // 窄模式或多行内容：label 单独一行，内容缩进另起行
      lines.push({ text: labelText, isLabel: true, type: f.type, color: '#ffe58f' });
      const paragraphs = v.split(/\r?\n/);
      paragraphs.forEach((p) => {
        if (!p.trim() && paragraphs.length > 1) {
          lines.push({ text: '', isLabel: false, type: f.type, color: style.color });
          return;
        }
        wrapText(ctx, p, textInnerW - indent, fontSize).forEach((sub) => {
          lines.push({ text: sub, isLabel: false, type: f.type, color: style.color });
        });
      });
    }

    fieldLineGroups.push({ lines });
  });

  if (fieldLineGroups.length === 0) return;

  // 汇总所有行
  const allLines = [];
  fieldLineGroups.forEach((g) => {
    g.lines.forEach((ln) => allLines.push(ln));
  });

  const blockH = padding * 2 + allLines.length * lineHeight;

  // 水印块定位
  const margin = Math.round(cw * 0.04);
  const cx = (cw - blockW) / 2;
  let x = margin;
  let y = margin;

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

  x = Math.max(margin, Math.min(x, cw - blockW - margin));
  y = Math.max(margin, Math.min(y, ch - blockH - margin));

  // 绘制背景
  const bgColor = parseColor(style.background, customOpacity != null ? customOpacity : 0.72);
  roundRect(ctx, x, y, blockW, blockH, borderRadius, bgColor);

  // 绘制文字
  ctx.textBaseline = 'top';
  const textColor = parseColor(style.color || '#ffffff', 1);
  ctx.lineWidth = Math.max(2, Math.round(fontSize / 8));

  allLines.forEach((ln, i) => {
    if (ln.spacer) return;
    const isContentLine = !ln.isLabel && !ln.isInline;
    const tx = x + padding + (isContentLine ? indent : 0);
    const ty = y + padding + i * lineHeight;

    if (ln.text) {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.strokeText(ln.text, tx, ty);

      if (ln.isInline && ln.labelPart) {
        // 同行模式：label 黄色 + value 白色
        ctx.fillStyle = '#ffe58f';
        ctx.fillText(ln.labelPart, tx, ty);
        const labelW = ctx.measureText(ln.labelPart + ' ').width;
        ctx.fillStyle = textColor;
        ctx.fillText(ln.valuePart, tx + labelW, ty);
      } else {
        ctx.fillStyle = ln.isLabel ? '#ffe58f' : textColor;
        ctx.fillText(ln.text, tx, ty);
      }
    }
  });
}

function wrapText(ctx, text, maxWidth, fontSize) {
  if (!text) return [];
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

module.exports = {
  renderWatermarkedImage
};
