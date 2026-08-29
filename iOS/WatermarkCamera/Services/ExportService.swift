import Foundation
import UIKit

// MARK: - 导出图片压缩选项

enum ExportImageCompression: String, CaseIterable, Identifiable {
    /// 原像素，不压缩（文件较大，iOS 端 Office 预览可能无法打开）
    case original
    /// 长宽各缩至 50%
    case half
    /// 长宽各缩至 25%
    case quarter
    /// 自动调整质量与尺寸，压缩至 1MB 以内（兼容性最好）
    case under1MB

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .original: return "原像素（不压缩）"
        case .half: return "50% 压缩"
        case .quarter: return "25% 压缩"
        case .under1MB: return "压缩至 1MB 内"
        }
    }

    /// 固定缩放系数（.original / .under1MB 无固定比例，返回 nil）
    var scaleFactor: CGFloat? {
        switch self {
        case .original, .under1MB: return nil
        case .half: return 0.5
        case .quarter: return 0.25
        }
    }

    /// 预估压缩后像素尺寸（用于 UI 展示；无固定比例的选项返回 nil）
    func estimatedSize(width: Int, height: Int) -> (w: Int, h: Int)? {
        guard let s = scaleFactor, width > 0, height > 0 else { return nil }
        return (max(1, Int(CGFloat(width) * s)), max(1, Int(CGFloat(height) * s)))
    }
}

// MARK: - 导出服务
//
// 对齐小程序 utils/exporter.js：
//   1. 翻译预处理：desEs/desZh 任一缺失时，依据文本真实语言自动翻译补全（两列共用批处理）；
//   2. 图片按所选压缩选项预处理（原像素 / 50% / 25% / 1MB 内），
//      行高与图片显示高度按压缩后尺寸计算；
//   3. 生成真实 .xlsx（OOXML，图片字节嵌入）写入应用导出目录。
// 导出的文件可经系统分享面板（文件 App / 微信 / 邮件等）分发。

final class ExportService {
    static let shared = ExportService()

    // 与小程序 COLUMNS 完全一致
    let columns: [XlsxWriter.Column] = [
        XlsxWriter.Column(key: "imagePath", header: "FOTO", isImage: true),
        XlsxWriter.Column(key: "modelo", header: "CODIGO", isImage: false),
        XlsxWriter.Column(key: "desEs", header: "DETALLADOS", isImage: false),
        XlsxWriter.Column(key: "desZh", header: "描述", isImage: false),
        XlsxWriter.Column(key: "precio", header: "PRECIO", isImage: false),
        XlsxWriter.Column(key: "pzs", header: "CANTIDAD DE CAJA", isImage: false),
        XlsxWriter.Column(key: "cajas", header: "CUANTAS CAJAS", isImage: false),
        XlsxWriter.Column(key: "volumen", header: "CUBICO", isImage: false),
        XlsxWriter.Column(key: "peso", header: "PESO", isImage: false),
    ]

    private let imgCellW = 220      // FOTO 列宽（px）
    private let minRowH = 60        // 最小行高（px）
    private let rowPad = 16         // 行高留白（px）
    private let charW = 9           // 中文字符估算宽（px）
    private let minColW = 60        // 列最小宽（px）

    /// 「压缩至 1MB 内」目标上限
    private let maxBytes = 1_000_000

    private init() {}

    // MARK: - 导出入口

