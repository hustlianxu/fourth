// cloudfunctions/generateXlsx/index.js
// 云端生成 .xlsx 导出文件（绕过本地存储配额限制）
// 客户端上传记录数据 + 图片 fileID，云函数下载图片、生成 xlsx、上传到云存储
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const xlsx = require('./xlsx-writer.js');

// 列定义（与 utils/exporter.js 一致）
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

var IMG_CELL_W = 220;
var MIN_ROW_H = 60;
var ROW_PAD = 16;
var CHAR_W = 9;
var MIN_COL_W = 60;
var IMG_BATCH = 5; // 每批并行下载 5 张图片

/**
 * 计算列宽
 */
function calcColumnWidths(records, columns) {
  var widths = {};
  columns.forEach(function (col) {
    if (col.isImage) { widths[col.key] = IMG_CELL_W; return; }
    var maxW = col.header.length * CHAR_W;
    records.forEach(function (r) {
      var v = r[col.key] != null ? String(r[col.key]) : '';
      maxW = Math.max(maxW, v.length * CHAR_W);
    });
    widths[col.key] = Math.max(MIN_COL_W, maxW + 16);
  });
  return widths;
}

/**
 * 计算行高
 */
function calcRowHeight(rec) {
  if (rec.width && rec.height && rec.imagePath) {
    return Math.max(MIN_ROW_H, Math.round(rec.height / rec.width * IMG_CELL_W)) + ROW_PAD;
  }
  return MIN_ROW_H + ROW_PAD;
}

/**
 * 计算图片显示高度
 */
function calcImgDisplayH(rec) {
  if (rec.width && rec.height) {
    return Math.round(rec.height / rec.width * IMG_CELL_W);
  }
  return 200;
}

/**
 * 从云存储下载图片，分批并行
 */
async function downloadImages(records) {
  var imageBytesMap = {};
  var failures = [];

  for (var start = 0; start < records.length; start += IMG_BATCH) {
    var end = Math.min(start + IMG_BATCH, records.length);
    var tasks = [];
    for (var i = start; i < end; i++) {
      var rec = records[i];
      if (!rec.imageFileID) continue;
      tasks.push(
        (function (idx, fileID) {
          return cloud.downloadFile({ fileID: fileID })
            .then(function (res) {
              if (res.fileContent && res.fileContent.length > 0) {
                // Buffer → Uint8Array（xlsx-writer 所需格式）
                imageBytesMap[idx] = new Uint8Array(res.fileContent);
              } else {
                failures.push(idx);
              }
            })
            .catch(function (err) {
              console.warn('[generateXlsx] 图片下载失败:', idx, fileID, err.message);
              failures.push(idx);
            });
        })(i, rec.imageFileID)
      );
    }
    await Promise.all(tasks);
  }

  return { map: imageBytesMap, failures: failures };
}

/**
 * 生成 xlsx 并上传到云存储
 */
exports.main = async function (event, context) {
  var records = event.records;
  var fileName = event.fileName || ('export_' + Date.now() + '.xlsx');
  var openid = event.openid || 'unknown';

  if (!records || !records.length) {
    return { success: false, error: '缺少记录数据' };
  }

  try {
    // 1. 下载图片
    var imgResult = await downloadImages(records);

    // 2. 构建 flatRecords（与 exporter.js flattenRecords 一致）
    var flatRecords = records.map(function (rec) {
      var flat = {
        imagePath: rec.imageFileID || '',
        width: rec.width || 0,
        height: rec.height || 0
      };
      COLUMNS.forEach(function (col) {
        if (!col.isImage) {
          flat[col.key] = rec[col.key] != null ? rec[col.key] : '';
        }
      });
      return flat;
    });

    // 3. 计算列宽
    var colWidths = calcColumnWidths(flatRecords, COLUMNS);

    // 4. 构建 xlsx（使用预下载的图片字节）
    var xlsxBytes;
    try {
      xlsxBytes = xlsx.buildXlsx(flatRecords, COLUMNS, {
        imageBytesMap: imgResult.map,
        getImageBytes: null,
        calcRowHeight: calcRowHeight,
        calcImgDisplayH: calcImgDisplayH,
        calcColumnWidths: function () { return colWidths; },
        imgColW: IMG_CELL_W
      });
    } catch (buildErr) {
      console.error('[generateXlsx] 构建 xlsx 失败:', buildErr);
      return { success: false, error: '生成 xlsx 失败: ' + buildErr.message };
    }

    // 5. 上传 xlsx 到云存储
    var cloudPath = 'exports/' + openid + '/' + Date.now() + '_' + fileName;
    var uploadRes;
    try {
      uploadRes = await cloud.uploadFile({
        cloudPath: cloudPath,
        fileContent: Buffer.from(xlsxBytes.buffer, xlsxBytes.byteOffset, xlsxBytes.byteLength)
      });
    } catch (uploadErr) {
      console.error('[generateXlsx] 上传 xlsx 失败:', uploadErr);
      return { success: false, error: '上传 xlsx 失败: ' + uploadErr.message };
    }

    console.log('[generateXlsx] 成功生成 xlsx:', cloudPath, '大小:', xlsxBytes.length, 'bytes');

    return {
      success: true,
      fileID: uploadRes.fileID,
      fileName: fileName  // 返回原始文件名（无时间戳前缀）
    };
  } catch (e) {
    console.error('[generateXlsx] 未知错误:', e);
    return { success: false, error: e.message };
  }
};
