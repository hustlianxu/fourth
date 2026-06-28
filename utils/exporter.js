// utils/exporter.js
// 导出记录为 Excel：
//   主路径 → 真实 .xlsx（OOXML，图片原始字节嵌入不压缩）
//   回退路径 → 伪 .xls（HTML+VML，base64 图片）
// 导出时自动翻译：desEs 有值 desZh 空 → 译为中文；desZh 有值 desEs 空 → 译为西语

var translator = require('./translator.js');
var xlsxWriter = require('./xlsx-writer.js');

var COLUMNS = [
  { key: 'imagePath', header: 'FOTO', isImage: true },
  { key: 'modelo',    header: 'CODIGO' },
  { key: 'desEs',     header: 'DETALLADOS' },
  { key: 'desZh',     header: '描述' },
  { key: 'precio',    header: 'PRECIO' },
  { key: 'pzs',       header: 'CANTIDAD DE CAJA' },
  { key: 'cajas',     header: 'CUANTAS CAJAS' },
  { key: 'volumen',   header: 'CUBICO' },
  { key: 'peso',      header: 'PESO' }
];

var IMG_CELL_W = 220;       // FOTO 列单元格宽度（px）
var MIN_ROW_H = 60;         // 最小行高
var ROW_PAD = 16;           // 行高额外留白
var CHAR_W = 9;             // 中文字符大约宽度（px）
var MIN_COL_W = 60;         // 列最小宽度
var MAX_NAME_LEN = 50;      // 自定义文件名最大长度

/**
 * 清理文件名，移除文件系统不安全字符
 */
function sanitizeFileName(name) {
  if (!name) return 'export_' + Date.now();
  return String(name)
    .replace(/[\/\\:*?"<>|]/g, '_')   // 移除文件系统不安全字符
    .replace(/\s+/g, '_')              // 空白字符替换为下划线
    .slice(0, MAX_NAME_LEN)            // 截断至最大长度
    || 'export_' + Date.now();         // 清理后为空则回退
}

/**
 * 读取图片文件为 base64（不压缩）
 */
function readFileAsBase64(filePath) {
  return new Promise(function (resolve) {
    wx.getFileSystemManager().readFile({
      filePath: filePath,
      encoding: 'base64',
      success: function (res) { resolve(res.data); },
      fail: function (err) {
        console.warn('[Exporter] 读取图片失败:', filePath, err);
        resolve(null);
      }
    });
  });
}

function _isArrayBuffer(obj) {
  if (obj instanceof ArrayBuffer) return true;
  if (obj && typeof obj === 'object' &&
      Object.prototype.toString.call(obj) === '[object ArrayBuffer]') return true;
  return false;
}

function _toUint8Array(data) {
  if (!data) return null;
  if (data instanceof Uint8Array) return data;
  if (_isArrayBuffer(data)) return new Uint8Array(data);
  if (typeof data === 'object' && _isArrayBuffer(data.buffer)) {
    return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength != null ? data.byteLength : data.buffer.byteLength);
  }
  if (typeof data === 'string') {
    var len = data.length;
    var arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) arr[i] = data.charCodeAt(i) & 0xff;
    return arr;
  }
  return null;
}

/**
 * 异步读取图片文件原始字节（用于 xlsx 嵌入，不压缩）
 * 使用异步 readFile，兼容跨 realm 的 ArrayBuffer（Mac 开发者工具常见）。
 * 失败时回退到 readFileSync（base64→字节），进一步提升兼容性。
 */