    /// 导出记录为 .xlsx（含自动翻译补全）
    /// - Parameters:
    ///   - compression: 图片压缩选项（.original 时嵌入原始字节）
    /// - Returns: 生成的文件 URL（位于应用 Documents/WatermarkCamera/exports/ 下）
    func exportToXlsx(records: [Record],
                      customFileName: String?,
                      compression: ExportImageCompression = .under1MB,
                      onProgress: ((String) -> Void)? = nil) async throws -> URL {
        guard !records.isEmpty else {
            throw ExportServiceError.emptySelection
        }
        onProgress?("正在准备 \(records.count) 条记录...")

        // 1. 翻译预处理（不改动原记录，输出独立副本）
        let translated = await preTranslateRecords(records, onProgress: onProgress)

        // 2. 图片压缩预处理（得到嵌入字节与压缩后尺寸）
        onProgress?("正在处理图片（\(compression.displayName)）...")
        let processed = preprocessImages(translated, compression: compression)
        var imageDataMap: [String: Data] = [:]
        for p in processed {
            if let d = p.data, !d.isEmpty {
                imageDataMap[p.rel] = d
            }
        }

        // 3. 列宽 / 行高 / 图片显示高度（按压缩后尺寸）
        let colWidths = calcColumnWidths(records: records)
        let rowHeights = processed.map { calcRowHeight(w: $0.w, h: $0.h) }
        let imgHeights = processed.map { calcImgDisplayH(w: $0.w, h: $0.h) }

        // 4. 扁平化记录（XlsxWriter 只读取各列 key）
        let flat = translated.map { rec -> [String: String] in
            var d: [String: String] = ["imagePath": rec.imagePath]
            for col in columns where !col.isImage {
                d[col.key] = rec.values[col.key] ?? ""
            }
            return d
        }

        let baseName = sanitizeFileName(customFileName ?? "")
        let fileName = baseName + ".xlsx"
        let fileURL = StorageManager.shared.exportsDirectory.appendingPathComponent(fileName)
        try? FileManager.default.removeItem(at: fileURL)

        onProgress?("正在生成 Excel 文件...")
        try XlsxWriter.write(records: flat,
                             columns: columns,
                             to: fileURL,
                             imageData: { rel -> Data? in
                                 imageDataMap[rel]
                             },
                             rowHeights: rowHeights,
                             imgDisplayHeights: imgHeights,
                             columnWidths: colWidths,
                             imgColWidth: imgCellW)

        onProgress?("导出完成：\(fileName)")
        return fileURL
    }

    // MARK: - 翻译预处理

