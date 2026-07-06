// utils/imageData.js
// 在 JPEG 图片末尾嵌入/提取记录数据（在 JPEG EOI 标记 0xFFD9 后追加 JSON）
// 相册保存后再恢复时可跳过 AI 识别，直接重建完整记录（含水印参数）
// 平台兼容：部分系统（如 iOS）相册保存时可能剥离尾随数据，此时 fallback 到多模态 AI

var DATA_DELIMITER = '\n---WMDATA---\n';

/**
 * 将记录数据嵌入 JPEG 图片文件末尾
 * @param {string} filePath - JPEG 图片路径
 * @param {Object} recordData - 要嵌入的数据 { values, templateId, customName, watermarkSettings, ... }
 */
function embed(filePath, recordData) {
  try {
    var fs = wx.getFileSystemManager();
    var imgBytes = fs.readFileSync(filePath);
    if (!imgBytes || !imgBytes.byteLength) return false;

    // 查找 JPEG EOI 标记 0xFFD9
    var u8 = new Uint8Array(imgBytes);
    var eoiPos = -1;
    for (var i = 0; i < u8.length - 1; i++) {
      if (u8[i] === 0xFF && u8[i + 1] === 0xD9) {
        eoiPos = i + 2; // 跳过 0xFFD9 两个字节
      }
    }
    if (eoiPos < 0) return false; // 不是有效 JPEG

    // 剔除已有尾随数据（如果有），保留到 EOI 位置
    var cleanImg = u8.slice(0, eoiPos);

    // 序列化数据并追加
    var dataStr = DATA_DELIMITER + JSON.stringify(recordData) + '\n';
    var dataBytes = new Uint8Array(dataStr.length);
    for (var j = 0; j < dataStr.length; j++) {
      dataBytes[j] = dataStr.charCodeAt(j) & 0xFF;
    }

    var finalBytes = new Uint8Array(cleanImg.length + dataBytes.length);
    finalBytes.set(cleanImg, 0);
    finalBytes.set(dataBytes, cleanImg.length);

    fs.writeFileSync(filePath, finalBytes.buffer, 'binary');
    return true;
  } catch (e) {
    console.warn('[ImageData] 嵌入数据失败:', e);
    return false;
  }
}

/**
 * 从 JPEG 图片文件中提取嵌入的记录数据
 * @param {string} filePath - 图片路径
 * @returns {Object|null} 提取到的数据对象，无嵌入数据时返回 null
 */
function extract(filePath) {
  try {
    var fs = wx.getFileSystemManager();
    var imgBytes = fs.readFileSync(filePath);
    if (!imgBytes || !imgBytes.byteLength) return null;

    var u8 = new Uint8Array(imgBytes);

    // 查找分隔符
    var delimiterBytes = [];
    for (var k = 0; k < DATA_DELIMITER.length; k++) {
      delimiterBytes.push(DATA_DELIMITER.charCodeAt(k) & 0xFF);
    }

    // 从倒数 500KB 范围内搜索分隔符（数据量一般很小，放宽搜索范围）
    var searchStart = Math.max(0, u8.length - 512 * 1024);
    var delimiterPos = -1;
    for (var i = searchStart; i < u8.length - delimiterBytes.length; i++) {
      var found = true;
      for (var j = 0; j < delimiterBytes.length; j++) {
        if (u8[i + j] !== delimiterBytes[j]) { found = false; break; }
      }
      if (found) { delimiterPos = i + delimiterBytes.length; break; }
    }

    if (delimiterPos < 0) return null;

    // 提取分隔符后的 JSON
    var jsonBytes = u8.slice(delimiterPos);
    var jsonStr = '';
    for (var m = 0; m < jsonBytes.length; m++) {
      jsonStr += String.fromCharCode(jsonBytes[m]);
    }
    // 截断到第一个换行（我们的格式是 JSON + \n）
    var nlPos = jsonStr.indexOf('\n');
    if (nlPos >= 0) jsonStr = jsonStr.substring(0, nlPos);

    jsonStr = jsonStr.trim();
    if (!jsonStr) return null;

    return JSON.parse(jsonStr);
  } catch (e) {
    console.warn('[ImageData] 提取数据失败:', e);
    return null;
  }
}

module.exports = {
  embed: embed,
  extract: extract
};
