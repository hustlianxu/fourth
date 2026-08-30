package com.watermark.camera.core

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.zip.CRC32
import kotlin.math.max
import kotlin.math.roundToInt

// MARK: - 极简 ZIP 写入器（STORE 模式，method=0）
//
// 移植自 iOS ZipStoreWriter.swift，其每个字节都经过标准解析器验证。
// 注意：central directory 的 external attrs 必须写 4 字节（UInt32），
// 写成 2 字节会导致条目解析错位、整个包损坏（Office/WPS 拒开、iOS 报 912）。

private class ZipStoreWriter(out: File) {

    private val stream = DataOutputStream(FileOutputStream(out))
    private val central = ByteArrayOutputStream()
    private var entryCount = 0
    private var localOffset = 0L

    private fun u16(v: Int) = stream.writeShort(v.toInt() and 0xFFFF)
    private fun u32(v: Long) = stream.writeInt((v and 0xFFFFFFFFL).toInt())

    private fun cu16(v: Int) { central.write(v and 0xFF); central.write((v shr 8) and 0xFF) }
    private fun cu32(v: Long) {
        val i = (v and 0xFFFFFFFFL).toInt()
        central.write(i and 0xFF); central.write((i shr 8) and 0xFF)
        central.write((i shr 16) and 0xFF); central.write((i shr 24) and 0xFF)
    }

    fun addEntry(name: String, data: ByteArray) {
        val nameBytes = name.toByteArray(Charsets.US_ASCII)
        val crc = CRC32().apply { update(data) }.value.toInt()
        // DOS 时间 00:00:00（合法）；日期必须 ≥ 1980-01-01（0x0021）
        val dosTime = 0
        val dosDate = 0x0021

        // ---- local file header ----
        stream.writeInt(0x04034b50)          // sig
        u16(20)                               // version needed
        u16(0)                                // flags
        u16(0)                                // method: 0 = store
        u16(dosTime); u16(dosDate)
        u32(crc.toLong() and 0xFFFFFFFFL)     // crc32
        u32(data.size.toLong())               // compressed size
        u32(data.size.toLong())               // uncompressed size
        u16(nameBytes.size)                   // name len
        u16(0)                                // extra len
        stream.write(nameBytes)
        stream.write(data)

        // ---- central directory header ----
        cu32(0x02014b50L)                     // sig
        cu16(0x0014)                          // version made by: 20, MS-DOS
        cu16(20)                              // version needed
        cu16(0)                               // flags
        cu16(0)                               // method
        cu16(dosTime); cu16(dosDate)
        cu32(crc.toLong() and 0xFFFFFFFFL)    // crc32
        cu32(data.size.toLong())              // compressed size
        cu32(data.size.toLong())              // uncompressed size
        cu16(nameBytes.size)                  // name len
        cu16(0)                               // extra len
        cu16(0)                               // comment len
        cu16(0)                               // disk number
        cu16(0)                               // internal attrs
        // external attrs 必须是 4 字节！（iOS 端曾误写 2 字节导致包损坏）
        cu32(0L)
        cu32(localOffset)                     // local header offset
        central.write(nameBytes)

        localOffset += 30 + nameBytes.size + data.size
        entryCount++
    }

    fun finish() {
        stream.write(central.toByteArray())
        val cdSize = central.size().toLong()

        // EOCD
        stream.writeInt(0x06054b50)
        u16(0); u16(0)
        u16(entryCount); u16(entryCount)
        u32(cdSize)
        u32(localOffset)
        u16(0)
        stream.flush()
        stream.close()
    }
}

// MARK: - .xlsx 生成器（OOXML，图片字节嵌入）
//
// 包结构：[Content_Types].xml / _rels/.rels / docProps/{app,core}.xml
//   xl/workbook.xml / xl/_rels/workbook.xml.rels / xl/styles.xml
//   xl/worksheets/sheet1.xml / xl/worksheets/_rels/sheet1.xml.rels
//   xl/drawings/drawing1.xml / xl/drawings/_rels/drawing1.xml.rels / xl/media/imageN.jpeg
// 文本使用 inlineStr 避免 sharedStrings；drawing 是 worksheet 级关系。

object XlsxWriter {

    data class Column(val key: String, val header: String, val isImage: Boolean)

    private data class ImageEntry(val rId: String, val idx: Int, val recordIdx: Int, val data: ByteArray)

    fun xmlEscape(s: String?): String {
        if (s == null) return ""
        val sb = StringBuilder()
        for (c in s) {
            val v = c.code
            // 过滤 XML 1.0 非法控制字符（严格解析器遇到会拒绝整个文件）
            if (v < 0x20 && v != 0x9 && v != 0xA && v != 0xD) continue
            when (c) {
                '&' -> sb.append("&amp;")
                '<' -> sb.append("&lt;")
                '>' -> sb.append("&gt;")
                '"' -> sb.append("&quot;")
                '\'' -> sb.append("&apos;")
                else -> sb.append(c)
            }
        }
        return sb.toString()
    }

