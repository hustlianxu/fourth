import Foundation

// MARK: - 真实 .xlsx 生成器（OOXML，图片字节嵌入）
//
// 为保证 iOS「文件/微信预览」（OfficeImportErrorDomain 912）与桌面 WPS/Office
// 的兼容性，生成流程为：
//   1. 先把全部 OOXML 部件（含 docProps 元数据）与图片字节写入临时目录；
//   2. 用内置 ZipStoreWriter 直接打包（STORE 模式、合法 DOS 时间戳、
//      [Content_Types].xml 排序后位于包首）。
//      不再用 NSFileCoordinator 系统 zip：其对目录打包的条目顺序/前缀随
//      系统版本不确定，而自写写入器的每个字节都已用标准解析器逐字节验证，
//      输出完全确定。
//
// 包结构：[Content_Types].xml / _rels/.rels / docProps/{app,core}.xml
//   xl/workbook.xml / xl/_rels/workbook.xml.rels / xl/styles.xml
//   xl/worksheets/sheet1.xml / xl/worksheets/_rels/sheet1.xml.rels
//   xl/drawings/drawing1.xml / xl/drawings/_rels/drawing1.xml.rels / xl/media/imageN.jpeg
// 文本使用 inlineStr 避免 sharedStrings；文本格式样式防止长数字变科学计数。

enum XlsxWriter {

    struct Column {
        var key: String
        var header: String
        var isImage: Bool
    }

    private struct ImageEntry {
        var rId: String
        var idx: Int
        var recordIdx: Int
        var data: Data
    }

    /// 构建 .xlsx 并写入指定路径
    /// - Parameters:
    ///   - records: 扁平化记录字典数组（含 imagePath/width/height/各字段值）
    ///   - columns: 列定义
    ///   - fileURL: 输出文件路径
    ///   - imageData: 从相对路径取图片二进制（nil 表示缺失则跳过该图）
    ///   - rowHeights: 各记录行高（px），与 records 顺序一致
    ///   - imgDisplayHeights: 各记录图片显示高度（px），与 records 顺序一致
    ///   - columnWidths: 各列像素宽度 {key: px}
    ///   - imgColWidth: 图片列像素宽度
    static func write(records: [[String: String]],
                      columns: [Column],
                      to fileURL: URL,
                      imageData: (String) -> Data?,
                      rowHeights: [Int],
                      imgDisplayHeights: [Int],
                      columnWidths: [String: Int],
                      imgColWidth: Int) throws {
        // 1. 收集图片（一次性读入：收集与写入阶段共享同一份字节，
        //    避免两次读取结果不一致导致 drawing 引用不存在的 media 部件）
        var imageEntries: [ImageEntry] = []
        for (i, rec) in records.enumerated() {
            let path = rec["imagePath"] ?? ""
            guard !path.isEmpty, let d = imageData(path), !d.isEmpty else { continue }
            let idx = imageEntries.count + 1
            imageEntries.append(ImageEntry(rId: "rId\(idx)", idx: idx, recordIdx: i, data: d))
        }

        // 2. 临时目录构建 OOXML 包
        let tmpRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("xlsx-build-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.removeItem(at: tmpRoot)
        try FileManager.default.createDirectory(at: tmpRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmpRoot) }

        try writePart("[Content_Types].xml", contentTypesXML, at: tmpRoot)
        try writePart("_rels/.rels", rootRelsXML, at: tmpRoot)
        try writePart("docProps/app.xml", appXML, at: tmpRoot)
        try writePart("docProps/core.xml", coreXML, at: tmpRoot)
        try writePart("xl/workbook.xml", workbookXML, at: tmpRoot)
        try writePart("xl/_rels/workbook.xml.rels", workbookRelsXML, at: tmpRoot)
        try writePart("xl/styles.xml", stylesXML, at: tmpRoot)
        try writePart("xl/worksheets/sheet1.xml",
                      sheetXML(records: records,
                               columns: columns,
                               imageCount: imageEntries.count,
                               rowHeights: rowHeights,
                               columnWidths: columnWidths),
                      at: tmpRoot)

        if !imageEntries.isEmpty {
            try writePart("xl/worksheets/_rels/sheet1.xml.rels", sheetRelsXML, at: tmpRoot)
            try writePart("xl/drawings/drawing1.xml",
                          drawingXML(imageEntries: imageEntries,
                                     imgDisplayHeights: imgDisplayHeights,
                                     imgColWidth: imgColWidth),
                          at: tmpRoot)
            try writePart("xl/drawings/_rels/drawing1.xml.rels",
                          drawingRelsXML(imageEntries: imageEntries),
                          at: tmpRoot)
            for ie in imageEntries {
                try writeBinary("xl/media/image\(ie.idx).jpeg", ie.data, at: tmpRoot)
            }
        }

        // 3. 打包：自写 ZIP 写入器（STORE 模式；[Content_Types].xml 排序后天然位于包首）
        try? FileManager.default.removeItem(at: fileURL)
        try storeZipDirectory(tmpRoot, to: fileURL)
    }

