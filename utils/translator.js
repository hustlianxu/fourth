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

// ===== 配置变更回调（用于配置同步） =====
var _configChangeCallback = null;

/**
 * 注册配置变更回调（每次配置保存后触发）
 * @param {Function} cb - () => void
 */
function setOnConfigChange(cb) {
  _configChangeCallback = cb;
}

function _triggerConfigChange() {
  if (typeof _configChangeCallback === 'function') {
    setTimeout(_configChangeCallback, 0);
  }
}

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
  invalidateDictCache();
  _triggerConfigChange();
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
  invalidateDictCache();
  _triggerConfigChange();
}

// 合并后的白名单（内置 + 用户自定义），缓存避免每次翻译重复 concat + 线性扫描
var _mergedWhitelistCache = null;
var _mergedWhitelistLowerSet = null;

// 合并后的白名单（内置 + 用户自定义）
function getMergedWhitelist() {
  if (_mergedWhitelistCache) return _mergedWhitelistCache;
  _mergedWhitelistCache = builtin.WHITELIST.concat(getUserWhitelist());
  // 预构建小写 Set，isWhitelist 用 O(1) 查询替代 O(W) 线性扫描
  _mergedWhitelistLowerSet = {};
  for (var i = 0; i < _mergedWhitelistCache.length; i++) {
    _mergedWhitelistLowerSet[String(_mergedWhitelistCache[i]).toLowerCase()] = true;
  }
  return _mergedWhitelistCache;
}

// 词典/白名单变更时失效缓存（供 setUserDict / setUserWhitelist 调用）
function invalidateDictCache() {
  _mergedWhitelistCache = null;
  _mergedWhitelistLowerSet = null;
  _indexCache = null;
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
  _triggerConfigChange();
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
  _triggerConfigChange();
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
  _triggerConfigChange();
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

// 词典索引缓存：translate/translateBatch 多次调用时避免重复 concat + 双排序
var _indexCache = null;

// 构建双向查询索引（合并内置+用户词，结果缓存，setUserDict 时失效）
function buildIndex() {
  if (_indexCache) return _indexCache;
  var all = builtin.BUILTIN_DICT.concat(getUserDict());
  // 按源词长度降序排序，便于先长后短匹配
  var esToZh = all.slice().sort(function (a, b) {
    return b.es.length - a.es.length;
  });
  var zhToEs = all.slice().sort(function (a, b) {
    return b.zh.length - a.zh.length;
  });
  _indexCache = { esToZh: esToZh, zhToEs: zhToEs };
  return _indexCache;
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
  // 精确匹配白名单（内置 + 用户自定义）：用预构建的小写 Set 做 O(1) 查询
  // 同时保留原值精确匹配以支持大小写敏感的白名单词条
  var lower = String(token).toLowerCase();
  var merged = getMergedWhitelist();
  // 快速路径：小写命中
  if (_mergedWhitelistLowerSet && _mergedWhitelistLowerSet[lower]) return true;
  // 大小写敏感的精确匹配（如大小写有意义的缩写）
  for (var i = 0; i < merged.length; i++) {
    if (merged[i] === token) return true;
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

  // 模糊匹配：词库条目在文本中以完整单词出现时才替换（前后为单词边界）
  var result = text;
  var matched = false;
  for (var j = 0; j < list.length; j++) {
    var entry = list[j];
    var src = entry[srcKey];
    if (!src) continue;
    // 用正则确保 src 以完整单词形式出现（不匹配子串，如"o"不匹配"modelo"内部）
    var boundaryRe = new RegExp('(^|[\\s·×+\\-/,，.。:;：；()（）\\[\\]{}])'
      + src.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
      + '([\\s·×+\\-/,，.。:;：；()（）\\[\\]{}]|$)', 'i');
    var match = result.match(boundaryRe);
    if (match) {
      matched = true;
      // 用 matched[1] + 译文 + matched[2] 替换，保留边界字符
      result = result.slice(0, match.index) + (match[1] || '') + entry[dstKey] + (match[2] || '') + result.slice(match.index + match[0].length);
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

/**
 * 调用多模态 LLM 识别水印图片中的文字内容（复用翻译引擎的 API 配置）
 * @param {string} imagePath - 本地图片文件路径
 * @returns {Promise<Object|null>} { modelo, desEs, desZh, precio, pzs, cajas, volumen, peso, ... }
 */
function recognizeWatermark(imagePath) {
  var cfg = getConfig();
  if (!cfg || !cfg.apiKey || !cfg.baseURL) {
    return Promise.reject(new Error('请先在「词典→翻译引擎」中配置并保存 LLM API（需支持多模态/视觉能力的模型）'));
  }

  // 读取图片为 base64
  var fs = wx.getFileSystemManager();
  var base64;
  try {
    base64 = fs.readFileSync(imagePath, 'base64');
  } catch (e) {
    return Promise.reject(new Error('读取图片失败: ' + (e.errMsg || e.message)));
  }
  if (!base64) {
    return Promise.reject(new Error('图片数据为空'));
  }

  var prompt =
    '你正在分析一张水印照片。照片上有水印文字，格式为"标签: 值"的列表。\n' +
    '请识别所有水印文字，提取为 JSON 格式，字段名用小写英文。常见字段有：\n' +
    '  modelo（货号/编码）, desEs（西班牙语描述）, desZh（中文描述）,\n' +
    '  precio（价格）, pzs（每箱数量）, cajas（箱数）,\n' +
    '  volumen（体积/cubico）, peso（重量）\n' +
    '如果没有识别到某个字段，对应值设为空字符串。\n' +
    '如果识别到不在上述列表中的字段，也一并加入 JSON。\n' +
    '只返回 JSON，不要其他文字。';

  var model = cfg.model || 'deepseek-chat';
  var data = {
    model: model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + base64 } }
      ]
    }],
    temperature: 0.1,
    max_tokens: 2048
  };

  return new Promise(function (resolve, reject) {
    wx.request({
      url: cfg.baseURL.replace(/\/$/, '') + '/chat/completions',
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey
      },
      data: data,
      timeout: 120000,
      success: function (res) {
        if (res.statusCode === 200 && res.data && res.data.choices && res.data.choices[0]) {
          var content = res.data.choices[0].message.content;
          try {
            var jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              var parsed = JSON.parse(jsonMatch[0]);
              resolve(parsed);
            } else {
              reject(new Error('API 返回格式异常，未找到 JSON'));
            }
          } catch (e) {
            reject(new Error('解析识别结果失败: ' + e.message));
          }
        } else {
          var errMsg = (res.data && res.data.error && res.data.error.message) || ('HTTP ' + res.statusCode);
          reject(new Error('API 返回异常: ' + errMsg));
        }
      },
      fail: function (err) {
        reject(new Error('API 调用失败: ' + (err.errMsg || err.message)));
      }
    });
  });
}

