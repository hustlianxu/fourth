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

struct TranslationAPIConfig: Codable, Hashable {
    var provider: String = "deepseek"
    var baseURL: String = ""
    var model: String = ""
    var apiKey: String = ""
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
    static var apiConfig: TranslationAPIConfig {
        get {
            guard let data = defaults.data(forKey: "translator_api_config"),
                  let cfg = try? JSONDecoder().decode(TranslationAPIConfig.self, from: data)
            else { return TranslationAPIConfig() }
            return cfg
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) {
                defaults.set(data, forKey: "translator_api_config")
            }
        }
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