    // MARK: - XML 部件

    private static var contentTypesXML: String {
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
        + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
        + "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
        + "<Default Extension=\"jpeg\" ContentType=\"image/jpeg\"/>"
        + "<Default Extension=\"jpg\" ContentType=\"image/jpeg\"/>"
        + "<Default Extension=\"png\" ContentType=\"image/png\"/>"
        + "<Default Extension=\"gif\" ContentType=\"image/gif\"/>"
        + "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>"
        + "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
        + "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>"
        + "<Override PartName=\"/xl/drawings/drawing1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.drawing+xml\"/>"
        + "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>"
        + "<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>"
        + "</Types>"
    }

    private static var rootRelsXML: String {
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>"
        + "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>"
        + "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/>"
        + "</Relationships>"
    }

    private static var appXML: String {
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\">"
        + "<Application>WatermarkCamera</Application>"
        + "</Properties>"
    }

    private static var coreXML: String {
        let iso = ISO8601DateFormatter().string(from: Date())
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
            + "<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" "
            + "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" "
            + "xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">"
            + "<dc:creator>WatermarkCamera</dc:creator>"
            + "<dcterms:created xsi:type=\"dcterms:W3CDTF\">\(iso)</dcterms:created>"
            + "<dcterms:modified xsi:type=\"dcterms:W3CDTF\">\(iso)</dcterms:modified>"
            + "</cp:coreProperties>"
    }

    private static var workbookXML: String {
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" "
        + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">"
        + "<bookViews><workbookView activeTab=\"0\"/></bookViews>"
        + "<sheets><sheet name=\"Sheet1\" sheetId=\"1\" r:id=\"rId1\"/></sheets>"
        + "</workbook>"
    }

    private static var workbookRelsXML: String {
        // drawing 是 worksheet 级关系（在 sheet1.xml.rels 中声明），
        // 不能出现在 workbook 级 rels —— 无效关系会导致 Excel 报
        // OfficeImportErrorDomain 912
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>"
        + "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>"
        + "</Relationships>"
    }

    private static var stylesXML: String {
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
        + "<numFmts count=\"1\"><numFmt numFmtId=\"164\" formatCode=\"@\"/></numFmts>"
        + "<fonts count=\"2\">"
        + "<font><sz val=\"11\"/><name val=\"Calibri\"/></font>"
        + "<font><b/><sz val=\"11\"/><color rgb=\"FFFFFFFF\"/><name val=\"Calibri\"/></font>"
        + "</fonts>"
        + "<fills count=\"3\">"
        + "<fill><patternFill patternType=\"none\"/></fill>"
        + "<fill><patternFill patternType=\"gray125\"/></fill>"
        + "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF4472C4\"/><bgColor indexed=\"64\"/></patternFill></fill>"
        + "</fills>"
        + "<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>"
        + "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>"
        + "<cellXfs count=\"3\">"
        + "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"0\"/>"
        + "<xf numFmtId=\"164\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyAlignment=\"1\">"
        + "<alignment vertical=\"center\" wrapText=\"1\"/>"
        + "</xf>"
        + "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"2\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\">"
        + "<alignment horizontal=\"center\" vertical=\"center\"/>"
        + "</xf>"
        + "</cellXfs>"
        + "<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>"
        + "</styleSheet>"
    }

    private static var sheetRelsXML: String {
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        + "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing\" Target=\"../drawings/drawing1.xml\"/>"
        + "</Relationships>"
    }

    private static func sheetXML(records: [[String: String]],
                                 columns: [Column],
                                 imageCount: Int,
                                 rowHeights: [Int],
                                 columnWidths: [String: Int]) -> String {
        func pxToRowHeight(_ px: Int) -> Int { Int((Double(px) * 0.75).rounded()) }

        var p: [String] = []
        p.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
            + "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" "
            + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">")
        p.append("<cols>")
        for (i, col) in columns.enumerated() {
            let w = columnWidths[col.key] ?? 80
            let cw = max(8, Int((Double(w) / 7).rounded()))
            p.append("<col min=\"\(i + 1)\" max=\"\(i + 1)\" width=\"\(cw)\" customWidth=\"1\"/>")
        }
        p.append("</cols>")
        p.append("<sheetData>")

        // 表头行
        p.append("<row r=\"1\" ht=\"\(pxToRowHeight(28))\" customHeight=\"1\">")
        for (i, col) in columns.enumerated() {
            p.append("<c r=\"\(colLetter(i))1\" s=\"2\" t=\"inlineStr\"><is><t>\(xmlEscape(col.header))</t></is></c>")
        }
        p.append("</row>")

