import Foundation

// MARK: - 真实 .xlsx 生成器（OOXML，图片原始字节嵌入）
//
// 移植自小程序 utils/xlsx-writer.js，输出结构完全一致：
//   [Content_Types].xml / _rels/.rels / xl/workbook.xml / xl/_rels/workbook.xml.rels
//   xl/styles.xml / xl/worksheets/sheet1.xml / xl/worksheets/_rels/sheet1.xml.rels
//   xl/drawings/drawing1.xml / xl/drawings/_rels/drawing1.xml.rels / xl/media/imageN.jpg
// 文本使用 inlineStr 避免 sharedStrings；数字列使用文本格式防止科学计数。

enum XlsxWriter {

    struct Column {
        var key: String
        var header: String
        var isImage: Bool
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
        // 收集图片元数据（不预读字节，写入阶段逐个读取）
        struct ImageEntry {
            var rId: String
            var idx: Int
            var recordIdx: Int
            var ext: String
        }
        var imageEntries: [ImageEntry] = []
        var imgIdx = 0
        for (i, rec) in records.enumerated() where !(rec["imagePath"] ?? "").isEmpty {
            imgIdx += 1
            imageEntries.append(ImageEntry(rId: "rId\(imgIdx)", idx: imgIdx, recordIdx: i, ext: "jpeg"))
        }

        let zip = try ZipStoreWriter(fileURL: fileURL)

        // ===== 1. [Content_Types].xml =====
        let contentTypes =
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
            + "</Types>"
        try zip.addEntry(named: "[Content_Types].xml", string: contentTypes)

        // ===== 2. _rels/.rels =====
        let rootRels =
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
            + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
            + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>"
            + "</Relationships>"
        try zip.addEntry(named: "_rels/.rels", string: rootRels)

        // ===== 3. xl/workbook.xml =====
        let workbook =
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
            + "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" "
            + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">"
            + "<sheets><sheet name=\"Sheet1\" sheetId=\"1\" r:id=\"rId1\"/></sheets>"
            + "</workbook>"
        try zip.addEntry(named: "xl/workbook.xml", string: workbook)

        // ===== 4. xl/_rels/workbook.xml.rels =====
        let wbRels =
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
            + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
            + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>"
            + "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>"
            + "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing\" Target=\"../drawings/drawing1.xml\"/>"
            + "</Relationships>"
        try zip.addEntry(named: "xl/_rels/workbook.xml.rels", string: wbRels)

        // ===== 5. xl/styles.xml =====
        let styles =
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
        try zip.addEntry(named: "xl/styles.xml", string: styles)

        // ===== 6. xl/worksheets/sheet1.xml =====
        func pxToRowHeight(_ px: Int) -> Int { Int((Double(px) * 0.75).rounded()) }
        let IMG_COL = 0
        let rowHeightCache = rowHeights.isEmpty ? records.map { _ in 60 } : rowHeights
        let imgHCache = imgDisplayHeights.isEmpty ? records.map { _ in 0 } : imgDisplayHeights

        var sheetParts: [String] = []
        sheetParts.append(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
            + "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" "
            + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" "
            + "xmlns:xdr=\"http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing\">")
        sheetParts.append("<cols>")
        for (i, col) in columns.enumerated() {
            let w = columnWidths[col.key] ?? 80
            let cw = max(8, Int((Double(w) / 7).rounded()))
            sheetParts.append("<col min=\"\(i + 1)\" max=\"\(i + 1)\" width=\"\(cw)\" customWidth=\"1\"/>")
        }
        sheetParts.append("</cols>")
        sheetParts.append("<sheetData>")

        // 表头行
        sheetParts.append("<row r=\"1\" ht=\"\(pxToRowHeight(28))\" customHeight=\"1\">")
        for (i, col) in columns.enumerated() {
            let cellRef = colLetter(i) + "1"
            sheetParts.append("<c r=\"\(cellRef)\" s=\"2\" t=\"inlineStr\"><is><t>\(xmlEscape(col.header))</t></is></c>")
        }
        sheetParts.append("</row>")

