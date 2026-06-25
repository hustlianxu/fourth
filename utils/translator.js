// utils/translator.js
// 中-西翻译引擎：本地词库优先匹配 + LLM API 兜底
//
// 翻译策略：
//   1. 文本按分隔符（空格/·/×/+/逗号/句号）切分为段
//   2. 每段查本地词库（内置 + 用户自定义）：先长后短匹配
//   3. 命中白名单（数字、单位、通用符号）直接保留
//   4. 剩余未命中段累积后，调用 LLM API 批量翻译
//   5. 若未配置 API 或 API 失败，未命中段保留原文
//
// API：兼容 OpenAI 协议（DeepSeek/智谱 GLM/通义千问等均可）

var builtin = require('./builtinDict.js');

// ============ 用户词典 & API 配置 存取 ============

var STORAGE_DICT_KEY = 'watermark_custom_dict';
var STORAGE_WHITELIST_KEY = 'watermark_custom_whitelist';
var STORAGE_CONFIG_KEY = 'watermark_translator_config';
var STORAGE_PROMPT_KEY = 'watermark_translator_prompt';

// 默认 prompt 模板，使用 {whitelist} 占位符在调用时注入当前白名单
var DEFAULT_PROMPT_TEMPLATE =
  '你是一名外贸翻译助手，请将以下{source}翻译为{target}。\n' +
  '要求：\n' +
  '1. 保留原文中的数字、货号、通用符号（如 × · + / , .）不翻译；\n' +
  '2. 以下词汇为通用单位或国际通用词，必须原样保留不要翻译：{whitelist}\n' +
  '3. 除此之外的所有自然语言（包括常见西班牙语名词如 luz/灯、música/音乐、estrellas/星星 等）都必须翻译；\n' +
  '4. 直接返回翻译结果，不要解释，不要加引号，不要添加多余内容。\n\n' +
  '原文：{text}';

function getUserDict() {
  try {
    var d = wx.getStorageSync(STORAGE_DICT_KEY);
    return Array.isArray(d) ? d : [];
  } catch (e) { return []; }
}

function setUserDict(dict) {
  wx.setStorageSync(STORAGE_DICT_KEY, dict || []);
}

// 用户自定义白名单（与内置白名单合并使用）
function getUserWhitelist() {
  try {
    var w = wx.getStorageSync(STORAGE_WHITELIST_KEY);
    return Array.isArray(w) ? w : [];
  } catch (e) { return []; }
}

function setUserWhitelist(list) {
  wx.setStorageSync(STORAGE_WHITELIST_KEY, list || []);
}

// 合并后的白名单（内置 + 用户自定义）
function getMergedWhitelist() {
  return builtin.WHITELIST.concat(getUserWhitelist());
}

function getConfig() {
  try {
    var c = wx.getStorageSync(STORAGE_CONFIG_KEY);
    return c && typeof c === 'object' ? c : null;
  } catch (e) { return null; }
}

function setConfig(cfg) {
  wx.setStorageSync(STORAGE_CONFIG_KEY, cfg || null);
}

// 自定义 prompt（录入一次后永久生效，未录入则用 DEFAULT_PROMPT_TEMPLATE）
function getCustomPrompt() {
  try {
    var p = wx.getStorageSync(STORAGE_PROMPT_KEY);
    return (typeof p === 'string' && p.trim()) ? p : null;
  } catch (e) { return null; }
}

function setCustomPrompt(prompt) {
  wx.setStorageSync(STORAGE_PROMPT_KEY, prompt || '');
}

function getDefaultPromptTemplate() {
  return DEFAULT_PROMPT_TEMPLATE;
}

// ============ 本地匹配 ============

// 构建双向查询索引（每次调用时合并内置+用户词）
function buildIndex() {
  var all = builtin.BUILTIN_DICT.concat(getUserDict());
  // 按源词长度降序排序，便于先长后短匹配
  var esToZh = all.slice().sort(function (a, b) {
    return b.es.length - a.es.length;
  });
  var zhToEs = all.slice().sort(function (a, b) {
    return b.zh.length - a.zh.length;
  });
  return { esToZh: esToZh, zhToEs: zhToEs };
}

// 判断是否白名单（数字、单位、纯符号、内置+用户白名单）
function isWhitelist(token) {
  if (!token) return false;
  // 纯数字（含小数）
  if (/^\d+(\.\d+)?$/.test(token)) return true;
  // 数字 + 单位（如 50kg, 0.125m³, 48pzs）
  if (/^\d+(\.\d+)?[a-zA-Z²³¹º]+$/.test(token)) return true;
  // 货币符号 + 数字
  if (/^[¥$€]\d+/.test(token)) return true;
  // 精确匹配白名单（内置 + 用户自定义）
  var lower = token.toLowerCase();
  var merged = getMergedWhitelist();
  for (var i = 0; i < merged.length; i++) {
    var w = merged[i];
    if (w === token || w.toLowerCase() === lower) return true;
  }
  return false;
}

// 按分隔符切分文本，保留分隔符
// 分隔符：空格、·、×、+、-、/、,、，、.、。
function splitText(text) {
  if (!text) return [];
  // 用正则切分，保留分隔符
  var parts = text.split(/(\s+|[·×+\-\/,，.。:;：；])/g);
  return parts.filter(function (p) { return p !== ''; });
}

