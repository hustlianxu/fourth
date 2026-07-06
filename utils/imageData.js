// utils/imageData.js
// 在 JPEG 图片末尾嵌入/提取记录数据（在 JPEG EOI 标记 0xFFD9 后追加 JSON）
// 相册保存后再恢复时可跳过 AI 识别，直接重建完整记录（含水印参数）
// 平台兼容：部分系统（如 iOS）相册保存时可能剥离尾随数据，此时 fallback 到多模态 AI

var DATA_DELIMITER = '\n---WMDATA---\n';

/**
 * 将记录数据嵌入 JPEG 图片文件末尾
 * @param {string} filePath - JPEG 图片路径
 * @param {Object} recordData - 要嵌入的数据 { values, templateId, customName, watermarkSettings, ... }
 * @returns {boolean} 是否嵌入成功
 */
function embed(filePath, recordData) {
  console.log('[ImageData] embed 开始, filePath:', filePath);
  try {
    var fs = wx.getFileSystemManager();

    // 读取前先检查文件是否存在及大小
    var stat;
    try { stat = fs.statSync(filePath); } catch (e) {}
    if (stat) {
      console.log('[ImageData] embed: 文件大小:', stat.size, 'bytes');
    } else {
      console.warn('[ImageData] embed: 文件不存在?', filePath);
      return false;
    }

    var imgBytes = fs.readFileSync(filePath);
    if (!imgBytes || !imgBytes.byteLength) {
      console.warn('[ImageData] embed: 读取文件为空');
      return false;
    }
    console.log('[ImageData] embed: 读取 ' + imgBytes.byteLength + ' bytes');

    var u8 = new Uint8Array(imgBytes);

    // 检测文件头是否为 JPEG
    if (u8[0] !== 0xFF || u8[1] !== 0xD8) {
      console.warn('[ImageData] embed: 不是 JPEG 文件, 前2字节:', u8[0].toString(16), u8[1].toString(16));
      return false;
    }

    // 从末尾向前查找 JPEG EOI 标记 0xFFD9（更可靠）
    var eoiPos = -1;
    for (var i = u8.length - 2; i >= 0; i--) {
      if (u8[i] === 0xFF && u8[i + 1] === 0xD9) {
        eoiPos = i + 2; // 跳过 0xFFD9 两个字节
        break;
      }
    }
    if (eoiPos < 0) {
      console.warn('[ImageData] embed: 未找到 JPEG EOI 标记');
      return false;
    }
    console.log('[ImageData] embed: EOI 位置 =', eoiPos, '(总长度 =', u8.length, ')');

    // 检查是否已有嵌入数据（分隔符 + 旧数据）
    // 剔除旧尾随数据，保留到 EOI 位置
    var cleanImg = u8.slice(0, eoiPos);

    // 序列化数据并追加
    var dataStr = DATA_DELIMITER + JSON.stringify(recordData) + '\n';
    var dataBytes = new Uint8Array(dataStr.length);
    for (var j = 0; j < dataStr.length; j++) {
      dataBytes[j] = dataStr.charCodeAt(j) & 0xFF;
    }
    console.log('[ImageData] embed: 追加数据', dataStr.length, '字节, JSON 预览:', JSON.stringify(recordData).slice(0, 120));

    var finalBytes = new Uint8Array(cleanImg.length + dataBytes.length);
    finalBytes.set(cleanImg, 0);
    finalBytes.set(dataBytes, cleanImg.length);

    fs.writeFileSync(filePath, finalBytes.buffer, 'binary');
    console.log('[ImageData] embed: 写入完成, 最终大小:', finalBytes.length, 'bytes, 成功');
    return true;
  } catch (e) {
    console.warn('[ImageData] 嵌入数据失败:', e && e.errMsg ? e.errMsg : e);
    return false;
  }
}

