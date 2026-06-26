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

/**
 * 同步读取图片文件原始字节（用于 xlsx 嵌入，不压缩）
 */
function readImageBytesSync(filePath) {
  try {
    var res = wx.getFileSystemManager().readFileSync(filePath);
    if (res && res instanceof ArrayBuffer) return new Uint8Array(res);
    if (res && res.data instanceof ArrayBuffer) return new Uint8Array(res.data);
    return null;
  } catch (e) {
    console.warn('[Exporter] 读取图片字节失败:', filePath, e);
    return null;
  }
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

  // 数据行
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
          var b64 = await readFileAsBase64(rec.imagePath);
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
 */
function preTranslateRecords(records, onProgress) {
  var tasks = [];
  var _async = translator;
  // 串行处理每条记录的翻译
  var chain = Promise.resolve();
  records.forEach(function (rec, i) {
    chain = chain.then(function () {
      if (!rec.values) rec.values = {};
      var desEs = rec.values.desEs || '';
      var desZh = rec.values.desZh || '';
      if (desEs.trim() && !desZh.trim()) {
        if (onProgress) onProgress('翻译中 ' + (i + 1) + '/' + records.length + ' (ES→ZH)');
        return translator.translate(desEs, 'es', 'zh', true).then(function (r1) {
          console.log('[Exporter] ES→ZH 行' + (i + 1), r1.debug, '原文:', desEs, '译文:', r1.result);
          if (r1.result) rec.values.desZh = r1.result;
        });
      } else if (desZh.trim() && !desEs.trim()) {
        if (onProgress) onProgress('翻译中 ' + (i + 1) + '/' + records.length + ' (ZH→ES)');
        return translator.translate(desZh, 'zh', 'es', true).then(function (r2) {
          console.log('[Exporter] ZH→ES 行' + (i + 1), r2.debug, '原文:', desZh, '译文:', r2.result);
          if (r2.result) rec.values.desEs = r2.result;
        });
      }
      return null;
    });
  });
  return chain;
}

/**
 * 主路径：真实 .xlsx（OOXML，图片原始字节不压缩）
 */
function exportToXlsx(records, customFileName) {
  return new Promise(function (resolve, reject) {
    try {
      var flatRecords = flattenRecords(records);
      var colWidths = calcColumnWidths(records);
      var bytes = xlsxWriter.buildXlsx(flatRecords, COLUMNS, {
        getImageBytes: readImageBytesSync,
        calcRowHeight: calcRowHeight,
        calcImgDisplayH: calcImgDisplayH,
        calcColumnWidths: function () { return colWidths; },
        imgColW: IMG_CELL_W
      });

      var baseName = customFileName ? sanitizeFileName(customFileName) : ('export_' + Date.now());
      var fileName = baseName + '.xlsx';
      var filePath = wx.env.USER_DATA_PATH + '/' + fileName;

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
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * 回退路径：伪 .xls（HTML + VML，base64 图片）
 */
function exportToLegacyXls(records, customFileName) {
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
  });
}

module.exports = {
  exportToExcel: exportToExcel,
  sanitizeFileName: sanitizeFileName,
  COLUMNS: COLUMNS,
  buildHtmlTable: buildHtmlTable
};