        // 数据行
        for (ri, rec) in records.enumerated() {
            let rowH = rowHeights.isEmpty ? 60 : rowHeights[ri]
            let rowIdx = ri + 2
            p.append("<row r=\"\(rowIdx)\" ht=\"\(pxToRowHeight(rowH))\" customHeight=\"1\">")
            for (ci, col) in columns.enumerated() {
                let cellRef = colLetter(ci) + "\(rowIdx)"
                if col.isImage {
                    p.append("<c r=\"\(cellRef)\" s=\"1\"/>")
                } else {
                    let val = rec[col.key] ?? ""
                    p.append("<c r=\"\(cellRef)\" s=\"1\" t=\"inlineStr\"><is><t xml:space=\"preserve\">\(xmlEscape(val))</t></is></c>")
                }
            }
            p.append("</row>")
        }
        p.append("</sheetData>")

        if imageCount > 0 {
            p.append("<drawing r:id=\"rId3\"/>")
        }
        p.append("</worksheet>")
        return p.joined()
    }

    private static func drawingXML(imageEntries: [ImageEntry],
                                   imgDisplayHeights: [Int],
                                   imgColWidth: Int) -> String {
        let EMU_PER_PX = 9525
        let IMG_COL = 0

        var p: [String] = []
        p.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
            + "<xdr:wsDr xmlns:xdr=\"http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing\" "
            + "xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" "
            + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">")
        for (i, ie) in imageEntries.enumerated() {
            let imgH = imgDisplayHeights.indices.contains(ie.recordIdx)
                ? max(imgDisplayHeights[ie.recordIdx], 1) : 1
            let rowIdx = ie.recordIdx + 2
            p.append("<xdr:twoCellAnchor>")
            p.append("<xdr:from><xdr:col>\(IMG_COL)</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>\(rowIdx - 1)</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>")
            p.append("<xdr:to><xdr:col>\(IMG_COL + 1)</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>\(rowIdx)</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>")
            p.append("<xdr:pic>")
            p.append("<xdr:nvPicPr><xdr:cNvPr id=\"\(i + 1)\" name=\"Image \(i + 1)\"/><xdr:cNvPicPr/></xdr:nvPicPr>")
            p.append("<xdr:blipFill><a:blip r:embed=\"\(ie.rId)\"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>")
            p.append("<xdr:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"\(imgColWidth * EMU_PER_PX)\" cy=\"\(imgH * EMU_PER_PX)\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></xdr:spPr>")
            p.append("</xdr:pic>")
            p.append("<xdr:clientData/>")
            p.append("</xdr:twoCellAnchor>")
        }
        p.append("</xdr:wsDr>")
        return p.joined()
    }

    private static func drawingRelsXML(imageEntries: [ImageEntry]) -> String {
        var p: [String] = []
        p.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
            + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">")
        for ie in imageEntries {
            p.append("<Relationship Id=\"\(ie.rId)\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/image\(ie.idx).jpeg\"/>")
        }
        p.append("</Relationships>")
        return p.joined()
    }

    // MARK: - 文件写入

    private static func writePart(_ path: String, _ content: String, at root: URL) throws {
        guard let data = content.data(using: .utf8) else {
            throw ExportError.invalidEncoding(path)
        }
        try writeBinary(path, data, at: root)
    }

    private static func writeBinary(_ path: String, _ data: Data, at root: URL) throws {
        let url = root.appendingPathComponent(path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }

    // MARK: - 打包

    /// STORE 模式写 ZIP（[Content_Types].xml 排序后天然排在首位）
    private static func storeZipDirectory(_ src: URL, to dest: URL) throws {
        try? FileManager.default.removeItem(at: dest)
        let zip = try ZipStoreWriter(fileURL: dest)
        let prefix = src.path + "/"
        for file in try allFiles(under: src).sorted(by: { $0.path < $1.path }) {
            let rel = file.path.hasPrefix(prefix)
                ? String(file.path.dropFirst(prefix.count)) : file.lastPathComponent
            try zip.addEntry(named: rel, fromFile: file)
        }
        try zip.finish()
    }

    private static func allFiles(under dir: URL) throws -> [URL] {
        var out: [URL] = []
        let items = (try? FileManager.default.contentsOfDirectory(at: dir,
                                                                  includingPropertiesForKeys: [.isDirectoryKey])) ?? []
        for item in items {
            var isDir: ObjCBool = false
            if FileManager.default.fileExists(atPath: item.path, isDirectory: &isDir), isDir.boolValue {
                out.append(contentsOf: try allFiles(under: item))
            } else {
                out.append(item)
            }
        }
        return out
    }
}
