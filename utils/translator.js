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
var STORAGE_APIKEYS_KEY = 'watermark_translator_apikeys';       // 旧版：仅按 provider 存 apiKey（兼容迁移用）
var STORAGE_PROFILES_KEY = 'watermark_translator_profiles';     // 新版：按 provider 存 {baseURL, model, apiKey}
var STORAGE_PROMPT_KEY = 'watermark_translator_prompt';

// 默认 prompt 模板，使用 {source} {target} {whitelist} {text} 占位符
// 不假定固定方向（既可能中→西，也可能西→中）
var DEFAULT_PROMPT_TEMPLATE =
  '请将以下文本从{source}翻译为{target}。\n' +
  '规则：\n' +
  '1. 数字、货号、通用符号（× · + / , . 等）保持不变；\n' +
  '2. 以下词汇保持原文不翻译：{whitelist}\n' +
  '3. 直接返回翻译结果，不要解释，不要加引号，不要添加任何多余内容。\n\n' +
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

// 获取当前配置：{ provider, baseURL, model, apiKey }
// baseURL/model/apiKey 全部按 provider 独立存储，切换 provider 自动加载对应配置
function getConfig() {
  try {
    var c = wx.getStorageSync(STORAGE_CONFIG_KEY);
    if (!c || typeof c !== 'object') return null;
    var provider = c.provider || 'deepseek';
    return {
      provider: provider,
      baseURL: getBaseURL(provider),
      model: getModel(provider),
      apiKey: getApiKey(provider)
    };
  } catch (e) { return null; }
}

// 保存配置
// - provider 存到 STORAGE_CONFIG_KEY（记录当前选中）
// - baseURL/model/apiKey 按 provider 独立存到 STORAGE_PROFILES_KEY
function setConfig(cfg) {
  cfg = cfg || {};
  var provider = cfg.provider || 'deepseek';
  // 主配置只存当前选中的 provider
  wx.setStorageSync(STORAGE_CONFIG_KEY, { provider: provider });
  // 按 provider 存 baseURL/model/apiKey
  var profiles = _readProfiles();
  var p = profiles[provider] || {};
  if (cfg.baseURL !== undefined && cfg.baseURL !== null) p.baseURL = cfg.baseURL || '';
  if (cfg.model !== undefined && cfg.model !== null) p.model = cfg.model || '';
  if (cfg.apiKey !== undefined && cfg.apiKey !== null) p.apiKey = cfg.apiKey || '';
  profiles[provider] = p;
  wx.setStorageSync(STORAGE_PROFILES_KEY, profiles);
}

// 读取所有 provider 的配置档案
function _readProfiles() {
  try {
    var p = wx.getStorageSync(STORAGE_PROFILES_KEY);
    if (p && typeof p === 'object') return p;
  } catch (e) {}
  return {};
}

function _writeProfile(provider, field, value) {
  var profiles = _readProfiles();
  var p = profiles[provider] || {};
  p[field] = value || '';
  profiles[provider] = p;
  wx.setStorageSync(STORAGE_PROFILES_KEY, profiles);
}

function _readProfile(provider, field) {
  var profiles = _readProfiles();
  var p = profiles[provider] || {};
  return p[field] || '';
}

// 获取/设置指定 provider 的 baseURL
function getBaseURL(provider) { return _readProfile(provider, 'baseURL'); }
function setBaseURL(provider, url) { _writeProfile(provider, 'baseURL', url); }

// 获取/设置指定 provider 的 model
function getModel(provider) { return _readProfile(provider, 'model'); }
function setModel(provider, model) { _writeProfile(provider, 'model', model); }

// 获取/设置指定 provider 的 apiKey
function getApiKey(provider) { return _readProfile(provider, 'apiKey'); }
function setApiKey(provider, apiKey) { _writeProfile(provider, 'apiKey', apiKey); }

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

// 检测文本主要语言：返回 'zh' | 'es' | 'unknown'
// 中文：含 CJK 统一汉字（U+4E00-U+9FFF）即判定为中文
// 否则：含拉丁字母则判定为西语（es）
// 纯数字/符号：unknown
function detectLang(text) {
  if (!text) return 'unknown';
  var s = String(text);
  var hasCJK = false;
  var hasLatin = false;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    // CJK 统一汉字 + 扩展A区 + 兼容汉字
    if ((c >= 0x4E00 && c <= 0x9FFF) ||
        (c >= 0x3400 && c <= 0x4DBF) ||
        (c >= 0xF900 && c <= 0xFAFF)) {
      hasCJK = true;
    } else if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) {
      // 基本拉丁字母
      hasLatin = true;
    }
  }
  if (hasCJK) return 'zh';
  if (hasLatin) return 'es';
  return 'unknown';
}

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
 * 翻译文本（带诊断信息）
 * @param {string} text 待翻译文本
 * @param {string} from 'zh' | 'es'
 * @param {string} to   'es' | 'zh'
 * @param {boolean} withDebug 是否返回诊断信息
 * @returns {Promise<string|{result:string, debug:object}>} 翻译结果
 */
