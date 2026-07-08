// utils/imageData.js
// 在 JPEG 图片末尾嵌入/提取记录数据（在 JPEG EOI 标记 0xFFD9 后追加 JSON）
//
// 中文/西语多字节字符问题：JSON.stringify 不转义非 ASCII 字符，
// 直接 charCodeAt + &0xFF 会截断多字节字符的高字节，导致 JSON 损坏。
// 解决方案：先用 encodeURIComponent 编码（纯 ASCII），存储后读取时
// 再用 decodeURIComponent 解码，避免字节截断问题。

var DATA_DELIMITER = '\n---WMDATA---\n';

/**
 * 将记录数据嵌入 JPEG 图片并写出到新文件
 * store_* 路径的文件不可写，所以读取原内容后写出到 USER_DATA_PATH 新文件
 * @param {string} filePath - 源 JPEG 图片路径（只读）
 * @param {Object} recordData - 要嵌入的数据
 * @returns {string|null} 嵌入后新文件的路径，失败返回 null
 */
function embed(filePath, recordData) {
  console.log('[ImageData] embed 开始, filePath:', filePath);
  try {
    var fs = wx.getFileSystemManager();
    var stat;
    try { stat = fs.statSync(filePath); } catch (e) { console.warn('[ImageData] embed: 文件无法访问'); return null; }
    console.log('[ImageData] embed: 源文件大小:', stat.size, 'bytes');

    var imgBytes = fs.readFileSync(filePath);
    if (!imgBytes || !imgBytes.byteLength) { console.warn('[ImageData] embed: 源文件为空'); return null; }
    var u8 = new Uint8Array(imgBytes);
    console.log('[ImageData] embed: 读取', u8.length, 'bytes');
    if (u8[0] !== 0xFF || u8[1] !== 0xD8) { console.log('[ImageData] embed: 非 JPEG, 跳过'); return null; }

    // 从末尾向前查找 JPEG EOI 标记 0xFFD9
    var eoiPos = -1;
    for (var i = u8.length - 2; i >= 0; i--) {
      if (u8[i] === 0xFF && u8[i + 1] === 0xD9) { eoiPos = i + 2; break; }
    }
    if (eoiPos < 0) { console.log('[ImageData] embed: 未找到 EOI'); return null; }
    console.log('[ImageData] embed: EOI 位置 =', eoiPos);

    // 保留 JPEG 数据到 EOI，之后的旧尾随数据丢弃
    var cleanImg = u8.slice(0, eoiPos);

    // 将 JSON 用 encodeURIComponent 编码为纯 ASCII，避免多字节字符截断
    var jsonStr = JSON.stringify(recordData);
    console.log('[ImageData] embed: JSON 原始预览:', jsonStr.slice(0, 150));
    var safeStr = DATA_DELIMITER + encodeURIComponent(jsonStr) + '\n';

    // safeStr 全部是 ASCII（0-127），charCodeAt 安全
    var dataBytes = new Uint8Array(safeStr.length);
    for (var j = 0; j < safeStr.length; j++) dataBytes[j] = safeStr.charCodeAt(j) & 0xFF;
    console.log('[ImageData] embed: 追加', dataBytes.length, '字节');

    // 写入新文件
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
    console.log('[ImageData] extract: 读取', u8.length, 'bytes');

    // 构建分隔符字节数组
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
      var tail = '';
      for (var t = Math.max(0, u8.length - 30); t < u8.length; t++) tail += u8[t].toString(16).padStart(2, '0') + ' ';
      console.log('[ImageData] extract: 文件尾 30 字节:', tail);
      return null;
    }
    console.log('[ImageData] extract: 分隔符找到, 位置:', delimiterPos);

    // 读取分隔符后的内容直到换行符（encodeURIComponent 输出不含换行）
    var encodedBytes = [];
    for (var m = delimiterPos; m < u8.length; m++) {
      if (u8[m] === 0x0A) break; // \n 终止
      encodedBytes.push(u8[m]);
    }
    if (encodedBytes.length === 0) { console.warn('[ImageData] extract: 编码内容为空'); return null; }

    // 字节数组转字符串（纯 ASCII，charCodeAt 安全）
    var encodedStr = '';
    for (var n = 0; n < encodedBytes.length; n++) encodedStr += String.fromCharCode(encodedBytes[n]);
    console.log('[ImageData] extract: 编码字符串预览:', encodedStr.slice(0, 150));

    // decodeURIComponent 还原为原始 JSON
    var jsonStr = decodeURIComponent(encodedStr);
    console.log('[ImageData] extract: JSON 解码预览:', jsonStr.slice(0, 150));

    var parsed = JSON.parse(jsonStr);
    console.log('[ImageData] extract: 解析成功, 字段:', Object.keys(parsed).join(', '));
    return parsed;
  } catch (e) {
    console.warn('[ImageData] 提取数据失败:', e && e.errMsg ? e.errMsg : e);
    return null;
  }
}

module.exports = { embed: embed, extract: extract };