// ============ 免费词典层（MyMemory / 有道智云）============
// 作为本地词典与大模型之间的中间层：本地未命中时优先调用免费词典
// 用户可在设置页选择是否启用及采用哪种服务

var STORAGE_FREEDICT_KEY = 'watermark_free_dict';      // {enabled, provider}
var STORAGE_YOUDAO_KEY = 'watermark_youdao_creds';     // {appId, secret}
var md5 = require('./md5.js').md5;

// 免费词典配置：{enabled:bool, provider:'mymemory'|'youdao'|''}
function getFreeDictConfig() {
  try {
    var c = wx.getStorageSync(STORAGE_FREEDICT_KEY);
    if (!c || typeof c !== 'object') return { enabled: false, provider: '' };
    return {
      enabled: !!c.enabled,
      provider: c.provider === 'youdao' ? 'youdao' : (c.provider === 'mymemory' ? 'mymemory' : '')
    };
  } catch (e) { return { enabled: false, provider: '' }; }
}

function setFreeDictConfig(cfg) {
  cfg = cfg || {};
  wx.setStorageSync(STORAGE_FREEDICT_KEY, {
    enabled: !!cfg.enabled,
    provider: cfg.provider || ''
  });
  _triggerConfigChange();
}

// 有道智云凭证：{appId, secret}
function getYoudaoCreds() {
  try {
    var c = wx.getStorageSync(STORAGE_YOUDAO_KEY);
    if (!c || typeof c !== 'object') return { appId: '', secret: '' };
    return { appId: c.appId || '', secret: c.secret || '' };
  } catch (e) { return { appId: '', secret: '' }; }
}

function setYoudaoCreds(creds) {
  creds = creds || {};
  wx.setStorageSync(STORAGE_YOUDAO_KEY, {
    appId: creds.appId || '',
    secret: creds.secret || ''
  });
  _triggerConfigChange();
}