    private fun colLetter(idx: Int): String {
        var s = ""
        var n = idx
        while (true) {
            s = ('A' + n % 26) + s
            n = n / 26 - 1
            if (n < 0) break
        }
        return s
    }

    /**
     * 构建 .xlsx 并写入指定文件。
     * @param records 扁平化记录（含 imagePath 与各字段值）
     * @param imageData 从相对路径读图片字节（null 跳过该图）
     * @param rowHeights 各记录行高（px）
     * @param imgDisplayHeights 各记录图片显示高度（px）
     * @param columnWidths 各列像素宽度 {key: px}
     * @param imgColWidth 图片列像素宽度
     */
    fun write(records: List<Map<String, String>>,
              columns: List<Column>,
              outFile: File,
              imageData: (String) -> ByteArray?,
              rowHeights: List<Int>,
              imgDisplayHeights: List<Int>,
              columnWidths: Map<String, Int>,
              imgColWidth: Int) {

        // 1. 收集图片（一次性读入，保证 drawing 引用与 media 一致）
        val imageEntries = mutableListOf<ImageEntry>()
        records.forEachIndexed { i, rec ->
            val path = rec["imagePath"] ?: ""
            if (path.isNotEmpty()) {
                val d = imageData(path)
                if (d != null && d.isNotEmpty()) {
                    val idx = imageEntries.size + 1
                    imageEntries.add(ImageEntry("rId$idx", idx, i, d))
                }
            }
        }

        // 2. 全部 OOXML 部件（内存构建）
        val parts = sortedMapOf<String, ByteArray>()  // 排序后 [Content_Types].xml 位于包首

        fun put(path: String, content: String) { parts[path] = content.toByteArray(Charsets.UTF_8) }

        put("[Content_Types].xml", contentTypesXML)
        put("_rels/.rels", rootRelsXML)
        put("docProps/app.xml", appXML)
        put("docProps/core.xml", coreXML)
        put("xl/workbook.xml", workbookXML)
        put("xl/_rels/workbook.xml.rels", workbookRelsXML)
        put("xl/styles.xml", stylesXML)
        put("xl/worksheets/sheet1.xml",
            sheetXML(records, columns, imageEntries.size, rowHeights, columnWidths))
        if (imageEntries.isNotEmpty()) {
            put("xl/worksheets/_rels/sheet1.xml.rels", sheetRelsXML)
            put("xl/drawings/drawing1.xml", drawingXML(imageEntries, imgDisplayHeights, imgColWidth))
            put("xl/drawings/_rels/drawing1.xml.rels", drawingRelsXML(imageEntries))
            imageEntries.forEach { parts["xl/media/image${it.idx}.jpeg"] = it.data }
        }

        // 3. 打包（STORE 模式 ZIP）
        if (outFile.exists()) outFile.delete()
        outFile.parentFile?.mkdirs()
        val zip = ZipStoreWriter(outFile)
        for ((name, data) in parts) zip.addEntry(name, data)
        zip.finish()
    }

    // MARK: - XML 部件

    private val contentTypesXML: String
        get() = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
            "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
            "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
            "<Default Extension=\"jpeg\" ContentType=\"image/jpeg\"/>" +
            "<Default Extension=\"jpg\" ContentType=\"image/jpeg\"/>" +
            "<Default Extension=\"png\" ContentType=\"image/png\"/>" +
            "<Default Extension=\"gif\" ContentType=\"image/gif\"/>" +
            "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>" +
            "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>" +
            "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>" +
            "<Override PartName=\"/xl/drawings/drawing1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.drawing+xml\"/>" +
            "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>" +
            "<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>" +
            "</Types>"

    private val rootRelsXML: String
        get() = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>" +
            "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>" +
            "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/>" +
            "</Relationships>"

    private val appXML: String
        get() = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\">" +
            "<Application>WatermarkCamera</Application></Properties>"

