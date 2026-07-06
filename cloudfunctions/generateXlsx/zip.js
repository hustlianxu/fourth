// utils/zip.js
// 最小化 ZIP 实现：仅 STORE 模式（不压缩），用于生成 .xlsx（OOXML）
// 图片等二进制以原始字节写入，不被压缩
//
// 对外 API：
//   var z = new ZipWriter();
//   z.addFile('xl/media/image1.jpeg', uint8Array);
//   z.addFile('[Content_Types].xml', stringOrUint8);
//   var bytes = z.end();  // Uint8Array

// CRC32 表（预计算）
var CRC_TABLE = (function () {
  var t = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(uint8) {
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < uint8.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ uint8[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 字符串转 UTF-8 Uint8Array
function strToUtf8(str) {
  // 小程序环境无 TextEncoder，手动 UTF-8 编码
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xC0 | (c >> 6));
      bytes.push(0x80 | (c & 0x3F));
    } else if (c < 0xD800 || c >= 0xE000) {
      bytes.push(0xE0 | (c >> 12));
      bytes.push(0x80 | ((c >> 6) & 0x3F));
      bytes.push(0x80 | (c & 0x3F));
    } else {
      // 代理对（4 字节 UTF-8）
      i++;
      var c2 = str.charCodeAt(i);
      var cp = 0x10000 + (((c & 0x3FF) << 10) | (c2 & 0x3FF));
      bytes.push(0xF0 | (cp >> 18));
      bytes.push(0x80 | ((cp >> 12) & 0x3F));
      bytes.push(0x80 | ((cp >> 6) & 0x3F));
      bytes.push(0x80 | (cp & 0x3F));
    }
  }
  return new Uint8Array(bytes);
}

// 转 Uint8Array（接受字符串或 Uint8Array）
function toUint8(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') return strToUtf8(data);
  if (data && data.buffer instanceof ArrayBuffer) return new Uint8Array(data.buffer);
  return strToUtf8(String(data));
}

// 小端序写入
function writeU16(arr, off, val) {
  arr[off] = val & 0xFF;
  arr[off + 1] = (val >> 8) & 0xFF;
}
function writeU32(arr, off, val) {
  arr[off] = val & 0xFF;
  arr[off + 1] = (val >> 8) & 0xFF;
  arr[off + 2] = (val >> 16) & 0xFF;
  arr[off + 3] = (val >> 24) & 0xFF;
}

// 构建 ZIP 本地文件头（30 字节 + 文件名）
function buildLocalFileHeader(nameBytes, crc, size) {
  var buf = new Uint8Array(30 + nameBytes.length);
  var p = 0;
  writeU32(buf, p, 0x04034b50); p += 4;  // signature
  writeU16(buf, p, 20); p += 2;           // version needed
  writeU16(buf, p, 0); p += 2;            // flags
  writeU16(buf, p, 0); p += 2;            // STORE
  writeU16(buf, p, 0); p += 2;            // mod time
  writeU16(buf, p, 0); p += 2;            // mod date
  writeU32(buf, p, crc); p += 4;
  writeU32(buf, p, size); p += 4;         // compressed size
  writeU32(buf, p, size); p += 4;         // uncompressed size
  writeU16(buf, p, nameBytes.length); p += 2;
  writeU16(buf, p, 0); p += 2;            // extra field length
  buf.set(nameBytes, p);
  return buf;
}

// 构建 ZIP 中央目录条目（46 字节 + 文件名）
function buildCentralDirEntry(nameBytes, crc, size, offset) {
  var buf = new Uint8Array(46 + nameBytes.length);
  var p = 0;
  writeU32(buf, p, 0x02014b50); p += 4;  // signature
  writeU16(buf, p, 20); p += 2;           // version made by
  writeU16(buf, p, 20); p += 2;           // version needed
  writeU16(buf, p, 0); p += 2;            // flags
  writeU16(buf, p, 0); p += 2;            // STORE
  writeU16(buf, p, 0); p += 2;            // mod time
  writeU16(buf, p, 0); p += 2;            // mod date
  writeU32(buf, p, crc); p += 4;
  writeU32(buf, p, size); p += 4;         // compressed size
  writeU32(buf, p, size); p += 4;         // uncompressed size
  writeU16(buf, p, nameBytes.length); p += 2;
  writeU16(buf, p, 0); p += 2;            // extra field length
  writeU16(buf, p, 0); p += 2;            // comment length
  writeU16(buf, p, 0); p += 2;            // disk number start
  writeU16(buf, p, 0); p += 2;            // internal attrs
  writeU32(buf, p, 0); p += 4;            // external attrs
  writeU32(buf, p, offset); p += 4;       // local header offset
  buf.set(nameBytes, p);
  return buf;
}

var CHUNK_SIZE = 1024 * 1024; // 分块大小：1MB，避开微信单次写入大小限制

// 将 ArrayBuffer 或 TypedArray 分块写入文件
function _writeChunked(fs, filePath, data, mode) {
  var u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  var offset = 0;
  var first = (mode === 'write');
  while (offset < u8.length) {
    var end = Math.min(offset + CHUNK_SIZE, u8.length);
    var chunk = u8.slice(offset, end).buffer;
    if (first) {
      fs.writeFileSync(filePath, chunk, 'binary');
      first = false;
    } else {
      fs.appendFileSync(filePath, chunk, 'binary');
    }
    offset = end;
  }
}

function ZipWriter() {
  this._entries = [];
  this._offset = 0;
  this._streaming = false;  // 流式模式：addFile 立即写入磁盘
  this._fs = null;          // wx.getFileSystemManager()
  this._filePath = null;    // 输出文件路径
  this._written = 0;        // 已写入文件的字节数（用于跟踪是否首次写入）
}

/**
 * 打开流式写入模式 —— addFile 会立即将内容写入磁盘，释放内存
 * 完成后必须调用 closeFile() 写出中央目录和 EOCD
 * @param {Object} fs  wx.getFileSystemManager() 实例
 * @param {string} filePath  目标文件路径
 */
ZipWriter.prototype.openFile = function (fs, filePath) {
  this._streaming = true;
  this._fs = fs;
  this._filePath = filePath;
  this._written = 0;
};

ZipWriter.prototype.addFile = function (name, data) {
  var u8 = toUint8(data);
  var nameBytes = strToUtf8(name);
  var crc = crc32(u8);
  var entry = {
    name: name,
    nameBytes: nameBytes,
    data: this._streaming ? null : u8, // 流式不保留数据
    crc: crc,
    size: u8.length,
    offset: this._offset,
    method: 0 // 0 = STORE
  };
  this._entries.push(entry);
  this._offset += 30 + nameBytes.length + u8.length; // 文件头 + 文件名 + 数据

  if (this._streaming) {
    // 流式模式：分块写入磁盘，避开微信单次写入大小限制；写入后释放 u8 内存
    var header = buildLocalFileHeader(nameBytes, crc, u8.length);
    if (this._written === 0) {
      // 首次写入：合并 header + data 一起分块写入
      var firstChunk = new Uint8Array(header.length + u8.length);
      firstChunk.set(header, 0);
      firstChunk.set(u8, header.length);
      _writeChunked(this._fs, this._filePath, firstChunk, 'write');
    } else {
      // 后续：header 很小，无需分块；data 分块写入
      _writeChunked(this._fs, this._filePath, header, 'append');
      _writeChunked(this._fs, this._filePath, u8, 'append');
    }
    this._written += header.length + u8.length;
  }
};

/**
 * 关闭流式模式，写出中央目录和 EOCD 记录
 */
ZipWriter.prototype.closeFile = function () {
  if (!this._streaming) return;

  // 中央目录
  var cdSize = 0;
  for (var i = 0; i < this._entries.length; i++) {
    cdSize += 46 + this._entries[i].nameBytes.length;
  }
  var cdBuf = new Uint8Array(cdSize);
  var off = 0;
  for (var i = 0; i < this._entries.length; i++) {
    var e = this._entries[i];
    var cdEntry = buildCentralDirEntry(e.nameBytes, e.crc, e.size, e.offset);
    cdBuf.set(cdEntry, off);
    off += cdEntry.length;
  }
  _writeChunked(this._fs, this._filePath, cdBuf, 'append');

  // EOCD
  var eocd = new Uint8Array(22);
  var p = 0;
  writeU32(eocd, p, 0x06054b50); p += 4;    // signature
  writeU16(eocd, p, 0); p += 2;              // disk number
  writeU16(eocd, p, 0); p += 2;              // disk with central dir
  writeU16(eocd, p, this._entries.length); p += 2;
  writeU16(eocd, p, this._entries.length); p += 2;
  writeU32(eocd, p, cdSize); p += 4;
  writeU32(eocd, p, this._offset); p += 4;
  writeU16(eocd, p, 0); p += 2;              // comment length
  _writeChunked(this._fs, this._filePath, eocd, 'append');

  this._streaming = false;
  this._fs = null;
  this._filePath = null;
};

ZipWriter.prototype.end = function () {
  // 计算总大小
  var centralSize = 0;
  for (var i = 0; i < this._entries.length; i++) {
    centralSize += 46 + this._entries[i].nameBytes.length;
  }
  var centralOffset = this._offset;
  var totalSize = centralOffset + centralSize + 22;

  var out = new Uint8Array(totalSize);
  var p = 0;

  // 1) 本地文件头 + 数据
  for (var i = 0; i < this._entries.length; i++) {
    var e = this._entries[i];
    // Local file header signature
    writeU32(out, p, 0x04034b50); p += 4;
    writeU16(out, p, 20); p += 2;          // version needed
    writeU16(out, p, 0); p += 2;          // general purpose flag
    writeU16(out, p, 0); p += 2;          // compression method: 0=STORE
    writeU16(out, p, 0); p += 2;          // mod time
    writeU16(out, p, 0); p += 2;          // mod date
    writeU32(out, p, e.crc); p += 4;       // CRC32
    writeU32(out, p, e.size); p += 4;      // compressed size
    writeU32(out, p, e.size); p += 4;      // uncompressed size
    writeU16(out, p, e.nameBytes.length); p += 2;
    writeU16(out, p, 0); p += 2;          // extra field length
    out.set(e.nameBytes, p); p += e.nameBytes.length;
    out.set(e.data, p); p += e.data.length;
  }

  // 2) 中央目录
  for (var i = 0; i < this._entries.length; i++) {
    var e = this._entries[i];
    writeU32(out, p, 0x02014b50); p += 4;  // Central file header signature
    writeU16(out, p, 20); p += 2;          // version made by
    writeU16(out, p, 20); p += 2;          // version needed
    writeU16(out, p, 0); p += 2;          // general purpose flag
    writeU16(out, p, 0); p += 2;          // compression method
    writeU16(out, p, 0); p += 2;          // mod time
    writeU16(out, p, 0); p += 2;          // mod date
    writeU32(out, p, e.crc); p += 4;
    writeU32(out, p, e.size); p += 4;
    writeU32(out, p, e.size); p += 4;
    writeU16(out, p, e.nameBytes.length); p += 2;
    writeU16(out, p, 0); p += 2;          // extra field length
    writeU16(out, p, 0); p += 2;          // comment length
    writeU16(out, p, 0); p += 2;          // disk number start
    writeU16(out, p, 0); p += 2;          // internal attrs
    writeU32(out, p, 0); p += 4;          // external attrs
    writeU32(out, p, e.offset); p += 4;    // local header offset
    out.set(e.nameBytes, p); p += e.nameBytes.length;
  }

  // 3) EOCD
  writeU32(out, p, 0x06054b50); p += 4;    // EOCD signature
  writeU16(out, p, 0); p += 2;            // disk number
  writeU16(out, p, 0); p += 2;            // disk with central dir
  writeU16(out, p, this._entries.length); p += 2;  // entries on this disk
  writeU16(out, p, this._entries.length); p += 2;  // total entries
  writeU32(out, p, centralSize); p += 4;   // central dir size
  writeU32(out, p, centralOffset); p += 4; // central dir offset
  writeU16(out, p, 0); p += 2;            // comment length

  return out;
};

module.exports = {
  ZipWriter: ZipWriter,
  crc32: crc32,
  strToUtf8: strToUtf8
};