    /// 翻译预处理：desEs/desZh 空缺时按文本真实语言自动补全
    /// 返回翻译后的记录副本（原记录不变）
    private func preTranslateRecords(_ records: [Record],
                                     onProgress: ((String) -> Void)?) async -> [Record] {
        var copies = records.map { rec in
            var r = rec
            r.values = rec.values
            return r
        }

        struct Task {
            var recordIdx: Int
            var from: String
            var to: String
            var text: String
            var fillTo: String
            var moveOriginalTo: String?
            var original: String
        }
        var tasks: [Task] = []
        for (i, rec) in copies.enumerated() {
            let desEs = (rec.values["desEs"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let desZh = (rec.values["desZh"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

            if !desEs.isEmpty && desZh.isEmpty {
                let lang = TranslatorService.shared.detectLang(desEs)
                if lang == "zh" {
                    tasks.append(Task(recordIdx: i, from: "zh", to: "es", text: desEs,
                                      fillTo: "desEs", moveOriginalTo: "desZh", original: desEs))
                } else if lang == "es" {
                    tasks.append(Task(recordIdx: i, from: "es", to: "zh", text: desEs,
                                      fillTo: "desZh", moveOriginalTo: nil, original: desEs))
                }
            } else if !desZh.isEmpty && desEs.isEmpty {
                let lang = TranslatorService.shared.detectLang(desZh)
                if lang == "zh" {
                    tasks.append(Task(recordIdx: i, from: "zh", to: "es", text: desZh,
                                      fillTo: "desEs", moveOriginalTo: nil, original: desZh))
                } else if lang == "es" {
                    tasks.append(Task(recordIdx: i, from: "es", to: "zh", text: desZh,
                                      fillTo: "desZh", moveOriginalTo: "desEs", original: desZh))
                }
            }
        }

        guard !tasks.isEmpty else { return copies }
        onProgress?("批量翻译 \(tasks.count) 条描述...")

        let items = tasks.map { TranslatorService.BatchItem(text: $0.text, from: $0.from, to: $0.to) }
        let results = await TranslatorService.shared.translateBatch(items)
        for (idx, r) in results.enumerated() {
            let t = tasks[idx]
            guard !r.result.isEmpty else { continue }
            let source = r.source
            let translated = source != "local_no_api" && source != "local_api_fail"
            var rec = copies[t.recordIdx]
            if translated {
                rec.values[t.fillTo] = r.result
                if let moveTo = t.moveOriginalTo {
                    rec.values[moveTo] = t.original
                }
            } else if let moveTo = t.moveOriginalTo {
                rec.values[t.fillTo] = ""
                rec.values[moveTo] = t.original
            }
            copies[t.recordIdx] = rec
        }
        return copies
    }

    // MARK: - 图片压缩预处理

    /// 预处理结果：嵌入字节 + 压缩后尺寸
    struct ProcessedImage {
        var rel: String
        var data: Data?
        var w: Int
        var h: Int
    }

    /// 按压缩选项逐张处理图片（在后台执行，避免阻塞主线程）
    private func preprocessImages(_ records: [Record],
                                  compression: ExportImageCompression) -> [ProcessedImage] {
        let sm = StorageManager.shared
        var out: [ProcessedImage] = []
        out.reserveCapacity(records.count)

        for rec in records {
            let rel = rec.imagePath
            // 图片不可读：保留记录（无图），尺寸沿用记录值
            guard !rel.isEmpty, let url = sm.url(forRelativePath: rel) else {
                out.append(ProcessedImage(rel: rel, data: nil, w: max(rec.width, 1), h: max(rec.height, 1)))
                continue
            }

            // 原像素：直接嵌入原始字节
            if compression == .original {
                let data = try? Data(contentsOf: url)
                out.append(ProcessedImage(rel: rel, data: data,
                                          w: max(rec.width, 1), h: max(rec.height, 1)))
                continue
            }

            guard let img = UIImage(contentsOfFile: url.path) else {
                // 解码失败兜底：嵌入原始字节
                let data = try? Data(contentsOf: url)
                out.append(ProcessedImage(rel: rel, data: data,
                                          w: max(rec.width, 1), h: max(rec.height, 1)))
                continue
            }

            switch compression {
            case .half, .quarter:
                let s = compression.scaleFactor ?? 1
                let resized = Self.resize(img, scale: s)
                let data = resized.jpegData(compressionQuality: 0.85)
                out.append(ProcessedImage(rel: rel, data: data,
                                          w: Int(resized.size.width.rounded()),
                                          h: Int(resized.size.height.rounded())))
            case .under1MB:
                let (data, size) = Self.encodeUnder1MB(img, maxBytes: maxBytes)
                out.append(ProcessedImage(rel: rel, data: data,
                                          w: Int(size.width.rounded()),
                                          h: Int(size.height.rounded())))
            case .original:
                fatalError("unreachable")
            }
        }
        return out
    }

    /// 等比缩放（scale = 目标尺寸 / 原尺寸）
    private static func resize(_ image: UIImage, scale: CGFloat) -> UIImage {
        guard scale > 0, scale < 1, image.size.width > 0, image.size.height > 0 else { return image }
        let size = CGSize(width: max(1, image.size.width * scale),
                          height: max(1, image.size.height * scale))
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    /// 先原尺寸降质量，仍超上限再逐步缩小尺寸，直至小于 maxBytes
    private static func encodeUnder1MB(_ image: UIImage,
                                       maxBytes: Int) -> (Data?, CGSize) {
        var quality: CGFloat = 0.8
        var data = image.jpegData(compressionQuality: quality)
        var current = image

        // 第一步：仅降质量（0.8 → 0.3）
        while let d = data, d.count > maxBytes, quality > 0.3 {
            quality = max(0.3, quality - 0.15)
            data = current.jpegData(compressionQuality: quality)
        }

        // 第二步：降质量仍超限，逐步缩小尺寸（每次 ×0.8，最小 0.2 倍）
        var scale: CGFloat = 1
        while let d = data, d.count > maxBytes, scale > 0.2 {
            scale *= 0.8
            current = resize(image, scale: scale)
            data = current.jpegData(compressionQuality: quality)
        }

        return (data, current.size)
    }

    // MARK: - 尺寸计算（对齐 exporter.js）

    private func calcImgDisplayH(w: Int, h: Int) -> Int {
        let w = Double(max(w, 1))
        let h = Double(max(h, 1))
        return Int((Double(imgCellW) * (h / w)).rounded())
    }

    private func calcRowHeight(w: Int, h: Int) -> Int {
        max(calcImgDisplayH(w: w, h: h), minRowH) + rowPad
    }

    private func calcColumnWidths(records: [Record]) -> [String: Int] {
        var widths: [String: Int] = [:]
        for col in columns {
            if col.isImage {
                widths[col.key] = imgCellW
                continue
            }
            var maxLen = col.header.count
            for rec in records {
                let v = (rec.values[col.key] ?? "").count
                if v > maxLen { maxLen = v }
            }
            widths[col.key] = max(maxLen * charW + 24, minColW)
        }
        return widths
    }
}

enum ExportServiceError: LocalizedError {
    case emptySelection

    var errorDescription: String? {
        switch self {
        case .emptySelection: return "没有选中任何记录"
        }
    }
}