package com.watermark.camera.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.regex.Pattern

// MARK: - 中-西翻译引擎：本地词典优先匹配 + 免费词典(MyMemory) + LLM API 兜底（对齐 iOS TranslatorService.swift）

object TranslatorService {

    data class BatchItem(val text: String, val from: String, val to: String)

    data class BatchResult(val result: String, val source: String)
    // source: local_all / api / api_batch / api_batch_fallback / free_dict / local_no_api / local_api_fail

    // MARK: - 正则（白名单判定）

    private val numRegex = Pattern.compile("^\\d+(\\.\\d+)?$")
    private val numUnitRegex = Pattern.compile("^\\d+(\\.\\d+)?[a-zA-Z²³¹º]+$")
    private val currencyRegex = Pattern.compile("^[¥$€]\\d+")
    private val boundaryRegex = Pattern.compile("^[\\s·×+\\-/,，.。:;：；()（）\\[\\]{}]+$")
    private val separatorPartRegex = Pattern.compile("(\\s+|[·×+\\-/，,。.：:；;])")

    // MARK: - 语言检测

    fun detectLang(text: String?): String {
        if (text.isNullOrEmpty()) return "unknown"
        var hasCJK = false
        var hasLatin = false
        for (ch in text) {
            val v = ch.code
            if ((v in 0x4E00..0x9FFF) || (v in 0x3400..0x4DBF) || (v in 0xF900..0xFAFF)) {
                hasCJK = true
            } else if ((v in 0x41..0x5A) || (v in 0x61..0x7A)) {
                hasLatin = true
            }
        }
        if (hasCJK) return "zh"
        if (hasLatin) return "es"
        return "unknown"
    }

    // MARK: - 白名单

    private fun isWhitelist(token: String, lowerSet: Set<String>, exactCase: List<String>): Boolean {
        if (token.isEmpty()) return false
        if (numRegex.matcher(token).matches()) return true
        if (numUnitRegex.matcher(token).matches()) return true
        if (currencyRegex.matcher(token).find()) return true
        val lower = token.lowercase()
        if (lowerSet.contains(lower)) return true
        if (exactCase.contains(token)) return true
        return false
    }

    private fun mergedWhitelistSets(): Pair<Set<String>, List<String>> {
        val all = BuiltinDict.whitelist + AppSettings.customWhitelist
        val lowerSet = all.map { it.lowercase() }.toSet()
        return lowerSet to all
    }

    // MARK: - 切分与本地匹配

    /** 按分隔符切分文本，保留分隔符 */
    fun splitText(text: String): List<String> {
        if (text.isEmpty()) return emptyList()
        val parts = mutableListOf<String>()
        val m = separatorPartRegex.matcher(text)
        var pos = 0
        while (m.find()) {
            if (m.start() > pos) parts.add(text.substring(pos, m.start()))
            parts.add(m.group())
            pos = m.end()
        }
        if (pos < text.length) parts.add(text.substring(pos))
        return parts.filter { it.isNotEmpty() }
    }

    /** 本地翻译一段文本（整段精确匹配 + 词边界模糊匹配） */
    private fun localTranslateSegment(
        text: String, from: String, to: String,
        lowerSet: Set<String>, exactCase: List<String>
    ): Pair<Boolean, String> {
        if (text.isEmpty()) return true to ""
        if (isWhitelist(text, lowerSet, exactCase)) return true to text

        val index = buildIndex()
        val list = if (from == "es") index.first else index.second
        val srcKey: (DictEntry) -> String = { e -> if (from == "es") e.es else e.zh }
        val dstKey: (DictEntry) -> String = { e -> if (from == "es") e.zh else e.es }

        // 整段精确匹配
        for (item in list) {
            if (srcKey(item) == text) return true to dstKey(item)
        }

        // 词边界模糊匹配（完整单词出现才替换）
        var result = text
        var matched = false
        for (entry in list) {
            val src = srcKey(entry)
            if (src.isEmpty()) continue
            val pattern = Pattern.compile(
                "(^|[\\s·×+\\-/，,。.：:；;()（）\\[\\]{}])" +
                    Pattern.quote(src) +
                    "([\\s·×+\\-/，,。.：:；;()（）\\[\\]{}]|$)",
                Pattern.CASE_INSENSITIVE
            )
            val m = pattern.matcher(result)
            if (m.find()) {
                matched = true
                result = m.group(1) + dstKey(entry) + m.group(2)
            }
        }
        if (matched) return true to result
        return false to text
    }

    /** (es→zh 排序, zh→es 排序)：源词长的优先，避免局部词先替换 */
    private fun buildIndex(): Pair<List<DictEntry>, List<DictEntry>> {
        val all = BuiltinDict.entries + AppSettings.customDict
        val esToZh = all.sortedByDescending { it.es.length }
        val zhToEs = all.sortedByDescending { it.zh.length }
        return esToZh to zhToEs
    }

