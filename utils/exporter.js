// utils/exporter.js
// 导出记录为 Excel（HTML 格式，VML 嵌入原图，行高按图片比例自适应，列宽自适应内容）

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

async function buildHtmlTable(records) {
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

function exportToExcel(records) {
  if (!records || records.length === 0) throw new Error('没有选中任何记录');

  console.log('[Exporter] 导出记录数:', records.length);

  return buildHtmlTable(records).then(function (html) {
    var fileName = 'export_' + Date.now() + '.xls';
    var filePath = wx.env.USER_DATA_PATH + '/' + fileName;

    return new Promise(function (resolve, reject) {
      wx.getFileSystemManager().writeFile({
        filePath: filePath, data: html, encoding: 'utf8',
        success: function () {
          console.log('[Exporter] 写入完成:', filePath);
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

module.exports = { exportToExcel: exportToExcel, COLUMNS: COLUMNS };