// 调用 MyMemory 免费 API（无需 key）
// 文档：https://mymemory.translated.net/doc/spec.php
// 限额：匿名约 5000 词/天，传 email 可提升至 50000 词/天
function callMyMemory(text, from, to) {
  if (!text) return Promise.resolve(null);
  var src = from === 'zh' ? 'zh' : 'es';
  var dst = to === 'zh' ? 'zh' : 'es';
  if (src === dst) return Promise.resolve(text);
  return new Promise(function (resolve) {
    wx.request({
      url: 'https://api.mymemory.translated.net/get',
      method: 'GET',
      data: {
        q: text,
        langpair: src + '|' + dst
      },
      timeout: 15000,
      success: function (res) {
        if (res.statusCode === 200 && res.data) {
          var rd = res.data.responseData || {};
          var t = rd.translatedText;
          // MyMemory 在配额耗尽/异常时返回带 "MYMEMORY WARNING" 等字样的字符串
          if (t && typeof t === 'string' &&
              t.indexOf('MYMEMORY WARNING') < 0 &&
              t.toUpperCase().indexOf('INVALID') < 0 &&
              t.toUpperCase().indexOf('PLEASE SPECIFY') < 0) {
            // 解码常见 HTML 实体
            t = t.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
                 .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            resolve(t);
            return;
          }
          console.warn('[Translator] MyMemory 返回异常:', res.data);
        }
        resolve(null);
      },
      fail: function (err) {
        console.warn('[Translator] MyMemory 调用失败:', err);
        resolve(null);
      }
    });
  });
}

// 调用有道智云 API（需 appId + secret）
// 文档：https://ai.youdao.com/DOCSIRMA/html/trans/api/wbfy/index.html
// 签名：sign = md5(appId + q + salt + secret)
function callYoudao(text, from, to) {
  if (!text) return Promise.resolve(null);
  var creds = getYoudaoCreds();
  if (!creds.appId || !creds.secret) return Promise.resolve(null);
  // 有道语言代码：简体中文 zh-CHS，西班牙语 es
  var src = from === 'zh' ? 'zh-CHS' : 'es';
  var dst = to === 'zh' ? 'zh-CHS' : 'es';
  if (src === dst) return Promise.resolve(text);
  var salt = '' + Date.now();
  var sign = md5(creds.appId + text + salt + creds.secret);
  return new Promise(function (resolve) {
    wx.request({
      url: 'https://openapi.youdao.com/api',
      method: 'GET',
      data: {
        q: text,
        from: src,
        to: dst,
        appKey: creds.appId,
        salt: salt,
        sign: sign
      },
      timeout: 15000,
      success: function (res) {
        if (res.statusCode === 200 && res.data) {
          var errorCode = res.data.errorCode;
          // errorCode === '0' 或 0 表示成功
          if (errorCode === '0' || errorCode === 0) {
            var translations = res.data.translation;
            if (translations && translations.length > 0) {
              resolve(translations[0]);
              return;
            }
          }
          console.warn('[Translator] 有道返回错误:', errorCode, res.data);
        }
        resolve(null);
      },
      fail: function (err) {
        console.warn('[Translator] 有道调用失败:', err);
        resolve(null);
      }
    });
  });
}

// 统一免费词典入口：按配置分派
// 返回 Promise<string|null>，null 表示未启用或调用失败
function callFreeDict(text, from, to) {
  var cfg = getFreeDictConfig();
  if (!cfg.enabled || !cfg.provider) return Promise.resolve(null);
  if (cfg.provider === 'mymemory') return callMyMemory(text, from, to);
  if (cfg.provider === 'youdao') return callYoudao(text, from, to);
  return Promise.resolve(null);
}

// 内部辅助：尝试 LLM API，失败则降级本地
// 供 translate() 复用，避免与免费词典层耦合
function _tryLLM(text, from, to, localJoined, missWords, withDebug, cfg) {
  if (!cfg || !cfg.apiKey || !cfg.baseURL) {
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
    return withDebug
      ? { result: localJoined, debug: { source: 'local_api_fail', missCount: missWords.length, missSegments: missWords, elapsed: elapsed, reason: 'API 调用失败或返回空' } }
      : localJoined;
  });
}

// ============ LLM 优先模式 ============

