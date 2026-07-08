// utils/ocr.js
// OCR 识别工具：基于微信图片内容安全/第三方接口的占位实现
// 为保证“数据准确可识别”，水印渲染后会调用此接口（可选）识别关键字段并与用户填写数据做比对
//
// 使用方式（两种可选）：
// 1) 微信云开发 + 腾讯云 OCR：把 imagePath 上传到云存储后在云函数调用 TencentCloud OCR
// 2) 自有后端：把图片 POST 到 {BASE_URL}/ocr 后返回识别结果 JSON
//
// 默认使用云函数调用占位（如未开通云开发，会走 mock 识别并在结果中标记 mock）

function recognize(imagePath, options) {
  options = options || {};
  return new Promise((resolve, reject) => {
    if (wx.cloud && options.useCloud !== false) {
      // 路径1：云函数
      wx.cloud.callFunction({
        name: 'ocrRecognize',
        data: { fileID: imagePath, filePath: imagePath },
        success: (res) => {
          const result = (res && res.result) || {};
          if (result.success === false) {
            reject(new Error(result.errMsg || '云函数识别失败'));
          } else {
            resolve(result);
          }
        },
        fail: (err) => {
          // 云函数调用失败时降级为本地 mock，方便本地调试
          resolve(mockRecognize(imagePath));
        }
      });
    } else {
      // 路径2：本地 mock
      resolve(mockRecognize(imagePath));
    }
  });
}

function mockRecognize(imagePath) {
  // Mock：不做真实识别，返回占位结果与提示，供前端展示用
  return {
    mock: true,
    text: '',
    fields: {},
    hint: '当前为本地模式，未对接真实 OCR 接口。建议在云开发中部署 ocrRecognize 云函数（接入腾讯云 OCR / 百度 OCR）。'
  };
}

/**
 * 对用户填写值与 OCR 识别文本做一次简单比对
 * @param {Object} values - 用户填写 { key: value }
 * @param {Object} ocrResult - OCR 返回 { text, fields }
 */
function verify(values, ocrResult) {
  const issues = [];
  if (!ocrResult || (ocrResult.mock && !ocrResult.text)) {
    issues.push({ level: 'warn', message: '未进行 OCR 核验，请确认已部署识别云函数' });
    return issues;
  }
  const text = (ocrResult.text || '').replace(/\s+/g, '');
  Object.keys(values || {}).forEach((k) => {
    const v = String(values[k] || '').trim();
    if (!v) return;
    if (text.indexOf(v) === -1) {
      issues.push({ level: 'info', key: k, expected: v, message: '字段 "' + k + '" 值未在识别文本中出现' });
    }
  });
  return issues;
}

module.exports = {
  recognize,
  verify
};
