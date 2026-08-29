import Foundation
import UIKit

// MARK: - 字段类型

enum FieldType: String, Codable, CaseIterable, Identifiable {
    case text
    case textarea
    case date
    case datetime
    case time
    case select

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .text: return "单行文本"
        case .textarea: return "多行文本"
        case .date: return "日期"
        case .datetime: return "日期时间"
        case .time: return "时间"
        case .select: return "单选"
        }
    }
}

// MARK: - 模板

struct TemplateField: Codable, Hashable, Identifiable {
    var key: String
    var label: String
    var type: FieldType = .text
    var placeholder: String?
    var options: [String]?
    var required: Bool = false
    var multiline: Bool = false
    var defaultValue: String?

    var id: String { key }
}

struct TemplateStyle: Codable, Hashable {
    var fontSize: Double = 22
    var colorHex: String = "#ffffff"
    var backgroundRGBA: String = "rgba(0,0,0,0.70)"
    var padding: Double = 14
    var borderRadius: Double = 10
    var lineHeight: Double = 1.35
}

struct WatermarkTemplate: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var desc: String?
    var isBuiltin: Bool
    var position: String = "bottom-center"
    var widthRatio: Double = 0.42
    var style: TemplateStyle = TemplateStyle()
    var fields: [TemplateField] = []
}

// MARK: - 记录与文件夹

struct Record: Codable, Hashable, Identifiable {
    var id: String
    var folderId: String?
    var customName: String?
    var createdAt: TimeInterval
    var updatedAt: TimeInterval
    var imagePath: String          // 相对文件名（如 202608291200/wm.jpg），配合 StorageManager 定位
    var originalPath: String?      // 干净原图相对文件名
    var width: Int
    var height: Int
    var values: [String: String] = [:]
    var deletedAt: TimeInterval?   // 非 nil => 在回收站
    // 水印上下文（详情编辑后可按原位置/原模板重渲染图片）
    // 旧记录缺失时解码为 nil，向后兼容
    var wmTemplateID: String?
    var wmPlacement: OverlayPlacement?
}

struct Folder: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var createdAt: TimeInterval
    var updatedAt: TimeInterval
}

// MARK: - 词典 / 翻译配置

struct DictEntry: Codable, Hashable, Identifiable {
    var id: String
    var zh: String
    var es: String
}

struct TranslationAPIConfig: Codable, Hashable, Identifiable {
    var id: String = UUID().uuidString
    var provider: String = "deepseek"
    var baseURL: String = ""
    var model: String = ""
    var apiKey: String = ""

    /// 列表显示名（如 "deepseek · deepseek-chat"）
    var displayName: String {
        let p = provider.isEmpty ? "自定义" : provider
        return model.isEmpty ? p : "\(p) · \(model)"
    }

    /// 密钥是否已配置（列表里避免明文展示 key）
    var hasKey: Bool { !apiKey.trimmingCharacters(in: .whitespaces).isEmpty }

    init(provider: String = "deepseek",
         baseURL: String = "",
         model: String = "",
         apiKey: String = "") {
        self.id = UUID().uuidString
        self.provider = provider
        self.baseURL = baseURL
        self.model = model
        self.apiKey = apiKey
    }

    // 兼容旧版存储（无 id / 字段缺失时不解码失败）
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        provider = try c.decodeIfPresent(String.self, forKey: .provider) ?? "deepseek"
        baseURL = try c.decodeIfPresent(String.self, forKey: .baseURL) ?? ""
        model = try c.decodeIfPresent(String.self, forKey: .model) ?? ""
        apiKey = try c.decodeIfPresent(String.self, forKey: .apiKey) ?? ""
    }
}

struct FreeDictConfig: Codable, Hashable {
    var enabled: Bool = false
    var provider: String = "" // "mymemory" | ""
}

// MARK: - 应用级 UserDefaults 设置

enum AppSettings {
    private static let defaults = UserDefaults.standard

    // 当前使用的模板 id
    static var activeTemplateID: String {
        get { defaults.string(forKey: "active_template_id") ?? "handwrite" }
        set { defaults.set(newValue, forKey: "active_template_id") }
    }

    // 拍摄后自动保存到系统相册
    static var autoSaveAlbum: Bool {
        get { defaults.bool(forKey: "auto_save_album") }
        set { defaults.set(newValue, forKey: "auto_save_album") }
    }

