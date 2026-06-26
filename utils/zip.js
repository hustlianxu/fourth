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

function ZipWriter() {
  this._entries = [];
  this._offset = 0;
}

ZipWriter.prototype.addFile = function (name, data) {
  var u8 = toUint8(data);
  var nameBytes = strToUtf8(name);
  var crc = crc32(u8);
  var entry = {
    name: name,
    nameBytes: nameBytes,
    data: u8,
    crc: crc,
    size: u8.length,
    offset: this._offset,
    method: 0 // 0 = STORE
  };
  this._entries.push(entry);
  this._offset += 30 + nameBytes.length + u8.length; // 文件头 + 文件名 + 数据
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