    private fun isSeparator(seg: String): Boolean =
        boundaryRegex.matcher(seg).matches()

    // MARK: - HTTP

    private fun httpPost(urlStr: String, apiKey: String, bodyJson: JSONObject): String? {
        var conn: HttpURLConnection? = null
        return try {
            val url = URL(urlStr)
            conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15000
                readTimeout = 60000
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Authorization", "Bearer $apiKey")
            }
            conn.outputStream.use { it.write(bodyJson.toString().toByteArray(Charsets.UTF_8)) }
            if (conn.responseCode != 200) return null
            BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use { r ->
                r.readText()
            }
        } catch (_: Exception) {
            null
        } finally {
            conn?.disconnect()
        }
    }

    private fun httpGet(urlStr: String): String? {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 10000
                readTimeout = 20000
            }
            if (conn.responseCode != 200) return null
            BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use { r ->
                r.readText()
            }
        } catch (_: Exception) {
            null
        } finally {
            conn?.disconnect()
        }
    }

    // MARK: - LLM API 调用（OpenAI 兼容协议）

    private fun chatCompletion(prompt: String, maxTokens: Int, temperature: Double): String? {
        val cfg = AppSettings.apiConfig
        if (cfg.apiKey.isBlank() || cfg.baseURL.isBlank()) return null
        val urlStr = cfg.baseURL.trimEnd('/') + "/chat/completions"
        val model = cfg.model.ifBlank { "deepseek-chat" }
        val body = JSONObject().apply {
            put("model", model)
            put("messages", org.json.JSONArray().put(
                JSONObject().put("role", "user").put("content", prompt)))
            put("temperature", temperature)
            put("max_tokens", maxTokens)
        }
        val raw = httpPost(urlStr, cfg.apiKey, body) ?: return null
        return try {
            val json = JSONObject(raw)
            val content = json.getJSONArray("choices")
                .getJSONObject(0).getJSONObject("message").getString("content")
            val cleaned = content.trim().trim('"', '\'', '「', '『', '」', '』')
            if (cleaned.isEmpty()) null else cleaned
        } catch (_: Exception) { null }
    }

    // MARK: - 免费词典（MyMemory，无需 key）

    private fun callMyMemory(text: String, from: String, to: String): String? {
        if (from == to) return text
        val q = URLEncoder.encode(text, "UTF-8")
        val url = "https://api.mymemory.translated.net/get?q=$q&langpair=$from|$to"
        val raw = httpGet(url) ?: return null
        return try {
            val t = JSONObject(raw).getJSONObject("responseData").optString("translatedText")
            if (t.isBlank()) return null
            if (t.contains("MYMEMORY WARNING") || t.uppercase().contains("INVALID")
                || t.uppercase().contains("PLEASE SPECIFY")) return null
            t.replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
        } catch (_: Exception) { null }
    }

    // MARK: - 单条翻译

    suspend fun translate(text: String, from: String, to: String): String =
        withContext(Dispatchers.IO) {
            if (text.isBlank()) return@withContext ""
            val hasLLM = AppSettings.hasLLM
            // LLM 优先模式
            if (AppSettings.llmFirst && hasLLM) {
                val r = chatCompletion(buildPrompt(text, from, to), 1024, 0.3)
                if (r != null) return@withContext r
            }
            val (lowerSet, exactCase) = mergedWhitelistSets()
            val segments = splitText(text)
            val joined = StringBuilder()
            val misses = mutableListOf<String>()
            for (seg in segments) {
                val r = localTranslateSegment(seg, from, to, lowerSet, exactCase)
                joined.append(r.second)
                if (!r.first && !isSeparator(seg)) misses.add(seg)
            }
            if (misses.isEmpty()) return@withContext joined.toString()

            // 免费词典
            if (AppSettings.freeDictEnabled) {
                val r = callMyMemory(text, from, to)
                if (r != null) return@withContext r
            }
            // LLM
            if (hasLLM) {
                val r = chatCompletion(buildPrompt(text, from, to), 1024, 0.3)
                if (r != null) return@withContext r
            }
            joined.toString()
        }

    private fun buildPrompt(text: String, from: String, to: String): String {
        val (_, exactCase) = mergedWhitelistSets()
        val targetName = if (to == "zh") "中文" else "西班牙语"
        val sourceName = if (from == "zh") "中文" else "西班牙语"
        val whitelistStr = exactCase.joinToString(", ")
        return "请将以下文本从${sourceName}翻译为${targetName}。\n" +
            "规则：\n" +
            "1. 数字、货号、通用符号（× · + / , . 等）保持不变；\n" +
            "2. 以下词汇保持原文不翻译：$whitelistStr\n" +
            "3. 直接返回翻译结果，不要解释，不要加引号，不要添加任何多余内容。\n\n" +
            "原文：$text"
    }

    // MARK: - 批量翻译（本地 + 免费词典 + LLM 分组单次调用）

    suspend fun translateBatch(items: List<BatchItem>): List<BatchResult> =
        withContext(Dispatchers.IO) {
            if (items.isEmpty()) return@withContext emptyList()
            val hasLLM = AppSettings.hasLLM

            // 1. 本地匹配
            val (lowerSet, exactCase) = mergedWhitelistSets()
            data class LocalRow(val joined: String, val needApi: Boolean)

            val localRows = items.map { item ->
                val text = item.text
                if (text.isBlank()) return@map LocalRow("", false)
                val joined = StringBuilder()
                var miss = false
                for (seg in splitText(text)) {
                    val r = localTranslateSegment(seg, item.from, item.to, lowerSet, exactCase)
                    joined.append(r.second)
                    if (!r.first && !isSeparator(seg)) miss = true
                }
                LocalRow(joined.toString(), miss)
            }

            // 2. 收集需 API 项
            val apiIdx = localRows.indices.filter { localRows[it].needApi }
            if (apiIdx.isEmpty()) {
                return@withContext items.indices.map {
                    BatchResult(localRows[it].joined, "local_all")
                }
            }

            // 3. 免费词典层
            val fdResults = mutableMapOf<Int, String>()
            if (AppSettings.freeDictEnabled) {
                for (i in apiIdx) {
                    val a = items[i]
                    callMyMemory(a.text, a.from, a.to)?.let { fdResults[i] = it }
                }
            }

            // 4. 分组调用 LLM（按 (from,to) 分组）
            val llmIdx = apiIdx.filter { !fdResults.containsKey(it) }
            val llmResults = mutableMapOf<Int, String>()
            if (llmIdx.isNotEmpty() && hasLLM) {
                val groups = llmIdx.groupBy { "${items[it].from}|${items[it].to}" }
                for ((_, indices) in groups) {
                    val groupItems = indices.map { items[it] }
                    val results = callGroup(groupItems)
                    for (k in indices.indices) {
                        val v = results[k]
                        if (v != null) llmResults[indices[k]] = v
                    }
                }
            }

            // 5. 组装结果
            items.indices.map { idx ->
                val row = localRows[idx]
                if (!row.needApi) return@map BatchResult(row.joined, "local_all")
                if (fdResults.containsKey(idx)) return@map BatchResult(fdResults[idx]!!, "free_dict")
                if (llmResults.containsKey(idx)) return@map BatchResult(llmResults[idx]!!, "api_batch")
                val source = if (hasLLM) "local_api_fail" else "local_no_api"
                BatchResult(row.joined, source)
            }
        }

    /** 同方向批量调 LLM；缺失结果降级为逐条翻译 */
    private suspend fun callGroup(group: List<BatchItem>): List<String?> {
        val (_, exactCase) = mergedWhitelistSets()
        val from = group.first().from
        val to = group.first().to
        val sourceName = if (from == "zh") "中文" else "西班牙语"
        val targetName = if (to == "zh") "中文" else "西班牙语"
        val whitelistStr = exactCase.joinToString(", ")

        val merged = group.mapIndexed { i, it -> "[${i + 1}] ${it.text}" }.joinToString("\n")
        val batchPrompt = "请将以下多条文本从${sourceName}翻译为${targetName}。\n" +
            "规则：\n" +
            "1. 数字、货号、通用符号（× · + / , . 等）保持不变；\n" +
            "2. 以下词汇保持原文不翻译：$whitelistStr\n" +
            "3. 每条译文独占一行，以相同 [编号] 开头，格式：[编号]译文，不要解释、引号或多余内容；\n" +
            "4. 严格按编号顺序输出，数量必须与输入一致。\n\n" +
            "待翻译：\n$merged"

        val rough = arrayOfNulls<String>(group.size)
        val content = chatCompletion(batchPrompt, 4096, 0.3)
        if (content != null) {
            val regex = Pattern.compile("\\[(\\d+)\\]\\s*([^\\n]*)")
            val m = regex.matcher(content)
            while (m.find()) {
                val num = m.group(1).toIntOrNull() ?: continue
                val trans = m.group(2).trim()
                if (num in 1..group.size) rough[num - 1] = trans
            }
            // 兜底：按行解析
            if (rough.any { it == null }) {
                val fallback = content.split("\n")
                    .map { it.trim() }.filter { it.isNotEmpty() }
                if (fallback.size == group.size) {
                    for (i in fallback.indices) if (rough[i] == null) rough[i] = fallback[i]
                }
            }
        }
        // 缺失项逐条重试
        for (i in rough.indices) {
            if (rough[i] == null) {
                rough[i] = translate(group[i].text, group[i].from, group[i].to)
            }
        }
        return rough.toList()
    }
}
