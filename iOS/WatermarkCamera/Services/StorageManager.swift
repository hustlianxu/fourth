import Foundation
import Combine
import UIKit

/// 本地存储层：记录 / 文件夹 / 回收站 / 自定义模板
///
/// 所有图像文件存放在应用沙盒 Documents/WatermarkCamera/records/{recordID}/ 下，
/// 不受微信小程序 200MB 配额限制，空间仅受手机总容量约束。
/// 元数据（记录、文件夹、回收站、自定义模板）以 JSON 文件持久化。
final class StorageManager: ObservableObject {
    static let shared = StorageManager()

    @Published private(set) var records: [Record] = []
    @Published private(set) var folders: [Folder] = []
    @Published private(set) var trash: [Record] = []
    @Published private(set) var customTemplates: [WatermarkTemplate] = []

    private let rootDir: URL
    private let recordsDir: URL
    private let exportsDir: URL
    private let indexURL: URL
    private let templatesURL: URL

    private struct IndexFile: Codable {
        var records: [Record]
        var folders: [Folder]
        var trash: [Record]
    }

    private init() {
        let base = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        rootDir = base.appendingPathComponent("WatermarkCamera", isDirectory: true)
        recordsDir = rootDir.appendingPathComponent("records", isDirectory: true)
        exportsDir = rootDir.appendingPathComponent("exports", isDirectory: true)
        indexURL = rootDir.appendingPathComponent("index.json")
        templatesURL = rootDir.appendingPathComponent("templates.json")
        try? FileManager.default.createDirectory(at: rootDir, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: recordsDir, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: exportsDir, withIntermediateDirectories: true)
        load()
    }

    // MARK: - 持久化

    private func load() {
        let decoder = JSONDecoder()
        if let data = try? Data(contentsOf: indexURL),
           let idx = try? decoder.decode(IndexFile.self, from: data) {
            records = idx.records
            folders = idx.folders
            trash = idx.trash
        }
        if let data = try? Data(contentsOf: templatesURL),
           let list = try? decoder.decode([WatermarkTemplate].self, from: data) {
            customTemplates = list
        }
    }