// 本地翻译一段文本（整段匹配，不切分）
// 返回 { translated: bool, result: string }
function localTranslateSegment(text, from, to, index) {
  if (!text) return { translated: true, result: '' };
  if (isWhitelist(text)) return { translated: true, result: text };

  // 整段精确匹配
  var list = from === 'es' ? index.esToZh : index.zhToEs;
  var srcKey = from === 'es' ? 'es' : 'zh';
  var dstKey = from === 'es' ? 'zh' : 'es';
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (item[srcKey] === text) {
      return { translated: true, result: item[dstKey] };
    }
  }

  // 模糊匹配：文本中包含词典中的某个词
  var result = text;
  var matched = false;
  for (var j = 0; j < list.length; j++) {
    var entry = list[j];
    var src = entry[srcKey];
    if (src && result.indexOf(src) >= 0) {
      result = result.split(src).join(entry[dstKey]);
      matched = true;
    }
  }
  if (matched) return { translated: true, result: result };

  return { translated: false, result: text };
}

// ============ LLM API 调用 ============

// 构建最终 prompt（自定义优先，否则用默认模板并注入当前白名单）
// 支持占位符：{source} {target} {whitelist} {text}
function buildPrompt(text, from, to) {
  var targetName = to === 'zh' ? '中文' : '西班牙语';
  var sourceName = from === 'zh' ? '中文' : '西班牙语';
  // 白名单拼接为逗号分隔字符串
  var whitelistStr = getMergedWhitelist().join(', ');

  var template = getCustomPrompt() || DEFAULT_PROMPT_TEMPLATE;
  var prompt = template
    .replace(/\{source\}/g, sourceName)
    .replace(/\{target\}/g, targetName)
    .replace(/\{whitelist\}/g, whitelistStr)
    .replace(/\{text\}/g, text);
  return prompt;
}

function callLLM(text, from, to) {
  var cfg = getConfig();
  if (!cfg || !cfg.apiKey || !cfg.baseURL) {
    return Promise.resolve(null);
  }

  var prompt = buildPrompt(text, from, to);

  var model = cfg.model || 'deepseek-chat';
  var data = {
    model: model,
    messages: [
      { role: 'user', content: prompt }
    ],
    temperature: 0.3,
    max_tokens: 1024
  };

  return new Promise(function (resolve) {
    wx.request({
      url: cfg.baseURL.replace(/\/$/, '') + '/chat/completions',
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey
      },
      data: data,
      timeout: 30000,
      success: function (res) {
        if (res.statusCode === 200 && res.data && res.data.choices && res.data.choices[0]) {
          var content = res.data.choices[0].message.content;
          // 去掉可能的引号
          content = String(content || '').replace(/^["'「『]+|["'」』]+$/g, '').trim();
          resolve(content || null);
        } else {
          console.warn('[Translator] API 返回异常:', res.statusCode, res.data);
          resolve(null);
        }
      },
      fail: function (err) {
        console.warn('[Translator] API 调用失败:', err);
        resolve(null);
      }
    });
  });
}

// ============ 主翻译函数 ============

/**
 * 翻译文本
 * @param {string} text 待翻译文本
 * @param {string} from 'zh' | 'es'
 * @param {string} to   'es' | 'zh'
 * @returns {Promise<string>} 翻译结果
 */
function translate(text, from, to) {
  if (!text || !text.trim()) return Promise.resolve('');

  var index = buildIndex();
  var segments = splitText(text);

  // 第一遍：本地匹配，收集未命中段
  var localResult = segments.map(function (seg) {
    var r = localTranslateSegment(seg, from, to, index);
    return { seg: seg, translated: r.translated, result: r.result };
  });

  // 收集未命中且非分隔符/白名单的段
  var missSegments = localResult.filter(function (item) {
    if (item.translated) return false;
    // 跳过纯空白、纯分隔符
    if (/^[\s·×+\-\/,，.。:;：；]*$/.test(item.seg)) return false;
    return true;
  });

  // 全部本地命中 → 直接组装返回
  if (missSegments.length === 0) {
    return Promise.resolve(localResult.map(function (i) { return i.result; }).join(''));
  }

  // 有未命中段 → 调用 LLM API 翻译整段原文（保证上下文连贯）
  return callLLM(text, from, to).then(function (apiResult) {
    if (apiResult) return apiResult;
    // API 失败 → 用本地结果（未命中段保留原文）
    return localResult.map(function (i) { return i.result; }).join('');
  });
}

// ============ 模块导出 ============

module.exports = {
  translate: translate,
  getUserDict: getUserDict,
  setUserDict: setUserDict,
  getUserWhitelist: getUserWhitelist,
  setUserWhitelist: setUserWhitelist,
  getMergedWhitelist: getMergedWhitelist,
  getConfig: getConfig,
  setConfig: setConfig,
  getCustomPrompt: getCustomPrompt,
  setCustomPrompt: setCustomPrompt,
  getDefaultPromptTemplate: getDefaultPromptTemplate,
  buildPrompt: buildPrompt,
  isWhitelist: isWhitelist,
  buildIndex: buildIndex,
  localTranslateSegment: localTranslateSegment
};