function readImageBytes(filePath) {
  return new Promise(function (resolve) {
    if (!filePath) { resolve(null); return; }
    var fs = wx.getFileSystemManager();
    fs.readFile({
      filePath: filePath,
      success: function (res) {
        var u8 = _toUint8Array(res && res.data);
        if (u8 && u8.length > 0) {
          resolve(u8);
          return;
        }
        // 异步读返回格式异常 → 回退同步读 base64
        try {
          var b64 = fs.readFileSync(filePath, 'base64');
          if (b64 && typeof b64 === 'string' && b64.length > 0) {
            var decoded = _base64ToUint8Array(b64);
            if (decoded && decoded.length > 0) {
              resolve(decoded);
              return;
            }
          }
        } catch (e) {
          console.warn('[Exporter] 同步回退读取失败:', filePath, e);
        }
        console.warn('[Exporter] 图片字节格式异常:', filePath, typeof (res && res.data));
        resolve(null);
      },
      fail: function (err) {
        console.warn('[Exporter] 读取图片字节失败，尝试同步回退:', filePath, err && err.errMsg);
        try {
          var b64_1 = fs.readFileSync(filePath, 'base64');
          if (b64_1 && typeof b64_1 === 'string' && b64_1.length > 0) {
            var decoded_1 = _base64ToUint8Array(b64_1);
            if (decoded_1 && decoded_1.length > 0) {
              resolve(decoded_1);
              return;
            }
          }
        } catch (e2) {
          console.warn('[Exporter] 同步回退也失败:', filePath, e2);
        }
        resolve(null);
      }
    });
  });
}

function _base64ToUint8Array(b64) {
  if (typeof wx !== 'undefined' && wx.base64ToArrayBuffer) {
    try {
      var ab = wx.base64ToArrayBuffer(b64);
      if (ab) return new Uint8Array(ab);
    } catch (e) {}
  }
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var str = String(b64).replace(/\s+/g, '');
  var cleanStr = str.replace(/=+$/, '');
  var len = cleanStr.length;
  var byteLen = Math.floor(len * 3 / 4);
  var bytes = new Uint8Array(byteLen);
  var byteIdx = 0;
  for (var i = 0; i < len; i += 4) {
    var c1 = chars.indexOf(cleanStr.charAt(i));
    var c2 = chars.indexOf(cleanStr.charAt(i + 1));
    var c3 = i + 2 < len ? chars.indexOf(cleanStr.charAt(i + 2)) : -1;
    var c4 = i + 3 < len ? chars.indexOf(cleanStr.charAt(i + 3)) : -1;
    if (c1 < 0 || c2 < 0) break;
    var b1 = (c1 << 2) | (c2 >> 4);
    bytes[byteIdx++] = b1 & 0xff;
    if (c3 >= 0) {
      var b2 = ((c2 & 15) << 4) | (c3 >> 2);
      bytes[byteIdx++] = b2 & 0xff;
    }
    if (c4 >= 0) {
      var b3 = ((c3 & 3) << 6) | c4;
      bytes[byteIdx++] = b3 & 0xff;
    }
  }
  if (byteIdx !== byteLen) {
    return bytes.subarray(0, byteIdx);
  }
  return bytes;
}

/**
 * 预读所有记录的图片字节（异步，分批串行）
 * 大数量导出时避免一次性并发读取 N 张图片导致内存/IO 峰值过高。
 * 策略：每批 IMG_BATCH_SIZE 张，批内并行、批间串行，逐批填充 map。
 * 最终仍返回完整 map，由 buildXlsx 生成单文件单 sheet，不分多次、不分多 sheet。
 * 返回 { map: {recordIdx: Uint8Array}, failures: [recordIdx], total: N }
 * 任一有 imagePath 的记录读不到字节 → 计入 failures
 */
var IMG_BATCH_SIZE = 50;   // 每批并发读取图片数，兼顾吞吐与内存峰值

function preReadImageBytes(records, onProgress) {
  var map = {};
  var failures = [];   // 元素: { idx, name }，name 便于定位失败记录
  var total = records.length;
  var done = 0;

  function readOne(rec, idx) {
    if (!rec.imagePath) {
      return Promise.resolve({ idx: idx, bytes: null, hasPath: false });
    }
    return readImageBytes(rec.imagePath).then(function (bytes) {
      return { idx: idx, bytes: bytes, hasPath: true };
    });
  }

  // 处理从 start 开始的一批，批内并行
  function processBatch(start) {
    var end = Math.min(start + IMG_BATCH_SIZE, total);
    var tasks = [];
    for (var i = start; i < end; i++) {
      tasks.push(readOne(records[i], i));
    }
    return Promise.all(tasks).then(function (results) {
      results.forEach(function (r) {
        if (r.bytes && r.bytes.length) {
          map[r.idx] = r.bytes;
        } else if (r.hasPath) {
          var rec = records[r.idx] || {};
          failures.push({ idx: r.idx, name: rec.customName || rec.id || ('记录#' + r.idx) });
        }
      });
      done = end;
      if (onProgress) {
        try {
          onProgress('正在读取图片 ' + done + '/' + total + '...');
        } catch (e) {}
      }
      if (end < total) return processBatch(end);
      return { map: map, failures: failures, total: total };
    });
  }

  return processBatch(0);
}

