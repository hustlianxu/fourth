import Foundation

// MARK: - 导出服务
//
// 对齐小程序 utils/exporter.js：
//   1. 翻译预处理：desEs/desZh 任一缺失时，依据文本真实语言自动翻译补全（两列共用批处理）；
//   2. 计算列宽与行高（图片按宽高比自适应）；
//   3. 生成真实 .xlsx（OOXML，图片原始字节嵌入，不压缩）写入应用导出目录。
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

    private init() {}

    // MARK: - 导出入口

    /// 导出记录为 .xlsx（含自动翻译补全）
    /// - Returns: 生成的文件 URL（位于应用 Documents/WatermarkCamera/exports/ 下）
    func exportToXlsx(records: [Record],
                      customFileName: String?,
                      onProgress: ((String) -> Void)? = nil) async throws -> URL {
        guard !records.isEmpty else {
            throw ExportServiceError.emptySelection
        }
        onProgress?("正在准备 \(records.count) 条记录...")

        // 1. 翻译预处理（不改动原记录，输出独立副本）
        let translated = await preTranslateRecords(records, onProgress: onProgress)

        // 2. 列宽 / 行高 / 图片显示高度
        let colWidths = calcColumnWidths(records: records)
        let rowHeights = translated.map { calcRowHeight($0) }
        let imgHeights = translated.map { calcImgDisplayH($0) }

        // 3. 扁平化记录（XlsxWriter 只读取各列 key）
        let flat = translated.map { rec -> [String: String] in
            var d: [String: String] = ["imagePath": rec.imagePath ?? ""]
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
        let sm = StorageManager.shared
        try XlsxWriter.write(records: flat,
                             columns: columns,
                             to: fileURL,
                             imageData: { rel -> Data? in
                                 guard let url = sm.url(forRelativePath: rel) else { return nil }
                                 return try? Data(contentsOf: url)
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

    // MARK: - 尺寸计算（对齐 exporter.js）

    private func calcImgDisplayH(_ rec: Record) -> Int {
        let w = Double(max(rec.width, 1))
        let h = Double(max(rec.height, 1))
        return Int((Double(imgCellW) * (h / w)).rounded())
    }

    private func calcRowHeight(_ rec: Record) -> Int {
        max(calcImgDisplayH(rec), minRowH) + rowPad
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