function translate(text, from, to, withDebug) {
  if (!text || !text.trim()) return Promise.resolve(withDebug ? { result: '', debug: { source: 'empty' } } : '');

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
    if (/^[\s·×+\-\/,，.。:;：；]*$/.test(item.seg)) return false;
    return true;
  });

  var localJoined = localResult.map(function (i) { return i.result; }).join('');

  // 全部本地命中 → 直接组装返回
  if (missSegments.length === 0) {
    return Promise.resolve(withDebug
      ? { result: localJoined, debug: { source: 'local_all', missCount: 0, missSegments: [] } }
      : localJoined);
  }

  // 有未命中段 → 调用 LLM API 翻译整段原文
  var cfg = getConfig();
  var missWords = missSegments.map(function (m) { return m.seg; });

  if (!cfg || !cfg.apiKey || !cfg.baseURL) {
    // 未配置 API → 用本地结果（未命中段保留原文）
    return Promise.resolve(withDebug
      ? { result: localJoined, debug: { source: 'local_no_api', missCount: missWords.length, missSegments: missWords, reason: '未配置 API' } }
      : localJoined);
  }

  var t0 = Date.now();
  return callLLM(text, from, to).then(function (apiResult) {
    var elapsed = Date.now() - t0;
    if (apiResult) {
      return withDebug
        ? { result: apiResult, debug: { source: 'api', provider: cfg.provider, elapsed: elapsed, missCount: missWords.length, missSegments: missWords } }
        : apiResult;
    }
    // API 失败 → 用本地结果降级
    return withDebug
      ? { result: localJoined, debug: { source: 'local_api_fail', missCount: missWords.length, missSegments: missWords, elapsed: elapsed, reason: 'API 调用失败或返回空' } }
      : localJoined;
  });
}

// ============ 批量翻译（合并多条为单次 API 调用） ============

/**
 * 批量翻译：把多条文本合并为单次 API 调用，大幅减少请求次数与总耗时
 * @param {Array<{text:string, from:string, to:string}>} items 待翻译项
 * @param {boolean} withDebug 是否返回诊断信息
 * @returns {Promise<Array<string|{result:string, debug:object}>>} 与 items 同序的结果数组
 *
 * 策略：
 *   1. 对每条先做本地匹配，收集需调 API 的项（按 from/to 分组）
 *   2. 相同 (from,to) 的项合并为一次 API 调用，用分隔符分隔，要求 LLM 按行返回
 *   3. 本地全命中的项直接返回
 *   4. 未配置 API 或 API 失败 → 用本地结果降级
 */