/**
 * 扁平化记录：把 rec.values[key] 提到 rec 顶层，便于 xlsx-writer 统一访问
 */
function flattenRecords(records) {
  return records.map(function (rec) {
    var flat = { imagePath: rec.imagePath, width: rec.width, height: rec.height };
    COLUMNS.forEach(function (col) {
      if (!col.isImage) {
        flat[col.key] = (rec.values && rec.values[col.key] != null) ? rec.values[col.key] : '';
      }
    });
    return flat;
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 根据图片宽高比计算显示高度（保持比例，填充单元格宽度）
 */
function calcImgDisplayH(rec) {
  var imgW = rec.width || 1080;
  var imgH = rec.height || 1440;
  return Math.round(IMG_CELL_W * (imgH / imgW));
}

/**
 * 根据图片比例计算行高
 */
function calcRowHeight(rec) {
  return Math.max(calcImgDisplayH(rec), MIN_ROW_H) + ROW_PAD;
}

/**
 * 计算各列最宽内容所需的像素宽度
 */
function calcColumnWidths(records) {
  var widths = {};
  COLUMNS.forEach(function (col) {
    if (col.isImage) {
      widths[col.key] = IMG_CELL_W;
      return;
    }
    // 从表头开始
    var maxLen = col.header.length;
    records.forEach(function (rec) {
      var v = (rec.values && rec.values[col.key]) || '';
      var len = String(v).length;
      if (len > maxLen) maxLen = len;
    });
    widths[col.key] = Math.max(Math.round(maxLen * CHAR_W) + 24, MIN_COL_W);
  });
  return widths;
}

/**
 * 生成 <col> 标签设置各列宽度
 */
function buildColGroup(colWidths) {
  var html = '<colgroup>';
  COLUMNS.forEach(function (col) {
    html += '<col width="' + colWidths[col.key] + '">';
  });
  html += '</colgroup>';
  return html;
}

async function buildHtmlTable(records, onProgress) {
  // 翻译已在前置 preTranslateRecords 阶段完成，这里只负责生成 HTML
  var colWidths = calcColumnWidths(records);

  var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" '
    + 'xmlns:x="urn:schemas-microsoft-com:office:excel" '
    + 'xmlns:v="urn:schemas-microsoft-com:vml" '
    + 'xmlns="http://www.w3.org/TR/REC-html40">';
  html += '<head><meta charset="UTF-8"/>';
  html += '<!--[if gte mso 9]><xml>'
    + '<x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>'
    + '<x:Name>Sheet1</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>'
    + '</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook>'
    + '</xml><![endif]-->';
  html += '<style>'
    + 'table{border-collapse:collapse;border:1px solid #999;}'
    + 'th{background:#4472C4;color:#fff;padding:8px 12px;font-size:12px;'
    + 'border:1px solid #999;text-align:center;font-weight:bold;}'
    + 'td{padding:4px 8px;font-size:12px;border:1px solid #ccc;'
    + 'vertical-align:middle;white-space:normal;vnd.ms-excel.numberformat:@;}'
    + 'v\\:*{behavior:url(#default#VML);}'
    + '</style></head><body><table>';
  html += buildColGroup(colWidths);

  // 表头
  html += '<tr height="28">';
  COLUMNS.forEach(function (c) { html += '<th>' + c.header + '</th>'; });
  html += '</tr>';

  // 数据行：先并行预读所有图片 base64，避免循环内串行 await 导致 N 张图 N 次串行 IO
  var b64Promises = records.map(function (rec) {
    return rec.imagePath ? readFileAsBase64(rec.imagePath) : Promise.resolve('');
  });
  var b64List = await Promise.all(b64Promises);

  for (var ri = 0; ri < records.length; ri++) {
    var rec = records[ri];
    var imgH = calcImgDisplayH(rec);
    var rowH = calcRowHeight(rec);

    html += '<tr height="' + rowH + '">';
    for (var ci = 0; ci < COLUMNS.length; ci++) {
      var col = COLUMNS[ci];
      if (col.isImage) {
        var imgHtml = '';
        if (rec.imagePath) {
          var b64 = b64List[ri];
          if (b64) {
            imgHtml = '<!--[if gte vml 1]>'
              + '<v:shape style="width:' + IMG_CELL_W + 'px;height:' + imgH + 'px;'
              + 'position:absolute;mso-position-horizontal:center;mso-position-vertical:middle;"'
              + ' filled="t" stroked="f" coordsize="' + IMG_CELL_W + ',' + imgH + '">'
              + '<v:imagedata src="data:image/jpeg;base64,' + b64 + '" o:title="FOTO"/>'
              + '</v:shape>'
              + '<![endif]-->'
              + '<img src="data:image/jpeg;base64,' + b64 + '" '
              + 'width="' + IMG_CELL_W + '" height="' + imgH + '" />';
          } else {
            imgHtml = '图片读取失败';
          }
        }
        html += '<td style="width:' + colWidths[col.key]
          + 'px;text-align:center;">' + imgHtml + '</td>';
      } else {
        var v = (rec.values && rec.values[col.key]) || '';
        html += '<td style="text-align:left;padding-left:8px;">' + escapeHtml(String(v)) + '</td>';
      }
    }
    html += '</tr>';
  }

  html += '</table></body></html>';
  return html;
}

/**
 * 导出主入口：先尝试真实 .xlsx，失败回退伪 .xls
 */
function exportToExcel(records, customFileName, onProgress) {
  if (!records || records.length === 0) throw new Error('没有选中任何记录');

  console.log('[Exporter] 导出记录数:', records.length, '自定义文件名:', customFileName || '(无)');

  // 1. 翻译预处理（两路径共用）
  return preTranslateRecords(records, onProgress).then(function () {
    // 2. 主路径：真实 xlsx
    return exportToXlsx(records, customFileName).then(
      function (path) { return path; },
      function (err) {
        console.warn('[Exporter] xlsx 生成失败，回退伪 xls:', err && err.message);
        if (onProgress) onProgress('正在回退生成兼容 Excel...');
        return exportToLegacyXls(records, customFileName);
      }
    );
  });
}

/**
 * 翻译预处理：自动填充空缺的描述列（供 xlsx / 伪 xls 两条路径共用）
 * 翻译方向依据文本真实语言（detectLang），而非依据字段名。
 *
 * 批量优化：把所有需翻译的项收集后，按 (from,to) 分组，每组单次 API 调用。
 * N 条记录的翻译从 N 次请求降到最多 2 次（ZH→ES + ES→ZH 各一次）。
 */
function preTranslateRecords(records, onProgress) {
  // 第一遍：收集所有需翻译的项
  var tasks = [];  // {recordIdx, from, to, text, fillTo, moveOriginalTo}
  records.forEach(function (rec, i) {
    if (!rec.values) rec.values = {};
    var desEs = (rec.values.desEs || '').trim();
    var desZh = (rec.values.desZh || '').trim();

    if (desEs && !desZh) {
      var lang = translator.detectLang(desEs);
      if (lang === 'zh') {
        // desEs 实际是中文 → 译为西语，原文移到 desZh，译文填到 desEs
        tasks.push({
          recordIdx: i, from: 'zh', to: 'es', text: desEs,
          fillTo: 'desEs', moveOriginalTo: 'desZh', original: desEs
        });
      } else if (lang === 'es') {
        // desEs 是西语 → 译为中文填到 desZh
        tasks.push({
          recordIdx: i, from: 'es', to: 'zh', text: desEs,
          fillTo: 'desZh', moveOriginalTo: null, original: desEs
        });
      }
    } else if (desZh && !desEs) {
      var lang2 = translator.detectLang(desZh);
      if (lang2 === 'zh') {
        // desZh 是中文 → 译为西语填到 desEs
        tasks.push({
          recordIdx: i, from: 'zh', to: 'es', text: desZh,
          fillTo: 'desEs', moveOriginalTo: null, original: desZh
        });
      } else if (lang2 === 'es') {
        // desZh 实际是西语 → 译为中文，原文移到 desEs，译文填到 desZh
        tasks.push({
          recordIdx: i, from: 'es', to: 'zh', text: desZh,
          fillTo: 'desZh', moveOriginalTo: 'desEs', original: desZh
        });
      }
    }
    // 两者都有值或都空 → 不处理
  });

  if (tasks.length === 0) return Promise.resolve();

  if (onProgress) onProgress('批量翻译中 ' + tasks.length + ' 条...');

  // 批量调用（按 from→to 分组，每组单次 API）
  var items = tasks.map(function (t) { return { text: t.text, from: t.from, to: t.to }; });
  return translator.translateBatch(items, true).then(function (results) {
    results.forEach(function (r, idx) {
      var t = tasks[idx];
      var rec = records[t.recordIdx];
      console.log('[Exporter] ' + t.from.toUpperCase() + '→' + t.to.toUpperCase() + ' 行' + (t.recordIdx + 1),
        r.debug, '原文:', t.text, '译文:', r.result);
      // 判断是否真正翻译成功（本地全命中 source=local_all，或 API 成功 source=api_*）
      // 本地降级 source=local_no_api / local_api_fail 时 r.result 是原文，不算成功
      var src = r && r.debug && r.debug.source;
      var translated = r && r.result && src && src !== 'local_no_api' && src !== 'local_api_fail';
      if (translated) {
        // 翻译成功：译文填到目标字段
        rec.values[t.fillTo] = r.result;
        // 若指定了 moveOriginalTo（如 desEs=中文 → 译为西语，原文需移到 desZh），
        // 必须把原文写到目标列，否则第4列为空
        if (t.moveOriginalTo) {
          rec.values[t.moveOriginalTo] = t.original;
        }
      } else if (t.moveOriginalTo) {
        // 翻译失败但有 moveOriginalTo：清空 fillTo（避免原文残留），原文移到 moveOriginalTo
        rec.values[t.fillTo] = '';
        rec.values[t.moveOriginalTo] = t.original;
      }
      // 翻译失败且无 moveOriginalTo：原文留原字段，目标字段保持空
    });
  }).catch(function (err) {
    // 翻译整体失败时不应阻断导出：保留原文，继续后续 xlsx / xls 生成
    console.error('[Exporter] 批量翻译异常，保留原文继续导出:', err);
  });
}

/**
 * 主路径：真实 .xlsx（OOXML，图片原始字节不压缩）
 * 先翻译预处理，再异步预读图片字节，任一失败则 reject 触发回退到伪 xls
 */
function exportToXlsx(records, customFileName, onProgress) {
  // 1. 翻译预处理（依据文本真实语言填充 desEs/desZh）
  return preTranslateRecords(records, onProgress).then(function () {
  // 2. 异步预读所有图片字节（分批串行，降低大数量导出时的内存/IO 峰值）
  return preReadImageBytes(records, onProgress).then(function (preRead) {
    // 有图片读取失败 → reject 触发回退（用户要求：图片无法导入则回退伪 xls）
    if (preRead.failures.length > 0) {
      var failNames = preRead.failures.map(function (f) { return f.name; }).join(', ');
      console.warn('[Exporter] 图片字节预读失败 ' + preRead.failures.length + ' 张，记录:',
        failNames, '→ 触发回退伪 xls');
      throw new Error('图片读取失败 ' + preRead.failures.length + ' 张：' + failNames.slice(0, 60));
    }

    // 3. 构建 xlsx（同步，使用预读字节）
    var bytes;
    try {
      var flatRecords = flattenRecords(records);
      var colWidths = calcColumnWidths(records);
      bytes = xlsxWriter.buildXlsx(flatRecords, COLUMNS, {
        imageBytesMap: preRead.map,   // 预读字节 map: {recordIdx: Uint8Array}
        getImageBytes: null,          // 不再用同步读取
        calcRowHeight: calcRowHeight,
        calcImgDisplayH: calcImgDisplayH,
        calcColumnWidths: function () { return colWidths; },
        imgColW: IMG_CELL_W
      });
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }

    // 3. 写入文件并打开
    var baseName = customFileName ? sanitizeFileName(customFileName) : ('export_' + Date.now());
    var fileName = baseName + '.xlsx';
    var filePath = wx.env.USER_DATA_PATH + '/' + fileName;

    return new Promise(function (resolve, reject) {
      wx.getFileSystemManager().writeFile({
        filePath: filePath,
        data: bytes.buffer,
        encoding: 'binary',
        success: function () {
          console.log('[Exporter] xlsx 写入完成:', filePath, '大小:', bytes.length, 'bytes');
          wx.openDocument({
            filePath: filePath, fileType: 'xlsx', showMenu: true,
            success: function () { resolve(filePath); },
            fail: function (err) {
              wx.shareFileMessage({
                filePath: filePath, fileName: baseName + '.xlsx',
                success: function () { resolve(filePath); },
                fail: function () { reject(new Error('打开 xlsx 文件失败')); }
              });
            }
          });
        },
        fail: function (err) { reject(new Error('写入 xlsx 失败: ' + (err && err.errMsg))); }
      });
    });
  });  // preReadImageBytes.then
  });  // preTranslateRecords.then
}

/**
 * 回退路径：伪 .xls（HTML + VML，base64 图片）
 * 同样先翻译预处理，确保 desEs/desZh 双语填充
 */
function exportToLegacyXls(records, customFileName, onProgress) {
  return preTranslateRecords(records, onProgress).then(function () {
    return buildHtmlTable(records).then(function (html) {
    var baseName = customFileName ? sanitizeFileName(customFileName) : ('export_' + Date.now());
    var fileName = baseName + '.xls';
    var filePath = wx.env.USER_DATA_PATH + '/' + fileName;

    return new Promise(function (resolve, reject) {
      wx.getFileSystemManager().writeFile({
        filePath: filePath, data: html, encoding: 'utf8',
        success: function () {
          console.log('[Exporter] 伪 xls 写入完成:', filePath);
          wx.openDocument({
            filePath: filePath, fileType: 'xls', showMenu: true,
            success: function () { resolve(filePath); },
            fail: function (err) {
              wx.shareFileMessage({
                filePath: filePath, fileName: '水印照片导出.xls',
                success: function () { resolve(filePath); },
                fail: function () { reject(new Error('打开文件失败')); }
              });
            }
          });
        },
        fail: function (err) { reject(err); }
      });
    });
  });  // buildHtmlTable.then
  });  // preTranslateRecords.then
}

/**
 * 静默生成 xlsx 文件（不打开预览），供云端上传使用
 * @param {Array} records
 * @param {string} [customFileName]
 * @param {Function} [onProgress]
 * @returns {Promise<string>} 本地文件路径
 */
function generateXlsxFile(records, customFileName, onProgress) {
  return preTranslateRecords(records, onProgress).then(function () {
  return preReadImageBytes(records, onProgress).then(function (preRead) {
    if (preRead.failures.length > 0) {
      var failNames = preRead.failures.map(function (f) { return f.name; }).join(', ');
      throw new Error('图片读取失败 ' + preRead.failures.length + ' 张：' + failNames.slice(0, 60));
    }

    var bytes;
    try {
      var flatRecords = flattenRecords(records);
      var colWidths = calcColumnWidths(records);
      bytes = xlsxWriter.buildXlsx(flatRecords, COLUMNS, {
        imageBytesMap: preRead.map,
        getImageBytes: null,
        calcRowHeight: calcRowHeight,
        calcImgDisplayH: calcImgDisplayH,
        calcColumnWidths: function () { return colWidths; },
        imgColW: IMG_CELL_W
      });
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }

    var baseName = customFileName ? sanitizeFileName(customFileName) : ('export_' + Date.now());
    var fileName = baseName + '.xlsx';
    var filePath = wx.env.USER_DATA_PATH + '/' + fileName;

    return new Promise(function (resolve, reject) {
      wx.getFileSystemManager().writeFile({
        filePath: filePath,
        data: bytes.buffer,
        encoding: 'binary',
        success: function () {
          console.log('[Exporter] xlsx 文件已生成（静默）:', filePath, '大小:', bytes.length, 'bytes');
          resolve(filePath);
        },
        fail: function (err) { reject(new Error('写入 xlsx 失败: ' + (err && err.errMsg))); }
      });
    });
  });
  });
}

module.exports = {
  exportToExcel: exportToExcel,
  exportToXlsx: exportToXlsx,
  exportToLegacyXls: exportToLegacyXls,
  generateXlsxFile: generateXlsxFile,
  sanitizeFileName: sanitizeFileName,
  COLUMNS: COLUMNS,
  buildHtmlTable: buildHtmlTable
};