/**
 * 从 JPEG 图片文件中提取嵌入的记录数据
 * @param {string} filePath - 图片路径
 * @returns {Object|null} 提取到的数据对象，无嵌入数据时返回 null
 */
function extract(filePath) {
  console.log('[ImageData] extract 开始, filePath:', filePath);
  try {
    var fs = wx.getFileSystemManager();

    // 检查文件
    var stat;
    try { stat = fs.statSync(filePath); } catch (e) { console.warn('[ImageData] extract: 文件无法访问', filePath); return null; }
    console.log('[ImageData] extract: 文件大小:', stat.size, 'bytes');

    var imgBytes = fs.readFileSync(filePath);
    if (!imgBytes || !imgBytes.byteLength) {
      console.warn('[ImageData] extract: 读取文件为空');
      return null;
    }
    console.log('[ImageData] extract: 读取 ' + imgBytes.byteLength + ' bytes');

    var u8 = new Uint8Array(imgBytes);

    // 检测 JPEG 文件头
    if (u8[0] !== 0xFF || u8[1] !== 0xD8) {
      console.warn('[ImageData] extract: 不是 JPEG, 前2字节:', u8[0].toString(16), u8[1].toString(16),
        '文件类型可能是:', u8[0] === 0x89 ? 'PNG' : (u8[0] === 0x47 ? 'GIF' : (u8[0] === 0x42 ? 'BMP' : '其他')));
    }

    // 查找分隔符
    var delimiterBytes = [];
    for (var k = 0; k < DATA_DELIMITER.length; k++) {
      delimiterBytes.push(DATA_DELIMITER.charCodeAt(k) & 0xFF);
    }
    console.log('[ImageData] extract: 分隔符长度', delimiterBytes.length, 'bytes');

    // 从倒数 500KB 范围内搜索分隔符
    var searchStart = Math.max(0, u8.length - 512 * 1024);
    console.log('[ImageData] extract: 搜索范围', searchStart, '-', u8.length);

    var delimiterPos = -1;
    for (var i = searchStart; i < u8.length - delimiterBytes.length; i++) {
      var found = true;
      for (var j = 0; j < delimiterBytes.length; j++) {
        if (u8[i + j] !== delimiterBytes[j]) { found = false; break; }
      }
      if (found) { delimiterPos = i + delimiterBytes.length; break; }
    }

    if (delimiterPos < 0) {
      console.log('[ImageData] extract: 未找到分隔符 → 无嵌入数据');
      // 看最后 50 字节的内容辅助排查
      var tailStart = Math.max(0, u8.length - 50);
      var tailStr = '';
      for (var t = tailStart; t < u8.length; t++) tailStr += u8[t].toString(16).padStart(2, '0') + ' ';
      console.log('[ImageData] extract: 文件尾 50 字节:', tailStr);
      return null;
    }

    console.log('[ImageData] extract: 分隔符找到, JSON 起始位置:', delimiterPos);

    // 提取分隔符后的 JSON
    var jsonBytes = u8.slice(delimiterPos);
    var jsonStr = '';
    for (var m = 0; m < jsonBytes.length; m++) {
      jsonStr += String.fromCharCode(jsonBytes[m]);
    }
    // 截断到第一个换行
    var nlPos = jsonStr.indexOf('\n');
    if (nlPos >= 0) jsonStr = jsonStr.substring(0, nlPos);

    jsonStr = jsonStr.trim();
    if (!jsonStr) {
      console.warn('[ImageData] extract: JSON 字符串为空');
      return null;
    }

    console.log('[ImageData] extract: JSON 原始文本:', jsonStr.slice(0, 150));
    var parsed = JSON.parse(jsonStr);
    console.log('[ImageData] extract: 解析成功, 字段:', Object.keys(parsed).join(', '));
    return parsed;
  } catch (e) {
    console.warn('[ImageData] 提取数据失败:', e && e.errMsg ? e.errMsg : e);
    return null;
  }
}

module.exports = {
  embed: embed,
  extract: extract
};
