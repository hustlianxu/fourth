// utils/imageData.js
// 在 JPEG 图片末尾嵌入/提取记录数据（在 JPEG EOI 标记 0xFFD9 后追加 JSON）
// 相册保存后再恢复时可跳过 AI 识别，直接重建完整记录（含水印参数）
// 平台兼容：部分系统（如 iOS）相册保存时可能剥离尾随数据，此时 fallback 到多模态 AI

var DATA_DELIMITER = '\n---WMDATA---\n';

/**
 * 将记录数据嵌入 JPEG 图片并写出到新文件（原文件保持只读）
 * store_* 路径的文件不可写，所以读取原内容后写出到 USER_DATA_PATH 新文件
 * @param {string} filePath - 源 JPEG 图片路径（只读，不修改）
 * @param {Object} recordData - 要嵌入的数据 { values, templateId, customName, ... }
 * @returns {string|null} 嵌入后新文件的路径，失败返回 null
 */
function embed(filePath, recordData) {
  console.log('[ImageData] embed 开始, filePath:', filePath);
  try {
    var fs = wx.getFileSystemManager();

    // 读取源文件
    var stat;
    try { stat = fs.statSync(filePath); } catch (e) { console.warn('[ImageData] embed: 无法 stat 源文件', filePath); return null; }
    console.log('[ImageData] embed: 源文件大小:', stat.size, 'bytes');

    var imgBytes = fs.readFileSync(filePath);
    if (!imgBytes || !imgBytes.byteLength) { console.warn('[ImageData] embed: 源文件为空'); return null; }

    var u8 = new Uint8Array(imgBytes);
    console.log('[ImageData] embed: 读取', u8.length, 'bytes, 前2字节:', u8[0].toString(16), u8[1].toString(16));

    // 非 JPEG 则跳过嵌入
    if (u8[0] !== 0xFF || u8[1] !== 0xD8) {
      console.log('[ImageData] embed: 非 JPEG, 跳过嵌入');
      return null;
    }

    // 从末尾向前查找 JPEG EOI 标记 0xFFD9
    var eoiPos = -1;
    for (var i = u8.length - 2; i >= 0; i--) {
      if (u8[i] === 0xFF && u8[i + 1] === 0xD9) { eoiPos = i + 2; break; }
    }
    if (eoiPos < 0) { console.log('[ImageData] embed: 未找到 EOI, 跳过'); return null; }
    console.log('[ImageData] embed: EOI 位置 =', eoiPos, '/', u8.length);

    // 剔除旧尾随数据，保留到 EOI 位置
    var cleanImg = u8.slice(0, eoiPos);

    // 序列化数据
    var dataStr = DATA_DELIMITER + JSON.stringify(recordData) + '\n';
    var dataBytes = new Uint8Array(dataStr.length);
    for (var j = 0; j < dataStr.length; j++) dataBytes[j] = dataStr.charCodeAt(j) & 0xFF;
    console.log('[ImageData] embed: 追加', dataBytes.length, '字节');

    // 写出到新文件（USER_DATA_PATH 可写，不修改源 store_* 文件）
    var outPath = wx.env.USER_DATA_PATH + '/wm_embed_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '.jpg';
    var finalBytes = new Uint8Array(cleanImg.length + dataBytes.length);
    finalBytes.set(cleanImg, 0);
    finalBytes.set(dataBytes, cleanImg.length);
    fs.writeFileSync(outPath, finalBytes.buffer, 'binary');
    console.log('[ImageData] embed: 写出成功:', outPath, '大小:', finalBytes.length, 'bytes');
    return outPath;
  } catch (e) {
    console.warn('[ImageData] 嵌入数据失败:', e && e.errMsg ? e.errMsg : e);
    return null;
  }
}

/**
 * 从图片文件中提取嵌入的记录数据
 * @param {string} filePath - 图片路径
 * @returns {Object|null} 提取到的数据对象，无嵌入数据时返回 null
 */
function extract(filePath) {
  console.log('[ImageData] extract 开始, filePath:', filePath);
  try {
    var fs = wx.getFileSystemManager();
    var stat;
    try { stat = fs.statSync(filePath); } catch (e) { console.warn('[ImageData] extract: 文件无法访问'); return null; }
    console.log('[ImageData] extract: 文件大小:', stat.size, 'bytes');

    var imgBytes = fs.readFileSync(filePath);
    if (!imgBytes || !imgBytes.byteLength) { console.warn('[ImageData] extract: 读取为空'); return null; }
    var u8 = new Uint8Array(imgBytes);
    console.log('[ImageData] extract: 读取', u8.length, 'bytes, 前2字节:', u8[0].toString(16), u8[1].toString(16));

    // 构建分隔符字节
    var delim = [];
    for (var k = 0; k < DATA_DELIMITER.length; k++) delim.push(DATA_DELIMITER.charCodeAt(k) & 0xFF);

    // 从倒数 512KB 搜索分隔符
    var searchStart = Math.max(0, u8.length - 512 * 1024);
    var delimiterPos = -1;
    for (var i = searchStart; i < u8.length - delim.length; i++) {
      var found = true;
      for (var j = 0; j < delim.length; j++) { if (u8[i + j] !== delim[j]) { found = false; break; } }
      if (found) { delimiterPos = i + delim.length; break; }
    }
    if (delimiterPos < 0) {
      console.log('[ImageData] extract: 未找到分隔符');
      // 输出文件尾 30 字节辅助排查
      var tail = '';
      for (var t = Math.max(0, u8.length - 30); t < u8.length; t++) tail += u8[t].toString(16).padStart(2, '0') + ' ';
      console.log('[ImageData] extract: 文件尾 30 字节:', tail);
      return null;
    }
    console.log('[ImageData] extract: 分隔符找到, 位置:', delimiterPos);

    // 提取 JSON
    var jsonBytes = u8.slice(delimiterPos);
    var jsonStr = '';
    for (var m = 0; m < jsonBytes.length; m++) jsonStr += String.fromCharCode(jsonBytes[m]);
    var nlPos = jsonStr.indexOf('\n');
    if (nlPos >= 0) jsonStr = jsonStr.substring(0, nlPos);
    jsonStr = jsonStr.trim();
    if (!jsonStr) { console.warn('[ImageData] extract: JSON 为空'); return null; }

    var parsed = JSON.parse(jsonStr);
    console.log('[ImageData] extract: 解析成功, 字段:', Object.keys(parsed).join(', '));
    return parsed;
  } catch (e) {
    console.warn('[ImageData] 提取数据失败:', e && e.errMsg ? e.errMsg : e);
    return null;
  }
}

module.exports = { embed: embed, extract: extract };