var STORAGE_LLM_FIRST_KEY = 'watermark_translator_llm_first';

/**
 * 获取 LLM 优先模式开关：开启后跳过本地匹配，直接调用 LLM
 */
function getLLMFirst() {
  try {
    return wx.getStorageSync(STORAGE_LLM_FIRST_KEY) === true;
  } catch (e) {
    return false;
  }
}

function setLLMFirst(enabled) {
  try {
    wx.setStorageSync(STORAGE_LLM_FIRST_KEY, !!enabled);
  } catch (e) {}
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

  // LLM 优先模式：跳过本地匹配，直接走 LLM
  var llmFirst = getLLMFirst();
  if (llmFirst) {
    var cfg = getConfig();
    if (cfg && cfg.apiKey && cfg.baseURL) {
      var t0 = Date.now();
      return callLLM(text, from, to).then(function (apiResult) {
        var elapsed = Date.now() - t0;
        if (apiResult) {
          return withDebug
            ? { result: apiResult, debug: { source: 'api', provider: cfg.provider, elapsed: elapsed, llmFirst: true } }
            : apiResult;
        }
        // LLM 失败 → 降级本地匹配
        console.warn('[Translator] LLM 优先模式调用失败，降级本地');
      });
    }
  }

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

  // 有未命中段
  var cfg = getConfig();
  var missWords = missSegments.map(function (m) { return m.seg; });
  var fdCfg = getFreeDictConfig();

  // 1) 免费词典层（如启用）：本地未命中时优先调用免费词典
  if (fdCfg.enabled && fdCfg.provider) {
    var fdT0 = Date.now();
    return callFreeDict(text, from, to).then(function (fdResult) {
      var fdElapsed = Date.now() - fdT0;
      if (fdResult) {
        return withDebug
          ? { result: fdResult, debug: { source: 'free_dict', provider: fdCfg.provider, elapsed: fdElapsed, missCount: missWords.length, missSegments: missWords } }
          : fdResult;
      }
      // 免费词典失败/未启用 → 继续尝试 LLM API
      return _tryLLM(text, from, to, localJoined, missWords, withDebug, cfg);
    });
  }

  // 2) 直接尝试 LLM API（未启用免费词典时）
  return _tryLLM(text, from, to, localJoined, missWords, withDebug, cfg);
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

  // LLM 优先模式：跳过本地匹配，直接批量走 LLM
  var llmFirst = getLLMFirst();
  if (llmFirst) {
    var cfg = getConfig();
    if (cfg && cfg.apiKey && cfg.baseURL) {
      var t0 = Date.now();
      // 按 (from, to) 分组
      var groupMap = {};
      var hasText = false;
      items.forEach(function (item, idx) {
        if (!item.text || !item.text.trim()) return;
        hasText = true;
        var key = item.from + '|' + item.to;
        if (!groupMap[key]) groupMap[key] = { from: item.from, to: item.to, items: [], origIndices: [] };
        groupMap[key].items.push(item);
        groupMap[key].origIndices.push(idx);
      });
      if (hasText) {
        var groupKeys = Object.keys(groupMap);
        return Promise.all(groupKeys.map(function (gk) {
          var g = groupMap[gk];
          // 复用现有批量 prompt 逻辑，独立发起 LLM 调用
          var whitelistStr = getMergedWhitelist().join(', ');
          var sourceName = g.from === 'zh' ? '中文' : '西班牙语';
          var targetName = g.to === 'zh' ? '中文' : '西班牙语';
          var lines = g.items.map(function (a, i) { return '[' + (i + 1) + '] ' + a.text; });
          var merged = lines.join('\n');
          var batchPrompt =
            '请将以下多条文本从' + sourceName + '翻译为' + targetName + '。\n' +
            '规则：\n' +
            '1. 数字、货号、通用符号（× · + / , . 等）保持不变；\n' +
            '2. 以下词汇保持原文不翻译：' + whitelistStr + '\n' +
            '3. 每条译文独占一行，以相同 [编号] 开头，格式：[编号]译文，不要解释、引号或多余内容；\n' +
            '4. 严格按编号顺序输出，数量必须与输入一致。\n\n' +
            '待翻译：\n' + merged;
          var custom = getCustomPrompt();
          if (custom && custom.trim()) {
            batchPrompt = custom
              .replace(/\{source\}/g, sourceName)
              .replace(/\{target\}/g, targetName)
              .replace(/\{whitelist\}/g, whitelistStr)
              .replace(/\{text\}/g, merged);
            batchPrompt += '\n\n[批量模式：每条以 [编号] 开头，请按 [编号]译文 格式逐行输出，严格对应]';
          }
          var model = cfg.model || 'deepseek-chat';
          return new Promise(function (resolve) {
            wx.request({
              url: cfg.baseURL.replace(/\/$/, '') + '/chat/completions',
              method: 'POST',
              header: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
              data: { model: model, messages: [{ role: 'user', content: batchPrompt }], temperature: 0.3, max_tokens: 4096 },
              timeout: 60000,
              success: function (res) {
                if (res.statusCode === 200 && res.data && res.data.choices && res.data.choices[0]) {
                  var content = res.data.choices[0].message.content;
                  content = String(content || '').replace(/^["'「『]+|["'」』]+$/g, '').trim();
                  var resultMap = {};
                  var lineRegex = /\[(\d+)\]\s*([^\n]*)/g;
                  var m;
                  while ((m = lineRegex.exec(content)) !== null) {
                    var num = parseInt(m[1], 10);
                    if (num >= 1 && num <= g.items.length) resultMap[num] = m[2].trim();
                  }
                  var fallbackParts = content.split(/\n+/).map(function (s) { return s.trim(); }).filter(function (s) { return s; });
                  var results = g.items.map(function (a, i) {
                    var num = i + 1;
                    if (resultMap[num] != null) return resultMap[num];
                    if (fallbackParts.length === g.items.length) return fallbackParts[i];
                    return null;
                  });
                  resolve({ origIndices: g.origIndices, results: results });
                } else {
                  resolve({ origIndices: g.origIndices, results: g.items.map(function () { return null; }) });
                }
              },
              fail: function () {
                resolve({ origIndices: g.origIndices, results: g.items.map(function () { return null; }) });
              }
            });
          });
        })).then(function (allGroups) {
          var results = items.map(function () { return null; });
          var allOk = true;
          allGroups.forEach(function (ag) {
            ag.origIndices.forEach(function (origIdx, i) {
              results[origIdx] = ag.results[i];
              if (ag.results[i] == null) allOk = false;
            });
          });
          if (allOk) {
            var elapsed = Date.now() - t0;
            console.log('[Translator] LLM 优先模式批量完成:', results.length, '条, 耗时', elapsed, 'ms');
            return withDebug
              ? results.map(function (r) { return { result: r, debug: { source: 'api', llmFirst: true, elapsed: elapsed } }; })
              : results;
          }
          // LLM 部分失败 → 降级本地匹配
          console.warn('[Translator] LLM 优先模式部分失败，降级本地');
        });
      }
    }
  }

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

  var cfg = getConfig();
  var noApi = !cfg || !cfg.apiKey || !cfg.baseURL;

  // 收集所有需调 API 的项（按 items 顺序，跨方向合并到单次请求）
  var apiItems = [];  // {origIdx, from, to, text}
  localResults.forEach(function (lr, idx) {
    if (lr.needApi) {
      apiItems.push({ origIdx: idx, from: lr.from, to: lr.to, text: items[idx].text });
    }
  });

  // 无待翻译项 → 直接用本地结果（全部本地命中）
  // 注意：noApi 不能在此提前返回，否则会跳过免费词典层
  if (apiItems.length === 0) {
    return Promise.resolve(items.map(function (item, idx) {
      var lr = localResults[idx];
      return withDebug
        ? { result: lr.localJoined, debug: { source: 'local_all', missCount: 0 } }
        : lr.localJoined;
    }));
  }

  // 单组批量翻译（同方向）：prompt 里只说明一次方向，每条只用 [编号] 原文，
  // 不在每条上标注 (中→西)/(西→中)，避免 LLM 把方向标注回带污染译文
  function _callGroup(groupItems, from, to) {
    var whitelistStr = getMergedWhitelist().join(', ');
    var sourceName = from === 'zh' ? '中文' : '西班牙语';
    var targetName = to === 'zh' ? '中文' : '西班牙语';
    var lines = groupItems.map(function (a, i) {
      return '[' + (i + 1) + '] ' + a.text;
    });
    var merged = lines.join('\n');

    var batchPrompt =
      '请将以下多条文本从' + sourceName + '翻译为' + targetName + '。\n' +
      '规则：\n' +
      '1. 数字、货号、通用符号（× · + / , . 等）保持不变；\n' +
      '2. 以下词汇保持原文不翻译：' + whitelistStr + '\n' +
      '3. 每条译文独占一行，以相同 [编号] 开头，格式：[编号]译文，不要解释、引号或多余内容；\n' +
      '4. 严格按编号顺序输出，数量必须与输入一致。\n\n' +
      '待翻译：\n' + merged;

    // 自定义 prompt（如有）替换基础部分，但保留批量结构说明
    var custom = getCustomPrompt();
    if (custom && custom.trim()) {
      batchPrompt = custom
        .replace(/\{source\}/g, sourceName)
        .replace(/\{target\}/g, targetName)
        .replace(/\{whitelist\}/g, whitelistStr)
        .replace(/\{text\}/g, merged);
      batchPrompt += '\n\n[批量模式：每条以 [编号] 开头，请按 [编号]译文 格式逐行输出，严格对应]';
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
            // 按 [编号] 切分译文，用正则匹配每行开头的 [N]
            var resultMap2 = {};
            var lineRegex = /\[(\d+)\]\s*([^\n]*)/g;
            var m;
            while ((m = lineRegex.exec(content)) !== null) {
              var num = parseInt(m[1], 10);
              var trans = m[2].trim();
              if (num >= 1 && num <= groupItems.length) {
                resultMap2[num] = trans;
              }
            }
            // 兜底：若正则未匹配到任何编号行，尝试按换行直接切分（LLM 可能省略编号）
            var fallbackParts = content.split(/\n+/).map(function (s) { return s.trim(); }).filter(function (s) { return s; });
            var results = groupItems.map(function (a, i) {
              var num = i + 1;
              if (resultMap2[num] != null) return resultMap2[num];
              if (fallbackParts.length === groupItems.length) return fallbackParts[i];
              return null;
            });
            resolve({ results: results, elapsed: elapsed, source: 'api_batch' });
          } else {
            console.warn('[Translator] 批量 API 返回异常:', res.statusCode, res.data);
            resolve({ results: groupItems.map(function () { return null; }), elapsed: elapsed, source: 'api_fail' });
          }
        },
        fail: function (err) {
          var elapsed = Date.now() - t0;
          console.warn('[Translator] 批量 API 调用失败:', err);
          resolve({ results: groupItems.map(function () { return null; }), elapsed: elapsed, source: 'api_fail' });
        }
      });
    }).then(function (gr) {
      // 条数校验：若本组切分有缺失（原文含 [数字] 等导致 LLM 输出错乱），
      // 自动回退逐条翻译，保证结果正确（牺牲请求数换稳健性）
      var hasNull = gr.results.some(function (r) { return r == null || r === ''; });
      if (hasNull && gr.source !== 'api_fail') {
        console.warn('[Translator] 组(' + from + '→' + to + ')批量结果有缺失，回退逐条翻译');
        return Promise.all(groupItems.map(function (a) {
          return translate(a.text, from, to, true).then(function (r) { return r.result; });
        })).then(function (oneByOneResults) {
          gr.results = oneByOneResults;
          gr.source = 'api_batch_fallback';
          return gr;
        });
      }
      return gr;
    });
  }

  // 免费词典层：对 apiItems 并行调用免费词典（如启用）
  var fdCfg = getFreeDictConfig();
  var fdPromise;
  if (fdCfg.enabled && fdCfg.provider) {
    fdPromise = Promise.all(apiItems.map(function (a) {
      return callFreeDict(a.text, a.from, a.to);
    }));
  } else {
    fdPromise = Promise.resolve(apiItems.map(function () { return null; }));
  }

  return fdPromise.then(function (fdResults) {
    // fdResults[i] 对应 apiItems[i]
    // 仍需 LLM 的项（免费词典失败/未启用）
    var llmItems = [];
    var fdMap = {};  // origIdx → 免费词典结果
    apiItems.forEach(function (a, i) {
      if (fdResults[i]) {
        fdMap[a.origIdx] = fdResults[i];
      } else {
        llmItems.push(a);
      }
    });

    // 无需 LLM（全部免费词典命中）或未配置 LLM → 直接组装（本地 + 免费词典）
    if (llmItems.length === 0 || noApi) {
      return items.map(function (item, idx) {
        var lr = localResults[idx];
        if (!lr.needApi) {
          return withDebug
            ? { result: lr.localJoined, debug: { source: 'local_all', missCount: 0 } }
            : lr.localJoined;
        }
        if (fdMap[idx]) {
          return withDebug
            ? { result: fdMap[idx], debug: { source: 'free_dict', provider: fdCfg.provider } }
            : fdMap[idx];
        }
        // needApi 但免费词典未命中且无 LLM → 本地降级
        return withDebug
          ? { result: lr.localJoined, debug: { source: noApi ? 'local_no_api' : 'local_all', missCount: lr.miss.length } }
          : lr.localJoined;
      });
    }

    // 按 (from, to) 分组：同方向归一组，每组单次 LLM API 调用（基于 llmItems）
    // 同方向场景（导出最常见）仍为 1 次请求；混合方向最多 2 次（中→西 + 西→中）
    var groupMap = {};
    llmItems.forEach(function (a, apiIdx) {
      var key = a.from + '|' + a.to;
      if (!groupMap[key]) groupMap[key] = { from: a.from, to: a.to, items: [], apiIdxList: [] };
      groupMap[key].items.push(a);
      groupMap[key].apiIdxList.push(apiIdx);
    });
    var groupKeys = Object.keys(groupMap);

    return Promise.all(groupKeys.map(function (gk) {
      var g = groupMap[gk];
      return _callGroup(g.items, g.from, g.to).then(function (gr) {
        return { apiIdxList: g.apiIdxList, results: gr.results, source: gr.source, elapsed: gr.elapsed };
      });
    })).then(function (allGroups) {
      // 合并各组结果到 llmResults（按 llmItems 顺序）
      var llmResults = llmItems.map(function () { return null; });
      var mergedSource = 'api_batch';
      var maxElapsed = 0;
      allGroups.forEach(function (ag) {
        ag.apiIdxList.forEach(function (apiIdx, i) {
          llmResults[apiIdx] = ag.results[i];
        });
        if (ag.elapsed > maxElapsed) maxElapsed = ag.elapsed;
        if (ag.source === 'api_fail') mergedSource = 'api_fail';
        else if (ag.source === 'api_batch_fallback' && mergedSource !== 'api_fail') mergedSource = 'api_batch_fallback';
      });

      // 组装最终结果（与 items 同序）
      return items.map(function (item, idx) {
        var lr = localResults[idx];
        if (!lr.needApi) {
          return withDebug
            ? { result: lr.localJoined, debug: { source: 'local_all', missCount: 0 } }
            : lr.localJoined;
        }
        // 免费词典命中
        if (fdMap[idx]) {
          return withDebug
            ? { result: fdMap[idx], debug: { source: 'free_dict', provider: fdCfg.provider } }
            : fdMap[idx];
        }
        // 在 llmItems 中的位置
        var posInLlm = -1;
        for (var k = 0; k < llmItems.length; k++) {
          if (llmItems[k].origIdx === idx) { posInLlm = k; break; }
        }
        var llmResult = llmResults[posInLlm];
        if (llmResult) {
          return withDebug
            ? { result: llmResult, debug: { source: mergedSource, provider: cfg.provider, elapsed: maxElapsed, batchPos: posInLlm, batchSize: llmItems.length } }
            : llmResult;
        }
        // LLM 失败 → 本地结果降级
        return withDebug
          ? { result: lr.localJoined, debug: { source: 'local_api_fail', reason: 'API 失败或返回空', elapsed: maxElapsed } }
          : lr.localJoined;
      });
    });
  });
}

// ============ 模块导出 ============

module.exports = {
  translate: translate,
  translateBatch: translateBatch,
  setOnConfigChange: setOnConfigChange,
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
  getLLMFirst: getLLMFirst,
  setLLMFirst: setLLMFirst,
  recognizeWatermark: recognizeWatermark,
  buildPrompt: buildPrompt,
  isWhitelist: isWhitelist,
  detectLang: detectLang,
  buildIndex: buildIndex,
  localTranslateSegment: localTranslateSegment,
  // 免费词典层
  getFreeDictConfig: getFreeDictConfig,
  setFreeDictConfig: setFreeDictConfig,
  getYoudaoCreds: getYoudaoCreds,
  setYoudaoCreds: setYoudaoCreds,
  callFreeDict: callFreeDict,
  callMyMemory: callMyMemory,
  callYoudao: callYoudao
};