    private val coreXML: String
        get() {
            val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).format(Date())
            return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                "<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" " +
                "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" " +
                "xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">" +
                "<dc:creator>WatermarkCamera</dc:creator>" +
                "<dcterms:created xsi:type=\"dcterms:W3CDTF\">$iso</dcterms:created>" +
                "<dcterms:modified xsi:type=\"dcterms:W3CDTF\">$iso</dcterms:modified>" +
                "</cp:coreProperties>"
        }

    private val workbookXML: String
        get() = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" " +
            "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">" +
            "<bookViews><workbookView activeTab=\"0\"/></bookViews>" +
            "<sheets><sheet name=\"Sheet1\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>"

    // drawing 是 worksheet 级关系，不能出现在 workbook 级 rels（会导致 912）
    private val workbookRelsXML: String
        get() = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>" +
            "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>" +
            "</Relationships>"

    private val stylesXML: String
        get() = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" +
            "<numFmts count=\"1\"><numFmt numFmtId=\"164\" formatCode=\"@\"/></numFmts>" +
            "<fonts count=\"2\">" +
            "<font><sz val=\"11\"/><name val=\"Calibri\"/></font>" +
            "<font><b/><sz val=\"11\"/><color rgb=\"FFFFFFFF\"/><name val=\"Calibri\"/></font>" +
            "</fonts>" +
            "<fills count=\"3\">" +
            "<fill><patternFill patternType=\"none\"/></fill>" +
            "<fill><patternFill patternType=\"gray125\"/></fill>" +
            "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF4472C4\"/><bgColor indexed=\"64\"/></patternFill></fill>" +
            "</fills>" +
            "<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>" +
            "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>" +
            "<cellXfs count=\"3\">" +
            "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"0\"/>" +
            "<xf numFmtId=\"164\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyAlignment=\"1\">" +
            "<alignment vertical=\"center\" wrapText=\"1\"/></xf>" +
            "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"2\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyAlignment=\"1\">" +
            "<alignment horizontal=\"center\" vertical=\"center\"/></xf>" +
            "</cellXfs>" +
            "<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>" +
            "</styleSheet>"

    private val sheetRelsXML: String
        get() = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
            "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing\" Target=\"../drawings/drawing1.xml\"/>" +
            "</Relationships>"

    private fun pxToRowHeight(px: Int): Int = (px * 0.75).roundToInt()

    private fun sheetXML(records: List<Map<String, String>>,
                         columns: List<Column>,
                         imageCount: Int,
                         rowHeights: List<Int>,
                         columnWidths: Map<String, Int>): String {
        val p = StringBuilder()
        p.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" " +
            "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">")
        p.append("<cols>")
        columns.forEachIndexed { i, col ->
            val w = columnWidths[col.key] ?: 80
            val cw = max(8, (w / 7.0).roundToInt())
            p.append("<col min=\"${i + 1}\" max=\"${i + 1}\" width=\"$cw\" customWidth=\"1\"/>")
        }
        p.append("</cols>")
        p.append("<sheetData>")

        // 表头行
        p.append("<row r=\"1\" ht=\"${pxToRowHeight(28)}\" customHeight=\"1\">")
        columns.forEachIndexed { i, col ->
            p.append("<c r=\"${colLetter(i)}1\" s=\"2\" t=\"inlineStr\"><is><t>${xmlEscape(col.header)}</t></is></c>")
        }
        p.append("</row>")

        // 数据行
        records.forEachIndexed { ri, rec ->
            val rowH = rowHeights.getOrElse(ri) { 60 }
            val rowIdx = ri + 2
            p.append("<row r=\"$rowIdx\" ht=\"${pxToRowHeight(rowH)}\" customHeight=\"1\">")
            columns.forEachIndexed { ci, col ->
                val cellRef = "${colLetter(ci)}$rowIdx"
                if (col.isImage) {
                    p.append("<c r=\"$cellRef\" s=\"1\"/>")
                } else {
                    val v = rec[col.key] ?: ""
                    p.append("<c r=\"$cellRef\" s=\"1\" t=\"inlineStr\"><is><t xml:space=\"preserve\">${xmlEscape(v)}</t></is></c>")
                }
            }
            p.append("</row>")
        }
        p.append("</sheetData>")
        if (imageCount > 0) p.append("<drawing r:id=\"rId3\"/>")
        p.append("</worksheet>")
        return p.toString()
    }

    private fun drawingXML(imageEntries: List<ImageEntry>,
                           imgDisplayHeights: List<Int>,
                           imgColWidth: Int): String {
        val EMU_PER_PX = 9525
        val IMG_COL = 0
        val p = StringBuilder()
        p.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<xdr:wsDr xmlns:xdr=\"http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing\" " +
            "xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" " +
            "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">")
        imageEntries.forEachIndexed { i, ie ->
            val imgH = if (ie.recordIdx < imgDisplayHeights.size) max(imgDisplayHeights[ie.recordIdx], 1) else 1
            val rowIdx = ie.recordIdx + 2
            p.append("<xdr:twoCellAnchor>")
            p.append("<xdr:from><xdr:col>$IMG_COL</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${rowIdx - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>")
            p.append("<xdr:to><xdr:col>${IMG_COL + 1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>$rowIdx</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>")
            p.append("<xdr:pic>")
            p.append("<xdr:nvPicPr><xdr:cNvPr id=\"${i + 1}\" name=\"Image ${i + 1}\"/><xdr:cNvPicPr/></xdr:nvPicPr>")
            p.append("<xdr:blipFill><a:blip r:embed=\"${ie.rId}\"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>")
            p.append("<xdr:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"${imgColWidth * EMU_PER_PX}\" cy=\"${imgH * EMU_PER_PX}\"/></a:xfrm>" +
                "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></xdr:spPr>")
            p.append("</xdr:pic>")
            p.append("<xdr:clientData/>")
            p.append("</xdr:twoCellAnchor>")
        }
        p.append("</xdr:wsDr>")
        return p.toString()
    }

    private fun drawingRelsXML(imageEntries: List<ImageEntry>): String {
        val p = StringBuilder()
        p.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">")
        imageEntries.forEach {
            p.append("<Relationship Id=\"${it.rId}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/image${it.idx}.jpeg\"/>")
        }
        p.append("</Relationships>")
        return p.toString()
    }
}