    private func save() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let idx = IndexFile(records: records, folders: folders, trash: trash)
        if let data = try? encoder.encode(idx) {
            try? data.write(to: indexURL, options: .atomic)
        }
    }

    private func saveTemplates() {
        let encoder = JSONEncoder()
        if let data = try? encoder.encode(customTemplates) {
            try? data.write(to: templatesURL, options: .atomic)
        }
    }

    // MARK: - 文件路径

    /// 记录所属目录（按 id 归档，删除/清空时整目录移除，无孤儿文件）
    func recordDir(for id: String) -> URL {
        recordsDir.appendingPathComponent(id, isDirectory: true)
    }

    /// 带水印图片的相对文件名
    static let wmFile = "wm.jpg"
    /// 干净原图相对文件名
    static let origFile = "orig.jpg"

    func imageFileURL(recordID: String, name: String) -> URL {
        recordDir(for: recordID).appendingPathComponent(name)
    }

    /// 从 Record.imagePath（相对路径）解析完整 URL
    func url(forRelativePath rel: String?) -> URL? {
        guard let rel = rel, !rel.isEmpty else { return nil }
        let url = recordsDir.appendingPathComponent(rel)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func image(for record: Record) -> UIImage? {
        guard let url = url(forRelativePath: record.imagePath) else { return nil }
        return UIImage(contentsOfFile: url.path)
    }

    func thumbnail(for record: Record, maxPixel: CGFloat = 600) -> UIImage? {
        guard let url = url(forRelativePath: record.imagePath),
              let full = UIImage(contentsOfFile: url.path) else { return nil }
        let scale = min(1, maxPixel / max(full.size.width, full.size.height))
        let size = CGSize(width: full.size.width * scale, height: full.size.height * scale)
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 1
        let renderer = UIGraphicsImageRenderer(size: size, format: fmt)
        return renderer.image { _ in full.draw(in: CGRect(origin: .zero, size: size)) }
    }

    // MARK: - 导出目录

    var exportsDirectory: URL { exportsDir }

    // MARK: - 记录 CRUD

    func addRecord(_ r: Record) {
        records.insert(r, at: 0)
        save()
    }

    func updateRecord(_ r: Record) {
        guard let i = records.firstIndex(where: { $0.id == r.id }) else { return }
        records[i] = r
        save()
    }

    func record(withID id: String) -> Record? {
        records.first(where: { $0.id == id })
    }

    func records(inFolder folderID: String?) -> [Record] {
        records.filter { $0.folderId == folderID }
    }

    // MARK: - 回收站

    func moveToTrash(_ id: String) {
        guard let i = records.firstIndex(where: { $0.id == id }) else { return }
        var r = records.remove(at: i)
        r.deletedAt = Date().timeIntervalSince1970
        trash.insert(r, at: 0)
        save()
    }

    func restoreFromTrash(_ id: String) {
        guard let i = trash.firstIndex(where: { $0.id == id }) else { return }
        var r = trash.remove(at: i)
        r.deletedAt = nil
        records.insert(r, at: 0)
        save()
    }

    /// 彻底删除（连同本地图片文件）
    func deletePermanently(_ id: String) {
        guard let i = trash.firstIndex(where: { $0.id == id }) else { return }
        let r = trash[i]
        FileManager.default.removeItemIfExists(recordDir(for: r.id))
        trash.remove(at: i)
        save()
    }

    func emptyTrash() {
        for r in trash {
            FileManager.default.removeItemIfExists(recordDir(for: r.id))
        }
        trash = []
        save()
    }

    /// 清理超过指定天数的回收站记录
    @discardableResult
    func cleanupTrash(days: Int = 30) -> Int {
        let cutoff = Date().timeIntervalSince1970 - Double(days) * 24 * 3600
        let expired = trash.filter { ($0.deletedAt ?? 0) <= cutoff }
        for r in expired {
            FileManager.default.removeItemIfExists(recordDir(for: r.id))
        }
        trash.removeAll { ($0.deletedAt ?? 0) <= cutoff }
        save()
        return expired.count
    }

    // MARK: - 文件夹

    func addFolder(name: String) -> Folder {
        var folder = Folder(id: genId(prefix: "f"), name: name.isEmpty ? "未命名" : name,
                            createdAt: Date().timeIntervalSince1970, updatedAt: Date().timeIntervalSince1970)
        folders.insert(folder, at: 0)
        save()
        return folder
    }

    func removeFolder(_ id: String) {
        folders.removeAll { $0.id == id }
        // 文件夹内记录移回未分类
        for i in records.indices where records[i].folderId == id {
            records[i].folderId = nil
        }
        save()
    }

    func countByFolder(_ folderID: String?) -> Int {
        records.filter { $0.folderId == folderID }.count
    }

    // MARK: - 自定义模板

    func saveCustomTemplate(_ tpl: WatermarkTemplate) {
        if let i = customTemplates.firstIndex(where: { $0.id == tpl.id }) {
            customTemplates[i] = tpl
        } else {
            customTemplates.insert(tpl, at: 0)
        }
        saveTemplates()
    }

    func deleteCustomTemplate(_ id: String) {
        customTemplates.removeAll { $0.id == id }
        if AppSettings.activeTemplateID == id {
            AppSettings.activeTemplateID = "handwrite"
        }
        saveTemplates()
    }

    // MARK: - 存储占用

    func totalStorageBytes() -> Int64 {
        var total: Int64 = 0
        FileManager.default.walkDirectory(recordsDir) { url in
            if let v = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? Int64 {
                total += v
            }
        }
        return total
    }
}

// MARK: - FileManager 辅助

extension FileManager {
    func removeItemIfExists(_ url: URL) {
        guard fileExists(atPath: url.path) else { return }
        try? removeItem(at: url)
    }

    func walkDirectory(_ dir: URL, body: (URL) -> Void) {
        guard let enumerator = enumerator(at: dir, includingPropertiesForKeys: [.isRegularFileKey]) else { return }
        for case let url as URL in enumerator where url.pathExtension.lowercased() != "json" {
            body(url)
        }
    }
}