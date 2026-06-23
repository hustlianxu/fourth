// utils/exporter.js
// 导出记录为 Excel（HTML 格式，VML 嵌入未压缩原图）

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

var IMG_W = 200;
var IMG_H = 160;
var ROW_H = 180;

/**
 * 读取图片文件为 base64（不压缩）
 */
function readFileAsBase64(filePath) {
  return new Promise(function (resolve) {
    wx.getFileSystemManager().readFile({
      filePath: filePath,
      encoding: 'base64',
      success: function (res) {
        resolve(res.data);
      },
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

async function buildHtmlTable(records) {
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

  // 表头
  html += '<tr height="24">';
  COLUMNS.forEach(function (c) { html += '<th>' + c.header + '</th>'; });
  html += '</tr>';

  // 数据行
  for (var ri = 0; ri < records.length; ri++) {
    var rec = records[ri];
    html += '<tr height="' + ROW_H + '">';
    for (var ci = 0; ci < COLUMNS.length; ci++) {
      var col = COLUMNS[ci];
      if (col.isImage) {
        var imgHtml = '';
        if (rec.imagePath) {
          var b64 = await readFileAsBase64(rec.imagePath);
          if (b64) {
            // VML 嵌入（Office/WPS）+ img 降级（其他）
            imgHtml = '<!--[if gte vml 1]>'
              + '<v:shape style="width:' + IMG_W + 'px;height:' + IMG_H + 'px;'
              + 'position:absolute;mso-position-horizontal:center;mso-position-vertical:middle;"'
              + ' filled="t" stroked="f" coordsize="' + IMG_W + ',' + IMG_H + '">'
              + '<v:imagedata src="data:image/jpeg;base64,' + b64 + '" o:title="FOTO"/>'
              + '</v:shape>'
              + '<![endif]-->'
              + '<img src="data:image/jpeg;base64,' + b64 + '" '
              + 'width="' + IMG_W + '" height="' + IMG_H + '" />';
          } else {
            imgHtml = '图片读取失败';
          }
        }
        html += '<td style="width:' + IMG_W + 'px;text-align:center;">' + imgHtml + '</td>';
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