        // 数据行
        for (ri, rec) in records.enumerated() {
            let rowH = rowHeightCache[ri]
            let rowIdx = ri + 2
            sheetParts.append("<row r=\"\(rowIdx)\" ht=\"\(pxToRowHeight(rowH))\" customHeight=\"1\">")
            for (ci, col) in columns.enumerated() {
                let cellRef = colLetter(ci) + "\(rowIdx)"
                if col.isImage {
                    sheetParts.append("<c r=\"\(cellRef)\" s=\"1\"/>")
                } else {
                    let val = rec[col.key] ?? ""
                    sheetParts.append("<c r=\"\(cellRef)\" s=\"1\" t=\"inlineStr\"><is><t xml:space=\"preserve\">\(xmlEscape(val))</t></is></c>")
                }
            }
            sheetParts.append("</row>")
        }
        sheetParts.append("</sheetData>")

        if !imageEntries.isEmpty {
            sheetParts.append("<drawing r:id=\"rId3\"/>")
        }
        sheetParts.append("</worksheet>")
        try zip.addEntry(named: "xl/worksheets/sheet1.xml", string: sheetParts.joined())

        // ===== 7. 图片相关（仅当存在图片）=====
        if !imageEntries.isEmpty {
            // 7.1 xl/worksheets/_rels/sheet1.xml.rels
            var sheetRels: [String] = []
            sheetRels.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>")
            sheetRels.append("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">")
            sheetRels.append("<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing\" Target=\"../drawings/drawing1.xml\"/>")
            sheetRels.append("</Relationships>")
            try zip.addEntry(named: "xl/worksheets/_rels/sheet1.xml.rels", string: sheetRels.joined())

            // 7.2 xl/drawings/drawing1.xml
            let EMU_PER_PX = 9525
            var drawingParts: [String] = []
            drawingParts.append(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                + "<xdr:wsDr xmlns:xdr=\"http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing\" "
                + "xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" "
                + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">")
            for (i, ie) in imageEntries.enumerated() {
                let rec = records[ie.recordIdx]
                let imgH = imgHCache[ie.recordIdx]
                let rowIdx = ie.recordIdx + 2
                let fromCol = IMG_COL
                let fromRow = rowIdx - 1
                let toCol = IMG_COL + 1
                let toRow = rowIdx
                drawingParts.append("<xdr:twoCellAnchor>")
                drawingParts.append("<xdr:from><xdr:col>\(fromCol)</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>\(fromRow)</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>")
                drawingParts.append("<xdr:to><xdr:col>\(toCol)</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>\(toRow)</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>")
                drawingParts.append("<xdr:pic>")
                drawingParts.append("<xdr:nvPicPr><xdr:cNvPr id=\"\(i + 1)\" name=\"图片\(i + 1)\"/><xdr:cNvPicPr/></xdr:nvPicPr>")
                drawingParts.append("<xdr:blipFill><a:blip r:embed=\"\(ie.rId)\"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>")
                drawingParts.append("<xdr:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"\(imgColWidth * EMU_PER_PX)\" cy=\"\(imgH * EMU_PER_PX)\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></xdr:spPr>")
                drawingParts.append("</xdr:pic>")
                drawingParts.append("<xdr:clientData/>")
                drawingParts.append("</xdr:twoCellAnchor>")
            }
            drawingParts.append("</xdr:wsDr>")
            try zip.addEntry(named: "xl/drawings/drawing1.xml", string: drawingParts.joined())

            // 7.3 xl/drawings/_rels/drawing1.xml.rels
            var drawRels: [String] = []
            drawRels.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>")
            drawRels.append("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">")
            for ie in imageEntries {
                drawRels.append("<Relationship Id=\"\(ie.rId)\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/image\(ie.idx).\(ie.ext)\"/>")
            }
            drawRels.append("</Relationships>")
            try zip.addEntry(named: "xl/drawings/_rels/drawing1.xml.rels", string: drawRels.joined())

            // 7.4 xl/media/imageN.jpg（原始字节）
            for ie in imageEntries {
                let relPath = records[ie.recordIdx]["imagePath"] ?? ""
                guard let data = imageData(relPath), !data.isEmpty else { continue }
                try zip.addEntry(named: "xl/media/image\(ie.idx).\(ie.ext)", data: data)
            }
        }

        try zip.finish()
    }
}