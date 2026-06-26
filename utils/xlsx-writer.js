// utils/xlsx-writer.js
// 生成真实 .xlsx（OOXML 格式），图片以原始字节嵌入（不压缩）
// 失败会抛异常，调用方应回退到伪 xls（HTML 格式）
//
// 对外 API：
//   var bytes = buildXlsx(records, columns, { getImageBytes, calcRowHeight, calcImgDisplayH });
//   bytes: Uint8Array（可直接写入 .xlsx 文件）

var ZipWriter = require('./zip.js').ZipWriter;

// XML 转义
function xmlEscape(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// 列号转 Excel 列字母（0→A, 1→B, ... 25→Z, 26→AA）
function colLetter(idx) {
  var s = '';
  var n = idx;
  while (true) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return s;
}

// 图片单元格的列索引（固定第 0 列 = A 列）
var IMG_COL = 0;

/**
 * 构建 .xlsx 字节流
 * @param {Array} records - 记录数组
 * @param {Array} columns - 列定义 [{key, header, isImage}]
 * @param {Object} helpers - 辅助函数
 *   - getImageBytes(imagePath) → Uint8Array（读原始字节，不转 base64）
 *   - calcRowHeight(record) → 行高（px）
 *   - calcImgDisplayH(record) → 图片显示高度（px）
 *   - translate(text, from, to) → 翻译结果字符串（可选）
 * @returns {Uint8Array} .xlsx 字节流
 */
function buildXlsx(records, columns, helpers) {
  helpers = helpers || {};
  var imageBytesMap = helpers.imageBytesMap;   // 优先：预读字节 map {recordIdx: Uint8Array}
  var getImageBytes = helpers.getImageBytes;   // 兜底：同步读取函数（已不推荐）
  var calcRowHeight = helpers.calcRowHeight || function () { return 60; };
  var calcImgDisplayH = helpers.calcImgDisplayH || function () { return 200; };

  if (!imageBytesMap && !getImageBytes) throw new Error('imageBytesMap or getImageBytes is required');

  // 收集所有图片字节（提前读取，便于失败时整体回退）
  var imageEntries = []; // {rId, path, bytes, ext}
  var imageBytesCache = {};
  var imgIdx = 0;
  for (var i = 0; i < records.length; i++) {
    var rec = records[i];
    if (!rec.imagePath) continue;
    // 优先用预读字节，兜底同步读取
    var bytes = imageBytesMap ? imageBytesMap[i] : null;
    if ((!bytes || !bytes.length) && getImageBytes) {
      bytes = getImageBytes(rec.imagePath);
    }
    if (!bytes || !bytes.length) continue;
    imgIdx++;
    var ext = 'jpeg';
    imageEntries.push({
      rId: 'rId' + imgIdx,
      path: rec.imagePath,
      bytes: bytes,
      ext: ext,
      idx: imgIdx,
      recordIdx: i
    });
    imageBytesCache[i] = imgIdx;
  }

  var zip = new ZipWriter();

  // ===== 1. [Content_Types].xml =====
  var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Default Extension="jpeg" ContentType="image/jpeg"/>'
    + '<Default Extension="jpg" ContentType="image/jpeg"/>'
    + '<Default Extension="png" ContentType="image/png"/>'
    + '<Default Extension="gif" ContentType="image/gif"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
    + '</Types>';
  zip.addFile('[Content_Types].xml', contentTypes);

  // ===== 2. _rels/.rels =====
  var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>';
  zip.addFile('_rels/.rels', rootRels);

  // ===== 3. xl/workbook.xml =====
  var workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>'
    + '</workbook>';
  zip.addFile('xl/workbook.xml', workbook);

  // ===== 4. xl/_rels/workbook.xml.rels =====
  var wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>'
    + '</Relationships>';
  zip.addFile('xl/_rels/workbook.xml.rels', wbRels);

  // ===== 5. xl/styles.xml（定义文本格式样式，防科学计数）=====
  var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="1"><numFmt numFmtId="164" formatCode="@"/></numFmts>'
    + '<fonts count="2">'
    + '<font><sz val="11"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
    + '</fonts>'
    + '<fills count="3">'
    + '<fill><patternFill patternType="none"/></fill>'
    + '<fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FF4472C4"/><bgColor indexed="64"/></patternFill></fill>'
    + '</fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="3">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="0"/>'
    // 样式 1：文本格式（防科学计数）+ 普通字体
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1">'
    + '<alignment vertical="center" wrapText="1"/>'
    + '</xf>'
    // 样式 2：表头（加粗白字 + 蓝底）
    + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">'
    + '<alignment horizontal="center" vertical="center"/>'
    + '</xf>'
    + '</cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>';
  zip.addFile('xl/styles.xml', styles);

  // ===== 6. xl/worksheets/sheet1.xml =====
  // 行高：Excel 用磅，1px ≈ 0.75pt
  function pxToRowHeight(px) { return Math.round(px * 0.75); }

  var sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    + 'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">';

  // 列宽（Excel 列宽单位 ≈ 字符数，1 字符约 7px）
  var colWidths = helpers.calcColumnWidths ? helpers.calcColumnWidths(records) : columns.map(function () { return 80; });
  sheetXml += '<cols>';
  for (var i = 0; i < columns.length; i++) {
    var w = colWidths[i] || 80;
    // px 转 Excel 列宽单位（约 w / 7）
    var cw = Math.max(8, Math.round(w / 7));
    sheetXml += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + cw + '" customWidth="1"/>';
  }
  sheetXml += '</cols>';

  // 行数据
  sheetXml += '<sheetData>';
  // 表头行
  sheetXml += '<row r="1" ht="' + pxToRowHeight(28) + '" customHeight="1">';
  for (var i = 0; i < columns.length; i++) {
    var cellRef = colLetter(i) + '1';
    sheetXml += '<c r="' + cellRef + '" s="2" t="inlineStr"><is><t>' + xmlEscape(columns[i].header) + '</t></is></c>';
  }
  sheetXml += '</row>';

  // 数据行
  for (var ri = 0; ri < records.length; ri++) {
    var rec = records[ri];
    var rowH = calcRowHeight(rec);
    var rowIdx = ri + 2; // Excel 行从 1 开始，1 是表头
    sheetXml += '<row r="' + rowIdx + '" ht="' + pxToRowHeight(rowH) + '" customHeight="1">';
    for (var ci = 0; ci < columns.length; ci++) {
      var col = columns[ci];
      var cellRef = colLetter(ci) + rowIdx;
      var val = rec[col.key] != null ? rec[col.key] : '';
      // 图片列不写字符串，留空，由 drawing 层覆盖
      if (col.isImage) {
        sheetXml += '<c r="' + cellRef + '" s="1"/>';
      } else {
        sheetXml += '<c r="' + cellRef + '" s="1" t="inlineStr"><is><t xml:space="preserve">' + xmlEscape(val) + '</t></is></c>';
      }
    }
    sheetXml += '</row>';
  }
  sheetXml += '</sheetData>';

  // drawing 关系引用
  if (imageEntries.length > 0) {
    sheetXml += '<drawing r:id="rId3"/>';
  }
  sheetXml += '</worksheet>';
  zip.addFile('xl/worksheets/sheet1.xml', sheetXml);

  // ===== 7. xl/worksheets/_rels/sheet1.xml.rels（图片引用）=====
  if (imageEntries.length > 0) {
    var sheetRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    // drawing 引用
    sheetRels += '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>';
    sheetRels += '</Relationships>';
    zip.addFile('xl/worksheets/_rels/sheet1.xml.rels', sheetRels);
  }

  // ===== 8. xl/drawings/drawing1.xml（图片定位）=====
  if (imageEntries.length > 0) {
    // EMU 单位：1px = 9525 EMU
    var EMU_PER_PX = 9525;
    var imgColW = helpers.imgColW || 220; // 图片列宽 px
    var drawingXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" '
      + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';

    for (var i = 0; i < imageEntries.length; i++) {
      var ie = imageEntries[i];
      var rec = records[ie.recordIdx];
      var imgH = calcImgDisplayH(rec);
      var rowIdx = ie.recordIdx + 2; // 数据行从 2 开始
      // twoCellAnchor：图片锚定到「图片单元格」范围内
      //   from = A{rowIdx} 单元格左上角（col=IMG_COL, row=rowIdx-1, 偏移0）
      //   to   = B{rowIdx+1} 单元格左上角（col=IMG_COL+1, row=rowIdx, 偏移0）
      //   即图片完整填充该图片列单元格，视觉上"内嵌"在单元格里
      //   editAs="oneCell"：随单元格移动但不随行列缩放变形
      var fromCol = IMG_COL;
      var fromRow = rowIdx - 1; // 0-based 行索引
      var toCol = IMG_COL + 1;
      var toRow = rowIdx;       // 下一行的起点

      drawingXml += '<xdr:twoCellAnchor editAs="oneCell">';
      drawingXml += '<xdr:from><xdr:col>' + fromCol + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + fromRow + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>';
      drawingXml += '<xdr:to><xdr:col>' + toCol + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + toRow + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>';
      drawingXml += '<xdr:pic>';
      drawingXml += '<xdr:nvPicPr><xdr:cNvPr id="' + (i + 1) + '" name="图片' + (i + 1) + '"/><xdr:cNvPicPr/></xdr:nvPicPr>';
      drawingXml += '<xdr:blipFill><a:blip r:embed="' + ie.rId + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>';
      drawingXml += '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + (imgColW * EMU_PER_PX) + '" cy="' + (imgH * EMU_PER_PX) + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>';
      drawingXml += '</xdr:pic>';
      drawingXml += '<xdr:clientData/>';
      drawingXml += '</xdr:twoCellAnchor>';
    }

    drawingXml += '</xdr:wsDr>';
    zip.addFile('xl/drawings/drawing1.xml', drawingXml);

    // ===== 9. xl/drawings/_rels/drawing1.xml.rels（图片文件引用）=====
    var drawRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    for (var i = 0; i < imageEntries.length; i++) {
      var ie = imageEntries[i];
      drawRels += '<Relationship Id="' + ie.rId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image' + ie.idx + '.' + ie.ext + '"/>';
    }
    drawRels += '</Relationships>';
    zip.addFile('xl/drawings/_rels/drawing1.xml.rels', drawRels);

    // ===== 10. xl/media/imageN.{ext}（原始字节，不压缩）=====
    for (var i = 0; i < imageEntries.length; i++) {
      var ie = imageEntries[i];
      zip.addFile('xl/media/image' + ie.idx + '.' + ie.ext, ie.bytes);
    }
  }

  return zip.end();
}

module.exports = {
  buildXlsx: buildXlsx,
  xmlEscape: xmlEscape,
  colLetter: colLetter
};
