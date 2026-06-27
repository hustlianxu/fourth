// utils/cloud.js
// 云开发工具模块（初始版本 v1，后续按计划扩展）

var CLOUD_ENV = 'cloud1-d9g0g4pm6b7648e8d';

/**
 * 初始化云环境
 */
function init() {
  try {
    wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
    return true;
  } catch (e) {
    console.warn('[Cloud] 初始化失败:', e);
    return false;
  }
}

/**
 * 获取当前用户 openid
 * @returns {Promise<string|null>} openid 或 null
 */
function getOpenid() {
  return wx.cloud.callFunction({
    name: 'getOpenid'
  }).then(function (res) {
    return res.result && res.result.openid;
  }).catch(function (err) {
    console.warn('[Cloud] 获取 openid 失败:', err);
    return null;
  });
}

module.exports = {
  CLOUD_ENV: CLOUD_ENV,
  init: init,
  getOpenid: getOpenid
};