    // 编辑保存时自动保存水印图到系统相册
    static var autoSaveEditAlbum: Bool {
        get { defaults.bool(forKey: "auto_save_edit_album") }
        set { defaults.set(newValue, forKey: "auto_save_edit_album") }
    }

    // ===== 翻译引擎 =====

    /// 已保存的多个大模型接口配置（多服务商 / 多密钥）
    static var apiConfigs: [TranslationAPIConfig] {
        get {
            if let data = defaults.data(forKey: "translator_api_configs"),
               let list = try? JSONDecoder().decode([TranslationAPIConfig].self, from: data) {
                return list
            }
            // 旧版单配置迁移
            if let data = defaults.data(forKey: "translator_api_config"),
               let cfg = try? JSONDecoder().decode(TranslationAPIConfig.self, from: data),
               !cfg.baseURL.trimmingCharacters(in: .whitespaces).isEmpty {
                return [cfg]
            }
            return []
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) {
                defaults.set(data, forKey: "translator_api_configs")
            }
        }
    }

    /// 当前激活的配置 id
    static var activeAPIConfigID: String {
        get { defaults.string(forKey: "translator_active_api_config") ?? "" }
        set { defaults.set(newValue, forKey: "translator_active_api_config") }
    }

    /// 翻译引擎实际使用的配置（激活项；无激活则取第一个）
    static var apiConfig: TranslationAPIConfig {
        let list = apiConfigs
        if let cfg = list.first(where: { $0.id == activeAPIConfigID }) { return cfg }
        return list.first ?? TranslationAPIConfig()
    }

    static var freeDictConfig: FreeDictConfig {
        get {
            guard let data = defaults.data(forKey: "translator_free_dict"),
                  let cfg = try? JSONDecoder().decode(FreeDictConfig.self, from: data)
            else { return FreeDictConfig() }
            return cfg
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) {
                defaults.set(data, forKey: "translator_free_dict")
            }
        }
    }

    // LLM 优先模式：跳过本地匹配直接调 LLM
    static var llmFirst: Bool {
        get { defaults.bool(forKey: "translator_llm_first") }
        set { defaults.set(newValue, forKey: "translator_llm_first") }
    }

    // ===== 自定义词典 / 白名单 =====
    static var customDict: [DictEntry] {
        get {
            guard let data = defaults.data(forKey: "custom_dict"),
                  let list = try? JSONDecoder().decode([DictEntry].self, from: data)
            else { return [] }
            return list
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) {
                defaults.set(data, forKey: "custom_dict")
            }
        }
    }

    static var customWhitelist: [String] {
        get { defaults.stringArray(forKey: "custom_whitelist") ?? [] }
        set { defaults.set(newValue, forKey: "custom_whitelist") }
    }

    // 版本号
    static var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
    }
}

// MARK: - 工具

func genId(prefix: String = "p") -> String {
    let ts = Int(Date().timeIntervalSince1970 * 1000)
    let rand = String(Int.random(in: 0...0xFFFFFF), radix: 36)
    return "\(prefix)_\(ts)_\(rand)"
}

func sanitizeFileName(_ name: String) -> String {
    let cleaned = name
        .replacingOccurrences(of: "[\\/\\\\:*?\"<>|]", with: "_", options: .regularExpression)
        .replacingOccurrences(of: "\\s+", with: "_", options: .regularExpression)
    let trimmed = String(cleaned.prefix(50))
    return trimmed.isEmpty ? "export_\(Int(Date().timeIntervalSince1970))" : trimmed
}

func xmlEscape(_ s: String?) -> String {
    guard let s = s else { return "" }
    return s
        .replacingOccurrences(of: "&", with: "&amp;")
        .replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;")
        .replacingOccurrences(of: "\"", with: "&quot;")
        .replacingOccurrences(of: "'", with: "&apos;")
}

/// Excel 列号转列字母（0→A, 25→Z, 26→AA）
func colLetter(_ idx: Int) -> String {
    var s = ""
    var n = idx
    while true {
        s = String(UnicodeScalar(65 + (n % 26))!) + s
        n = n / 26 - 1
        if n < 0 { break }
    }
    return s
}

func formatDateTime(_ date: Date) -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd HH:mm:ss"
    return f.string(from: date)
}