function translateBatch(items, withDebug) {
  if (!items || items.length === 0) return Promise.resolve([]);

  var index = buildIndex();

  // 第一遍：每条做本地匹配
  var localResults = items.map(function (item) {
    var text = item.text || '';
    var from = item.from;
    var to = item.to;
    if (!text || !text.trim()) {
      return { segs: [], localJoined: '', miss: [], needApi: false, from: from, to: to };
    }
    var segs = splitText(text).map(function (seg) {
      var r = localTranslateSegment(seg, from, to, index);
      return { seg: seg, translated: r.translated, result: r.result };
    });
    var miss = segs.filter(function (s) {
      if (s.translated) return false;
      if (/^[\s·×+\-\/,，.。:;：；]*$/.test(s.seg)) return false;
      return true;
    });
    var localJoined = segs.map(function (i) { return i.result; }).join('');
    return { segs: segs, localJoined: localJoined, miss: miss, needApi: miss.length > 0, from: from, to: to };
  });

  // 收集需调 API 的项索引（按 from→to 分组）
  var groups = {};  // key: "from|to" → [index]
  localResults.forEach(function (lr, idx) {
    if (lr.needApi) {
      var key = lr.from + '|' + lr.to;
      if (!groups[key]) groups[key] = [];
      groups[key].push(idx);
    }
  });

  var cfg = getConfig();
  var noApi = !cfg || !cfg.apiKey || !cfg.baseURL;

  // 每组构造一次批量 API 调用
  var groupPromises = Object.keys(groups).map(function (key) {
    var idxs = groups[key];
    var keyParts = key.split('|');
    var from = keyParts[0];
    var to = keyParts[1];

    // 未配置 API → 全部用本地结果
    if (noApi) {
      return Promise.resolve({ key: key, results: idxs.map(function () { return null; }) });
    }

    // 合并所有待翻译文本，用 "|||WATERMARK|||" 分隔（要求 LLM 按行返回）
    var texts = idxs.map(function (i) { return items[i].text; });
    var merged = texts.join('\n|||WATERMARK|||\n');

    // 构造批量 prompt
    var targetName = to === 'zh' ? '中文' : '西班牙语';
    var sourceName = from === 'zh' ? '中文' : '西班牙语';
    var whitelistStr = getMergedWhitelist().join(', ');
    var batchPrompt =
      '请将以下多条文本从' + sourceName + '翻译为' + targetName + '。\n' +
      '规则：\n' +
      '1. 数字、货号、通用符号（× · + / , . 等）保持不变；\n' +
      '2. 以下词汇保持原文不翻译：' + whitelistStr + '\n' +
      '3. 直接返回翻译结果，每条文本的译文占一行，不要解释，不要加引号，不要添加任何多余内容；\n' +
      '4. 输入的多条文本用 "|||WATERMARK|||" 分隔，输出也请用相同的分隔符分隔对应译文。\n\n' +
      '原文：\n' + merged;

    // 用自定义 prompt（如有）替换，保留占位符逻辑
    var custom = getCustomPrompt();
    if (custom && custom.trim()) {
      batchPrompt = custom
        .replace(/\{source\}/g, sourceName)
        .replace(/\{target\}/g, targetName)
        .replace(/\{whitelist\}/g, whitelistStr)
        .replace(/\{text\}/g, merged);
      // 自定义 prompt 没有分隔符约定，追加批量说明
      if (batchPrompt.indexOf('|||WATERMARK|||') < 0) {
        batchPrompt += '\n\n[批量模式：输入多行用 |||WATERMARK||| 分隔，输出也请用相同分隔符分隔]';
      }
    }

    var model = cfg.model || 'deepseek-chat';
    var t0 = Date.now();
    return new Promise(function (resolve) {
      wx.request({
        url: cfg.baseURL.replace(/\/$/, '') + '/chat/completions',
        method: 'POST',
        header: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + cfg.apiKey
        },
        data: {
          model: model,
          messages: [{ role: 'user', content: batchPrompt }],
          temperature: 0.3,
          max_tokens: 4096
        },
        timeout: 60000,
        success: function (res) {
          var elapsed = Date.now() - t0;
          if (res.statusCode === 200 && res.data && res.data.choices && res.data.choices[0]) {
            var content = res.data.choices[0].message.content;
            content = String(content || '').replace(/^["'「『]+|["'」』]+$/g, '').trim();
            // 按分隔符切分回多条
            var splitParts = content.split(/\|\|\|WATERMARK\|\|\|/).map(function (s) { return s.trim(); });
            resolve({ key: key, results: splitParts, elapsed: elapsed, source: 'api_batch' });
          } else {
            console.warn('[Translator] 批量 API 返回异常:', res.statusCode, res.data);
            resolve({ key: key, results: idxs.map(function () { return null; }), elapsed: elapsed, source: 'api_fail' });
          }
        },
        fail: function (err) {
          var elapsed = Date.now() - t0;
          console.warn('[Translator] 批量 API 调用失败:', err);
          resolve({ key: key, results: idxs.map(function () { return null; }), elapsed: elapsed, source: 'api_fail' });
        }
      });
    });
  });

  return Promise.all(groupPromises).then(function (groupResults) {
    // 按 key 索引结果
    var resultMap = {};
    groupResults.forEach(function (gr) { resultMap[gr.key] = gr; });

    // 组装最终结果（与 items 同序）
    return items.map(function (item, idx) {
      var lr = localResults[idx];
      // 本地全命中
      if (!lr.needApi) {
        return withDebug
          ? { result: lr.localJoined, debug: { source: 'local_all', missCount: 0 } }
          : lr.localJoined;
      }
      var key = item.from + '|' + item.to;
      var gr = resultMap[key];
      // 在该组中的位置
      var posInGroup = groups[key].indexOf(idx);
      var apiResult = gr && gr.results && gr.results[posInGroup];
      if (apiResult) {
        return withDebug
          ? { result: apiResult, debug: { source: gr.source || 'api_batch', provider: cfg.provider, elapsed: gr.elapsed, batchPos: posInGroup, batchSize: groups[key].length } }
          : apiResult;
      }
      // API 失败 → 本地结果降级
      return withDebug
        ? { result: lr.localJoined, debug: { source: 'local_api_fail', reason: 'API 失败或返回空', elapsed: gr && gr.elapsed } }
        : lr.localJoined;
    });
  });
}

// ============ 模块导出 ============

module.exports = {
  translate: translate,
  translateBatch: translateBatch,
  getUserDict: getUserDict,
  setUserDict: setUserDict,
  getUserWhitelist: getUserWhitelist,
  setUserWhitelist: setUserWhitelist,
  getMergedWhitelist: getMergedWhitelist,
  getConfig: getConfig,
  setConfig: setConfig,
  getApiKey: getApiKey,
  setApiKey: setApiKey,
  getBaseURL: getBaseURL,
  setBaseURL: setBaseURL,
  getModel: getModel,
  setModel: setModel,
  getCustomPrompt: getCustomPrompt,
  setCustomPrompt: setCustomPrompt,
  getDefaultPromptTemplate: getDefaultPromptTemplate,
  buildPrompt: buildPrompt,
  isWhitelist: isWhitelist,
  detectLang: detectLang,
  buildIndex: buildIndex,
  localTranslateSegment: localTranslateSegment
};
