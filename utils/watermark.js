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
 * 原理：
 *   1. 将水印渲染在 #808080 中性灰背景上 → 获得每个像素的水印贡献值
 *   2. 根据 Alpha 合成公式反向推导原始像素：
 *        watermarked = watermark_contribution + original × (1 - opacity)
 *        → original = (watermarked - watermark_contribution) / (1 - opacity)
 *   3. 只处理水印包围盒内的像素，盒外像素原样保留
 *
 * @param {Object} params - 与 renderWatermarkedImage 相同的水印参数
 * @param {string} params.imagePath - 已有水印的图片路径
 * @returns {Promise<string>} 去水印后的图片路径
 */
async function removeWatermark(params) {
  const { imagePath, template, values, imgW, imgH, customX, customY, customScale, opacity, widthRatio } = params;
  console.log('[Watermark] removeWatermark 开始, imagePath:', imagePath);

  // 1. 创建离屏 Canvas
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
  } else {
    targetW = imgW;
    targetH = imgH;
  }
  canvas.width = targetW;
  canvas.height = targetH;

  // 计算缩放比例（用于将水印坐标映射到 canvas 像素）
  const scaleX = targetW / imgW;
  const scaleY = targetH / imgH;

  // 2. 加载带水印的图片 → 获取其像素数据
  const img = await loadImageOnCanvas(canvas, imagePath);
  ctx.drawImage(img, 0, 0, targetW, targetH);
  var watermarkedData = ctx.getImageData(0, 0, targetW, targetH);
  var wmPixels = watermarkedData.data;

  // 3. 在中性灰背景上渲染水印 → 获取每个像素的水印贡献值
  // 用 #808080 (128,128,128) 作为中性灰
  ctx.clearRect(0, 0, targetW, targetH);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, targetW, targetH);

  const relX = customX != null ? (customX / imgW) * targetW : null;
  const relY = customY != null ? (customY / imgH) * targetH : null;
  renderTemplate(ctx, canvas, template, values, targetW, targetH, relX, relY, customScale, opacity, widthRatio);
  var grayData = ctx.getImageData(0, 0, targetW, targetH);
  var grayPixels = grayData.data;

  // 4. 计算水印包围盒范围（只处理水印区域，提升性能）
  // 重新计算水印位置来确定包围盒（与 renderTemplate 中相同的定位逻辑）
  const style = template.style || {};
  const ratio = targetW / 750;
  const sc = customScale || 1;
  const fontSize = Math.max(14, Math.round((style.fontSize || 22) * ratio * sc));
  const lineHeight = Math.round(fontSize * (style.lineHeight || 1.7));
  const padding = Math.round((style.padding || 14) * ratio * sc);
  const borderRadius = Math.round((style.borderRadius || 10) * ratio);
  const blockW = Math.round(targetW * (widthRatio || 0.42) * sc);
  const indent = Math.round(fontSize * 1.4);
  const textInnerW = blockW - padding * 2;

  ctx.font = fontSize + 'px -apple-system, "PingFang SC", sans-serif';
  var allLines = [];
  (template.fields || []).forEach(function (f) {
    var raw = (values && values[f.key]);
    if (raw == null) return;
    var v = String(raw).trim();
    if (!v) return;
    var labelText = f.label + ':';
    if ((widthRatio || 0.42) >= 0.5 && !f.multiline && !v.includes('\n')) {
      var combined = labelText + ' ' + v;
      if (ctx.measureText(combined).width <= textInnerW) {
        allLines.push({ text: combined }); return;
      }
    }
    allLines.push({ text: labelText });
    v.split(/\r?\n/).forEach(function (p) {
      if (!p.trim()) { allLines.push({ text: '' }); return; }
      var tokens = p.split(/(\s+)/).filter(function (t) { return t.length > 0; });
      var current = '';
      tokens.forEach(function (tk) {
        var candidate = current ? current + (current.endsWith(' ') ? '' : ' ') + tk : tk;
        if (ctx.measureText(candidate).width <= textInnerW - indent) { current = candidate; }
        else { if (current) allLines.push({ text: current.trim() }); current = tk; }
      });
      if (current) allLines.push({ text: current.trim() });
    });
  });

  if (allLines.length > 0) {
    var blockH = padding * 2 + allLines.length * lineHeight;
    var margin2 = Math.round(targetW * 0.04);
    var cx2 = (targetW - blockW) / 2;
    var pos = template.position || 'bottom-left';
    var wmX = margin2, wmY = margin2;
    if (customX != null) wmX = customX;
    else if (pos === 'bottom-center' || pos === 'top-center' || pos === 'center') wmX = cx2;
    else if (pos === 'top-right' || pos === 'center-right' || pos === 'bottom-right') wmX = targetW - blockW - margin2;
    if (customY != null) wmY = customY;
    else if (pos.indexOf('top') >= 0) wmY = margin2;
    else if (pos.indexOf('center') >= 0) wmY = (targetH - blockH) / 2;
    else wmY = targetH - blockH - margin2;
    wmX = Math.max(margin2, Math.min(wmX, targetW - blockW - margin2));
    wmY = Math.max(margin2, Math.min(wmY, targetH - blockH - margin2));

    // 包围盒坐标（像素整数）
    var boxLeft = Math.max(0, Math.floor(wmX - 2));
    var boxTop = Math.max(0, Math.floor(wmY - 2));
    var boxRight = Math.min(targetW, Math.ceil(wmX + blockW + 2));
    var boxBottom = Math.min(targetH, Math.ceil(wmY + blockH + 2));

    // 5. 对包围盒内每个像素做反向 Alpha 合成
    var wmOpacity = opacity != null ? opacity : 0.72;
    var invOpacity = 1 - wmOpacity;
    if (invOpacity < 0.01) invOpacity = 0.01; // 避免除零

    for (var py = boxTop; py < boxBottom; py++) {
      for (var px = boxLeft; px < boxRight; px++) {
        var idx = (py * targetW + px) * 4;
        // 跳过完全透明的像素（水印不覆盖的区域）
        if (grayPixels[idx + 3] < 10) continue;

        // 水印贡献值 = 灰背景上渲染结果 - 灰背景被遮挡部分
        // gray_result = wm_contribution + gray_bg × (1 - opacity)
        // → wm_contribution = gray_result - gray_bg × (1 - opacity)
        var grayBg = 128;
        for (var ch = 0; ch < 3; ch++) {
          var wmContrib = grayPixels[idx + ch] - grayBg * invOpacity;
          // 从带水印照片中还原原始像素
          var orig = (wmPixels[idx + ch] - wmContrib) / invOpacity;
          wmPixels[idx + ch] = Math.max(0, Math.min(255, Math.round(orig)));
        }
        // Alpha 保持不透明
        wmPixels[idx + 3] = 255;
      }
    }
  }

  // 6. 将还原后的像素数据写回 Canvas 并导出
  ctx.clearRect(0, 0, targetW, targetH);
  // 需要重新绘制原图 + 修改后的像素，或直接用 putImageData
  // putImageData 会直接覆盖 canvas 内容
  watermarkedData.data.set(wmPixels);
  ctx.putImageData(watermarkedData, 0, 0);

  var outPath = await exportCanvasToFile(canvas, targetW, targetH);
  console.log('[Watermark] removeWatermark 完成:', outPath);
  return outPath;
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
  renderWatermarkedImage,
  removeWatermark
};
