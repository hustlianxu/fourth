import Foundation

// MARK: - 极简 ZIP 写入器（Store 不压缩，method=0）
//
// 用于生成 .xlsx（OOXML 本质是 ZIP 容器）。图片以原始字节直接写入，
// 不做压缩，保证图片在 Excel/WPS/Numbers 中完整体现（与小程序端一致）。
// 支持 [Content_Types].xml 等文本条目与 xl/media/imageN.jpg 等二进制条目。

final class ZipStoreWriter {
    private let fileURL: URL
    private let handle: FileHandle
    private var centralDirectory = Data()
    private var entryCount = 0
    private var localOffset: UInt32 = 0
    private(set) var isClosed = false

    init(fileURL: URL) throws {
        self.fileURL = fileURL
        FileManager.default.createFile(atPath: fileURL.path, contents: nil)
        self.handle = try FileHandle(forWritingTo: fileURL)
    }

    deinit {
        try? handle.close()
    }

    // MARK: - CRC32（查表实现，避免依赖 libz）

    private static let crcTable: [UInt32] = (0..<256).map { i in
        var c = UInt32(i)
        for _ in 0..<8 { c = (c & 1) != 0 ? (0xEDB88320 ^ (c >> 1)) : (c >> 1) }
        return c
    }

    private static func crc32(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xFFFFFFFF
        for byte in data {
            crc = crcTable[Int((crc ^ UInt32(byte)) & 0xFF)] ^ (crc >> 8)
        }
        return crc ^ 0xFFFFFFFF
    }

    private static func littleEndian(_ value: UInt32, into data: inout Data) {
        withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
    }

    private static func littleEndian(_ value: UInt16, into data: inout Data) {
        withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
    }

    // MARK: - 添加条目

    /// 二进制条目：直接从磁盘文件读入（单张图片最大内存占用）
    func addEntry(named name: String, fromFile url: URL) throws {
        guard let data = try? Data(contentsOf: url) else {
            throw ExportError.cannotReadImage(url.lastPathComponent)
        }
        try addEntry(named: name, data: data)
    }

    /// 二进制条目
    func addEntry(named name: String, data: Data) throws {
        guard !isClosed else { throw ExportError.closed }
        let nameData = Data(name.utf8)
        let crc = Self.crc32(data)
        let method: UInt16 = 0 // store
        let flags: UInt16 = 0  // 条目名均为 ASCII，无需 UTF-8 标志
        let version: UInt16 = 20
        // DOS 时间 00:00:00（合法）；日期必须 ≥ 1980-01-01（0x0021），
        // 日期 0 表示 1980-00-00 属非法值，部分严格解析器会拒绝整个包
        let dosTime: UInt16 = 0
        let dosDate: UInt16 = 0x0021

        var local = Data()
        // 注意：字面量必须显式标注 UInt32/UInt16，否则与两个重载产生歧义
        Self.littleEndian(UInt32(0x04034b50), into: &local) // local file header sig
        Self.littleEndian(version, into: &local)             // version needed
        Self.littleEndian(flags, into: &local)               // flags
        Self.littleEndian(method, into: &local)              // method: 0 = store
        Self.littleEndian(dosTime, into: &local)             // mod time
        Self.littleEndian(dosDate, into: &local)             // mod date
        Self.littleEndian(crc, into: &local)                 // crc32
        Self.littleEndian(UInt32(data.count), into: &local)  // compressed size
        Self.littleEndian(UInt32(data.count), into: &local)  // uncompressed size
        Self.littleEndian(UInt16(nameData.count), into: &local) // name len
        Self.littleEndian(UInt16(0), into: &local)           // extra len
        local.append(nameData)

        try handle.write(contentsOf: local)
        try handle.write(contentsOf: data)

        // 中央目录条目
        var central = Data()
        Self.littleEndian(UInt32(0x02014b50), into: &central) // central file header sig
        Self.littleEndian(UInt16(0x0014), into: &central)   // version made by: 20, MS-DOS
        Self.littleEndian(version, into: &central)           // version needed
        Self.littleEndian(flags, into: &central)             // flags
        Self.littleEndian(method, into: &central)            // method
        Self.littleEndian(dosTime, into: &central)           // mod time
        Self.littleEndian(dosDate, into: &central)           // mod date
        Self.littleEndian(crc, into: &central)                // crc32
        Self.littleEndian(UInt32(data.count), into: &central) // compressed size
        Self.littleEndian(UInt32(data.count), into: &central) // uncompressed size
        Self.littleEndian(UInt16(nameData.count), into: &central) // name len
        Self.littleEndian(UInt16(0), into: &central)        // extra len
        Self.littleEndian(UInt16(0), into: &central)        // comment len
        Self.littleEndian(UInt16(0), into: &central)        // disk number
        Self.littleEndian(UInt16(0), into: &central)        // internal attrs
        Self.littleEndian(UInt16(0), into: &central)        // external attrs
        Self.littleEndian(localOffset, into: &central)       // local header offset
        central.append(nameData)

        centralDirectory.append(central)
        localOffset += UInt32(30 + nameData.count + data.count)
        entryCount += 1
    }

    // MARK: - 收尾

    /// 写入中央目录与 EOCD 并关闭文件
    func finish() throws {
        guard !isClosed else { return }
        try handle.write(contentsOf: centralDirectory)
        let cdSize = UInt32(centralDirectory.count)

        var eocd = Data()
        Self.littleEndian(UInt32(0x06054b50), into: &eocd) // EOCD sig
        Self.littleEndian(UInt16(0), into: &eocd)     // disk number
        Self.littleEndian(UInt16(0), into: &eocd)     // cd start disk
        Self.littleEndian(UInt16(min(entryCount, 0xFFFF)), into: &eocd) // entries on this disk
        Self.littleEndian(UInt16(min(entryCount, 0xFFFF)), into: &eocd) // total entries
        Self.littleEndian(cdSize, into: &eocd)        // cd size
        Self.littleEndian(localOffset, into: &eocd)   // cd offset
        Self.littleEndian(UInt16(0), into: &eocd)     // comment len
        try handle.write(contentsOf: eocd)

        try handle.close()
        isClosed = true
    }
}

enum ExportError: LocalizedError {
    case closed
    case invalidEncoding(String)
    case cannotReadImage(String)

    var errorDescription: String? {
        switch self {
        case .closed: return "导出文件已关闭"
        case .invalidEncoding(let name): return "无法编码条目：\(name)"
        case .cannotReadImage(let name): return "无法读取图片：\(name)"
        }
    }
}