#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""复刻 iOS ZipStoreWriter + XlsxWriter 的字节输出，用于验证格式"""
import struct, io

from PIL import Image

# ===== ZipStoreWriter（与 Swift 版逐字段一致）=====
CRC_TABLE = []
for n in range(256):
    c = n
    for _ in range(8):
        c = (0xEDB88320 ^ (c >> 1)) if (c & 1) else (c >> 1)
    CRC_TABLE.append(c)

def crc32(data):
    crc = 0xFFFFFFFF
    for b in data:
        crc = CRC_TABLE[(crc ^ b) & 0xFF] ^ (crc >> 8)
    return crc ^ 0xFFFFFFFF

class ZipStoreWriter:
    def __init__(self):
        self.buf = io.BytesIO()
        self.central = io.BytesIO()
        self.count = 0
        self.local_offset = 0

    def add(self, name, data):
        name_b = name.encode('utf-8')
        if isinstance(data, str):
            data = data.encode('utf-8')
        crc = crc32(data)
        method = 0
        flags = 0x0800  # Swift 版：UTF-8 文件名标志
        version = 20

        local = struct.pack('<IHHHHHIIIHH',
            0x04034b50, version, flags, method, 0, 0,
            crc, len(data), len(data), len(name_b), 0) + name_b
        self.buf.write(local)
        self.buf.write(data)

        central = struct.pack('<IHHHHHHIIIHHHHHII',
            0x02014b50, 0x031E, version, flags, method, 0, 0,
            crc, len(data), len(data), len(name_b), 0, 0, 0, 0, 0,
            self.local_offset) + name_b
        self.central.write(central)
        self.local_offset += 30 + len(name_b) + len(data)
        self.count += 1

    def finish(self):
        self.buf.write(self.central.getvalue())
        cd_size = self.central.tell()
        eocd = struct.pack('<IHHHHIIH',
            0x06054b50, 0, 0, self.count, self.count,
            cd_size, self.local_offset, 0)
        self.buf.write(eocd)
        return self.buf.getvalue()

# ===== XlsxWriter（与 Swift 版 XML 一致）=====
def xml_escape(s):
    return (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
             .replace('"', '&quot;').replace("'", '&apos;'))

def col_letter(idx):
    s = ''
    n = idx
    while True:
        s = chr(65 + n % 26) + s
        n = n // 26 - 1
        if n < 0:
            break
    return s

