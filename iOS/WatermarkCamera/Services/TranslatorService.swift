import Foundation

/// 中-西翻译引擎：本地词典优先匹配 + 免费词典(MyMemory) + LLM API 兜底
/// 移植自小程序 utils/translator.js
final class TranslatorService {

    static let shared = TranslatorService()

    struct BatchItem {
        var text: String
        var from: String  // "zh" | "es"
        var to: String    // "es" | "zh"
    }

    struct BatchResult {
        var result: String
        var source: String // local_all / api / api_batch / api_batch_fallback / free_dict / local_no_api / local_api_fail
    }

    // MARK: - 正则（白名单判定）

    private let numRegex = try! NSRegularExpression(pattern: #"^\d+(\.\d+)?$"#)
    private let numUnitRegex = try! NSRegularExpression(pattern: #"^\d+(\.\d+)?[a-zA-Z²³¹º]+$"#)
    private let currencyRegex = try! NSRegularExpression(pattern: #"^[¥$€]\d+"#)
    private let boundaryRegex = try! NSRegularExpression(pattern: #"^[\s·×+\-/,，.。:;：；()（）\[\]{}]+$"#)
    private let separatorPartRegex = try! NSRegularExpression(pattern: #"(\s+|[·×+\-/，,。.：:；;])"#)

    // MARK: - 语言检测

    func detectLang(_ text: String?) -> String {
        guard let text = text, !text.isEmpty else { return "unknown" }
        var hasCJK = false
        var hasLatin = false
        for scalar in text.unicodeScalars {
            let v = scalar.value
            if (v >= 0x4E00 && v <= 0x9FFF) || (v >= 0x3400 && v <= 0x4DBF) || (v >= 0xF900 && v <= 0xFAFF) {
                hasCJK = true
            } else if (v >= 0x41 && v <= 0x5A) || (v >= 0x61 && v <= 0x7A) {
                hasLatin = true
            }
        }
        if hasCJK { return "zh" }
        if hasLatin { return "es" }
        return "unknown"
    }

    // MARK: - 白名单

    private func isWhitelist(_ token: String, exactSet: Set<String>, exactCase: [String]) -> Bool {
        guard !token.isEmpty else { return false }
        let range = NSRange(location: 0, length: token.utf16.count)
        if numRegex.firstMatch(in: token, range: range) != nil { return true }
        if numUnitRegex.firstMatch(in: token, range: range) != nil { return true }
        if currencyRegex.firstMatch(in: token, range: range) != nil { return true }
        let lower = token.lowercased()
        if exactSet.contains(lower) { return true }
        // 大小写敏感精确匹配（如大小写有意义的缩写）
        if exactCase.contains(token) { return true }
        return false
    }

    private func mergedWhitelistSets() -> (Set<String>, [String]) {
        let custom = AppSettings.customWhitelist
        var lowerSet = Set<String>()
        for w in BuiltinDict.whitelist + custom {
            lowerSet.insert(w.lowercased())
        }
        return (lowerSet, BuiltinDict.whitelist + custom)
    }

    // MARK: - 切分与本地匹配

    /// 按分隔符切分文本，保留分隔符（对齐 JS split(/(\s+|[·×+\-\/,，.。:;：；])/)）
    func splitText(_ text: String) -> [String] {
        guard !text.isEmpty else { return [] }
        let ns = text as NSString
        var parts: [String] = []
        var pos = 0
        let matches = separatorPartRegex.matches(in: text, range: NSRange(location: 0, length: ns.length))
        for m in matches {
            let sep = m.range(at: 1)
            if sep.location > pos {
                parts.append(ns.substring(with: NSRange(location: pos, length: sep.location - pos)))
            }
            parts.append(ns.substring(with: sep))
            pos = sep.location + sep.length
        }
        if pos < ns.length {
            parts.append(ns.substring(with: NSRange(location: pos, length: ns.length - pos)))
        }
        return parts.filter { !$0.isEmpty }
    }

    /// 本地翻译一段文本（整段精确匹配 + 词边界模糊匹配）
    private func localTranslateSegment(_ text: String, from: String, to: String,
                                       lowerSet: Set<String>, exactCase: [String]) -> (translated: Bool, result: String) {
        if text.isEmpty { return (true, "") }
        if isWhitelist(text, exactSet: lowerSet, exactCase: exactCase) { return (true, text) }

        let index = buildIndex()
        let (list, srcKey, dstKey) = from == "es"
            ? (index.esToZh, \DictEntry.es, \DictEntry.zh)
            : (index.zhToEs, \DictEntry.zh, \DictEntry.es)

        // 整段精确匹配
        for item in list where item[keyPath: srcKey] == text {
            return (true, item[keyPath: dstKey])
        }

        // 词边界模糊匹配（完整单词出现才替换）
        var result = text
        var matched = false
        for entry in list {
            let src = entry[keyPath: srcKey]
            if src.isEmpty { continue }
            let pattern = "(^|[\\s·×+\\-/，,。.：:；;()（）\\[\\]{}])"
                + NSRegularExpression.escapedPattern(for: src)
                + "([\\s·×+\\-/，,。.：:；;()（）\\[\\]{}]|$)"
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
            let ns = result as NSString
            let nsRange = NSRange(location: 0, length: ns.length)
            guard let match = regex.firstMatch(in: result, range: nsRange) else { continue }
            matched = true
            let replaced = ns.substring(with: match.range(at: 1))
                + entry[keyPath: dstKey]
                + ns.substring(with: match.range(at: 2))
            result = (result as NSString).replacingCharacters(in: match.range, with: replaced)
        }
        if matched { return (true, result) }
        return (false, text)
    }

    private struct Index {
        var esToZh: [DictEntry]
        var zhToEs: [DictEntry]
    }

    private func buildIndex() -> Index {
        let all = BuiltinDict.entries + AppSettings.customDict
        let esToZh = all.sorted { $0.es.count > $1.es.count }
        let zhToEs = all.sorted { $0.zh.count > $1.zh.count }
        return Index(esToZh: esToZh, zhToEs: zhToEs)
    }

    // MARK: - LLM API 调用（OpenAI 兼容协议）

    private func chatCompletion(prompt: String, maxTokens: Int, temperature: Double) async -> String? {
        let cfg = AppSettings.apiConfig
        guard !cfg.apiKey.isEmpty, !cfg.baseURL.isEmpty else { return nil }
        let urlStr = cfg.baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            + "/chat/completions"
        guard let url = URL(string: urlStr) else { return nil }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(cfg.apiKey)", forHTTPHeaderField: "Authorization")

        let model = cfg.model.isEmpty ? "deepseek-chat" : cfg.model
        let body: [String: Any] = [
            "model": model,
            "messages": [["role": "user", "content": prompt]],
            "temperature": temperature,
            "max_tokens": maxTokens
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let choices = json["choices"] as? [[String: Any]],
                  let first = choices.first,
                  let message = first["message"] as? [String: Any],
                  var content = message["content"] as? String else { return nil }
            // 去掉可能的引号
            content = content.trimmingCharacters(in: CharacterSet(charactersIn: "\"'「『」』"))
            return content.isEmpty ? nil : content
        } catch {
            return nil
        }
    }

    // MARK: - 免费词典（MyMemory，无需 key）

    private func callMyMemory(_ text: String, from: String, to: String) async -> String? {
        guard from != to else { return text }
        var comps = URLComponents(string: "https://api.mymemory.translated.net/get")
        let langpair = "\(from)|\(to)"
        comps?.queryItems = [
            URLQueryItem(name: "q", value: text),
            URLQueryItem(name: "langpair", value: langpair)
        ]
        guard let url = comps?.url else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let rd = json["responseData"] as? [String: Any],
                  var t = rd["translatedText"] as? String, !t.isEmpty else { return nil }
            if t.contains("MYMEMORY WARNING")
                || t.uppercased().contains("INVALID")
                || t.uppercased().contains("PLEASE SPECIFY") {
                return nil
            }
            t = t.replacingOccurrences(of: "&quot;", with: "\"")
                .replacingOccurrences(of: "&#39;", with: "'")
                .replacingOccurrences(of: "&amp;", with: "&")
                .replacingOccurrences(of: "&lt;", with: "<")
                .replacingOccurrences(of: "&gt;", with: ">")
            return t
        } catch {
            return nil
        }
    }

    // MARK: - 单条翻译

    func translate(_ text: String, from: String, to: String) async -> String {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return "" }
        // LLM 优先模式
        let cfg = AppSettings.apiConfig
        let hasLLM = !cfg.apiKey.isEmpty && !cfg.baseURL.isEmpty
        if AppSettings.llmFirst && hasLLM {
            let prompt = buildPrompt(text: text, from: from, to: to)
            if let r = await chatCompletion(prompt: prompt, maxTokens: 1024, temperature: 0.3) {
                return r
            }
        }
        let (lowerSet, exactCase) = mergedWhitelistSets()
        let segments = splitText(text)
        var joined = ""
        var misses: [String] = []
        for seg in segments {
            let r = localTranslateSegment(seg, from: from, to: to, lowerSet: lowerSet, exactCase: exactCase)
            joined += r.result
            if !r.translated && !isSeparator(seg) {
                misses.append(seg)
            }
        }
        if misses.isEmpty { return joined }

        // 免费词典
        let fd = AppSettings.freeDictConfig
        if fd.enabled, fd.provider == "mymemory" {
            if let r = await callMyMemory(text, from: from, to: to) { return r }
        }
        // LLM
        if hasLLM {
            let prompt = buildPrompt(text: text, from: from, to: to)
            if let r = await chatCompletion(prompt: prompt, maxTokens: 1024, temperature: 0.3) {
                return r
            }
        }
        return joined
    }

    private func isSeparator(_ seg: String) -> Bool {
        boundaryRegex.firstMatch(in: seg, range: NSRange(location: 0, length: seg.utf16.count)) != nil
    }

    private func buildPrompt(text: String, from: String, to: String) -> String {
        let (_, exactCase) = mergedWhitelistSets()
        let targetName = to == "zh" ? "中文" : "西班牙语"
        let sourceName = from == "zh" ? "中文" : "西班牙语"
        let whitelistStr = exactCase.joined(separator: ", ")
        return "请将以下文本从\(sourceName)翻译为\(targetName)。\n"
            + "规则：\n"
            + "1. 数字、货号、通用符号（× · + / , . 等）保持不变；\n"
            + "2. 以下词汇保持原文不翻译：\(whitelistStr)\n"
            + "3. 直接返回翻译结果，不要解释，不要加引号，不要添加任何多余内容。\n\n"
            + "原文：\(text)"
    }

    // MARK: - 批量翻译（本地 + 免费词典 + LLM 分组单次调用）

    func translateBatch(_ items: [BatchItem]) async -> [BatchResult] {
        guard !items.isEmpty else { return [] }
        let cfg = AppSettings.apiConfig
        let hasLLM = !cfg.apiKey.isEmpty && !cfg.baseURL.isEmpty
        let fd = AppSettings.freeDictConfig

        // ===== 1. 本地匹配 =====
        let (lowerSet, exactCase) = mergedWhitelistSets()
        struct LocalRow {
            var joined: String
            var needApi: Bool
            var misses: [String]
        }
        var localRows: [LocalRow] = []
        for item in items {
            let text = item.text
            if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                localRows.append(LocalRow(joined: "", needApi: false, misses: []))
                continue
            }
            var joined = ""
            var miss: [String] = []
            for seg in splitText(text) {
                let r = localTranslateSegment(seg, from: item.from, to: item.to,
                                              lowerSet: lowerSet, exactCase: exactCase)
                joined += r.result
                if !r.translated && !isSeparator(seg) {
                    miss.append(seg)
                }
            }
            localRows.append(LocalRow(joined: joined, needApi: !miss.isEmpty, misses: miss))
        }

        // ===== 2. 收集需 API 项 =====
        struct ApiItem {
            var origIdx: Int
            var from: String
            var to: String
            var text: String
        }
        var apiItems: [ApiItem] = []
        for (idx, row) in localRows.enumerated() where row.needApi {
            apiItems.append(ApiItem(origIdx: idx, from: items[idx].from, to: items[idx].to, text: items[idx].text))
        }

        if apiItems.isEmpty {
            return items.indices.map {
                BatchResult(result: localRows[$0].joined, source: "local_all")
            }
        }

        // ===== 3. 免费词典层 =====
        var fdResults = Array<String?>(repeating: nil, count: apiItems.count)
        if fd.enabled, fd.provider == "mymemory" {
            for (i, a) in apiItems.enumerated() {
                fdResults[i] = await callMyMemory(a.text, from: a.from, to: a.to)
            }
        }

        // ===== 4. 分组调用 LLM =====
        var llmItems: [ApiItem] = []
        for (i, a) in apiItems.enumerated() where fdResults[i] == nil {
            llmItems.append(a)
        }

        var llmResults = Array<String?>(repeating: nil, count: llmItems.count)
        if !llmItems.isEmpty && hasLLM {
            // 按 (from,to) 分组
            var groups: [String: [Int]] = [:]
            var keys: [String] = []
            for (i, a) in llmItems.enumerated() {
                let key = "\(a.from)|\(a.to)"
                if groups[key] == nil { keys.append(key) }
                groups[key, default: []].append(i)
            }
            for key in keys {
                let indices = groups[key]!
                let groupItems = indices.map { llmItems[$0] }
                let from = groupItems[0].from
                let to = groupItems[0].to
                var results = await callGroup(groupItems, from: from, to: to)
                // 缺失项降级：本地结果
                for (offset, i) in indices.enumerated() {
                    if results[offset] == nil {
                        results[offset] = localRows[llmItems[i].origIdx].joined
                    }
                    llmResults[i] = results[offset]
                }
            }
        }

        // ===== 5. 组装结果 =====
        var results: [BatchResult] = []
        for (idx, item) in items.enumerated() {
            let row = localRows[idx]
            if !row.needApi {
                results.append(BatchResult(result: row.joined, source: "local_all"))
                continue
            }
            // 找到在 apiItems 中的位置
            let apiIdx = apiItems.firstIndex { $0.origIdx == idx }
            if let apiIdx = apiIdx {
                if let fd = fdResults[apiIdx] {
                    results.append(BatchResult(result: fd, source: "free_dict"))
                    continue
                }
                let llmIdx = llmItems.firstIndex { $0.origIdx == idx }
                if let llmIdx = llmIdx, let r = llmResults[llmIdx] {
                    results.append(BatchResult(result: r, source: "api_batch"))
                    continue
                }
            }
            // LLM/免费词典均失败 → 本地降级
            let source = hasLLM ? "local_api_fail" : "local_no_api"
            results.append(BatchResult(result: row.joined, source: source))
        }
        return results
    }

    /// 同方向批量调 LLM；缺失结果降级为逐条翻译
    private func callGroup(_ group: [BatchItem], from: String, to: String) async -> [String?] {
        let (_, exactCase) = mergedWhitelistSets()
        let sourceName = from == "zh" ? "中文" : "西班牙语"
        let targetName = to == "zh" ? "中文" : "西班牙语"
        let whitelistStr = exactCase.joined(separator: ", ")

        let lines = group.enumerated().map { "[\($0.offset + 1)] \($0.element.text)" }
        let merged = lines.joined(separator: "\n")

        let batchPrompt =
            "请将以下多条文本从\(sourceName)翻译为\(targetName)。\n"
            + "规则：\n"
            + "1. 数字、货号、通用符号（× · + / , . 等）保持不变；\n"
            + "2. 以下词汇保持原文不翻译：\(whitelistStr)\n"
            + "3. 每条译文独占一行，以相同 [编号] 开头，格式：[编号]译文，不要解释、引号或多余内容；\n"
            + "4. 严格按编号顺序输出，数量必须与输入一致。\n\n"
            + "待翻译：\n\(merged)"

        var rough: [String?]
        let content = await chatCompletion(prompt: batchPrompt, maxTokens: 4096, temperature: 0.3)
        if let content = content {
            var resultMap: [Int: String] = [:]
            let regex = try? NSRegularExpression(pattern: #"\[(\d+)\]\s*([^\n]*)"#)
            let ns = content as NSString
            if let regex = regex {
                let matches = regex.matches(in: content, range: NSRange(location: 0, length: ns.length))
                for m in matches {
                    let num = Int(ns.substring(with: m.range(at: 1))) ?? 0
                    let trans = ns.substring(with: m.range(at: 2)).trimmingCharacters(in: .whitespacesAndNewlines)
                    if num >= 1 && num <= group.count { resultMap[num] = trans }
                }
            }
            let fallback = content.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            rough = group.indices.map { i -> String? in
                if let r = resultMap[i + 1] { return r }
                if fallback.count == group.count { return fallback[i] }
                return nil
            }
        } else {
            rough = Array<String?>(repeating: nil, count: group.count)
        }

        // 缺失项逐条重试
        if rough.contains(nil) {
            for (i, item) in group.enumerated() where rough[i] == nil {
                rough[i] = await translate(item.text, from: from, to: to)
            }
        }
        return rough
    }
}