def build(records, columns, image_bytes_map, row_heights, img_h_cache, col_widths, img_col_w=220):
    image_entries = []
    img_idx = 0
    for i, rec in enumerate(records):
        path = rec.get('imagePath', '')
        d = image_bytes_map.get(path)
        if not path or not d:
            continue
        img_idx += 1
        image_entries.append(('rId%d' % img_idx, img_idx, i, 'jpeg'))

    z = ZipStoreWriter()

    content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Default Extension="jpeg" ContentType="image/jpeg"/>'
        '<Default Extension="jpg" ContentType="image/jpeg"/>'
        '<Default Extension="png" ContentType="image/png"/>'
        '<Default Extension="gif" ContentType="image/gif"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
        '</Types>')
    z.add('[Content_Types].xml', content_types)

    root_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>')
    z.add('_rels/.rels', root_rels)

    workbook = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>'
        '</workbook>')
    z.add('xl/workbook.xml', workbook)

    wb_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        '</Relationships>')
    z.add('xl/_rels/workbook.xml.rels', wb_rels)

    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<numFmts count="1"><numFmt numFmtId="164" formatCode="@"/></numFmts>'
        '<fonts count="2">'
        '<font><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
        '</fonts>'
        '<fills count="3">'
        '<fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FF4472C4"/><bgColor indexed="64"/></patternFill></fill>'
        '</fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="3">'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="0"/>'
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1">'
        '<alignment vertical="center" wrapText="1"/>'
        '</xf>'
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">'
        '<alignment horizontal="center" vertical="center"/>'
        '</xf>'
        '</cellXfs>'
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        '</styleSheet>')
    z.add('xl/styles.xml', styles)

    def px_to_row_h(px):
        return round(px * 0.75)

    parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">',
        '<cols>']
    for i, col in enumerate(columns):
        w = col_widths.get(col[0], 80)
        cw = max(8, round(w / 7))
        parts.append('<col min="%d" max="%d" width="%d" customWidth="1"/>' % (i + 1, i + 1, cw))
    parts.append('</cols>')
    parts.append('<sheetData>')
    parts.append('<row r="1" ht="%d" customHeight="1">' % px_to_row_h(28))
    for i, col in enumerate(columns):
        parts.append('<c r="%s1" s="2" t="inlineStr"><is><t>%s</t></is></c>' % (col_letter(i), xml_escape(col[1])))
    parts.append('</row>')
    for ri, rec in enumerate(records):
        row_idx = ri + 2
        parts.append('<row r="%d" ht="%d" customHeight="1">' % (row_idx, px_to_row_h(row_heights[ri])))
        for ci, col in enumerate(columns):
            ref = col_letter(ci) + str(row_idx)
            if col[2]:  # isImage
                parts.append('<c r="%s" s="1"/>' % ref)
            else:
                parts.append('<c r="%s" s="1" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (ref, xml_escape(rec.get(col[0], ''))))
        parts.append('</row>')
    parts.append('</sheetData>')
    if image_entries:
        parts.append('<drawing r:id="rId3"/>')
    parts.append('</worksheet>')
    z.add('xl/worksheets/sheet1.xml', ''.join(parts))

    if image_entries:
        z.add('xl/worksheets/_rels/sheet1.xml.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>'
            '</Relationships>')

        EMU = 9525
        dparts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" '
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">']
        for i, (rid, idx, record_idx, ext) in enumerate(image_entries):
            img_h = img_h_cache[record_idx]
            row_idx = record_idx + 2
            dparts.append('<xdr:twoCellAnchor>')
            dparts.append('<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>%d</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' % (row_idx - 1))
            dparts.append('<xdr:to><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>%d</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' % row_idx)
            dparts.append('<xdr:pic>')
            dparts.append('<xdr:nvPicPr><xdr:cNvPr id="%d" name="图片%d"/><xdr:cNvPicPr/></xdr:nvPicPr>' % (i + 1, i + 1))
            dparts.append('<xdr:blipFill><a:blip r:embed="%s"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' % rid)
            dparts.append('<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>' % (img_col_w * EMU, img_h * EMU))
            dparts.append('</xdr:pic>')
            dparts.append('<xdr:clientData/>')
            dparts.append('</xdr:twoCellAnchor>')
        dparts.append('</xdr:wsDr>')
        z.add('xl/drawings/drawing1.xml', ''.join(dparts))

        drels = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">']
        for rid, idx, _, ext in image_entries:
            drels.append('<Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image%d.%s"/>' % (rid, idx, ext))
        drels.append('</Relationships>')
        z.add('xl/drawings/_rels/drawing1.xml.rels', ''.join(drels))

        for rid, idx, record_idx, ext in image_entries:
            z.add('xl/media/image%d.%s' % (idx, ext), image_bytes_map[records[record_idx]['imagePath']])

    return z.finish()

if __name__ == '__main__':
    img_map = {}
    for i in range(3):
        im = Image.new('RGB', (800, 600), (i * 60, 120, 200))
        b = io.BytesIO()
        im.save(b, 'JPEG', quality=85)
        img_map['img%d.jpg' % i] = b.getvalue()

    columns = [('imagePath', 'FOTO', True), ('modelo', 'CODIGO', False),
               ('desEs', 'DETALLADOS', False), ('desZh', '描述', False),
               ('precio', 'PRECIO', False)]
    records = [{'imagePath': 'img%d.jpg' % i, 'modelo': 'M%03d' % i,
                'desEs': 'algún texto español', 'desZh': '中文描述',
                'precio': '12.50'} for i in range(3)]
    row_heights = [180, 180, 180]
    img_h_cache = [165, 165, 165]
    col_widths = {'imagePath': 220, 'modelo': 90, 'desEs': 200, 'desZh': 200, 'precio': 80}

    data = build(records, columns, img_map, row_heights, img_h_cache, col_widths)
    out = '/workspace/.tmp_xlsx_test/replica.xlsx'
    import os
    os.makedirs('/workspace/.tmp_xlsx_test', exist_ok=True)
    with open(out, 'wb') as f:
        f.write(data)
    print('written', out, len(data), 'bytes')
