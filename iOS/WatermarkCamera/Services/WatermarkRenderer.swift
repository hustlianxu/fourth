import UIKit
import CoreGraphics

// MARK: - 水印渲染引擎（Core Graphics / UIKit 移植，对齐小程序 utils/watermark.js）
//
// 渲染规则：每一项独立成行；标签一行、内容缩进另起一行；长文本自动换行；
// 水印块默认占图片宽 42%，支持 9 个预设位置 + 自定义坐标 + 缩放 + 透明度。

enum WatermarkRenderer {

    // MARK: - 行模型

    struct WMLine {
        var text: String
        var isLabel: Bool
        var isInline: Bool
        var labelPart: String?
        var valuePart: String?
    }

    struct WMLayout {
        var blockW: CGFloat
        var blockH: CGFloat
        var fontSize: CGFloat
        var lineHeight: CGFloat
        var padding: CGFloat
        var indent: CGFloat
        var borderRadius: CGFloat
        var x: CGFloat
        var y: CGFloat
        var lines: [WMLine]
        var textColor: UIColor
        var isWide: Bool
    }

    static let labelColor = UIColor(red: 1, green: 0.898, blue: 0.561, alpha: 1) // #ffe58f

    // MARK: - 颜色解析

    static func parseColor(_ color: String?, overrideAlpha: CGFloat?) -> UIColor {
        guard let color = color, !color.isEmpty else {
            return UIColor(white: 0, alpha: overrideAlpha ?? 0.6)
        }
        // rgba(r,g,b,a)
        if color.hasPrefix("rgba(") {
            if let c = extractRGB(color[color.index(color.startIndex, offsetBy: 4)...]) {
                let alpha = overrideAlpha ?? c.a
                return UIColor(red: c.r, green: c.g, blue: c.b, alpha: alpha)
            }
        }
        // rgb(r,g,b)
        if color.hasPrefix("rgb(") {
            if let c = extractRGB(color[color.index(color.startIndex, offsetBy: 3)...]) {
                return UIColor(red: c.r, green: c.g, blue: c.b, alpha: overrideAlpha ?? 1)
            }
        }
        // #hex
        if color.hasPrefix("#") {
            return hexColor(color, alpha: overrideAlpha ?? 1)
        }
        return UIColor(white: 0, alpha: overrideAlpha ?? 0.6)
    }

    /// 从 "(r,g,b,a)" 片段解析颜色；返回归一化 RGBA 分量（UIColor 无 r/g/b/alpha 成员，须以分量传递）
    private static func extractRGB(_ s: Substring) -> (r: CGFloat, g: CGFloat, b: CGFloat, a: CGFloat)? {
        // 去掉首尾括号
        var str = String(s)
        str = str.trimmingCharacters(in: .whitespaces)
        if str.hasPrefix("(") { str.removeFirst() }
        if str.hasSuffix(")") { str.removeLast() }
        let parts = str.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        guard parts.count >= 3 else { return nil }
        guard let r = Double(parts[0]), let g = Double(parts[1]), let b = Double(parts[2]) else { return nil }
        var a: Double = 1
        if parts.count >= 4, let av = Double(parts[3]) { a = av }
        return (r: CGFloat(r / 255), g: CGFloat(g / 255), b: CGFloat(b / 255), a: CGFloat(a))
    }

    private static func hexColor(_ hex: String, alpha: CGFloat) -> UIColor {
        var h = String(hex.dropFirst())
        if h.count == 3 {
            h = h.map { String($0) + String($0) }.joined()
        }
        guard h.count == 6, let value = UInt64(h, radix: 16) else {
            return UIColor(white: 0, alpha: alpha)
        }
        let r = CGFloat((value >> 16) & 0xFF) / 255
        let g = CGFloat((value >> 8) & 0xFF) / 255
        let b = CGFloat(value & 0xFF) / 255
        return UIColor(red: r, green: g, blue: b, alpha: alpha)
    }

    // MARK: - 布局计算（与 JS renderTemplate 对齐）

    static func isWide(widthRatio: Double) -> Bool {
        (widthRatio == 0 ? 0.42 : widthRatio) >= 0.5
    }

    static func computeLayout(template: WatermarkTemplate,
                              values: [String: String],
                              cw: CGFloat,
                              ch: CGFloat,
                              customX: CGFloat? = nil,
                              customY: CGFloat? = nil,
                              customScale: CGFloat? = nil,
                              widthRatio: Double? = nil) -> WMLayout? {
        let style = template.style
        let ratio = cw / 750
        let scale = customScale ?? 1
        let wRatio = widthRatio == nil ? template.widthRatio : widthRatio!
        let fontSize = max(14, (style.fontSize * Double(ratio) * Double(scale)).rounded())
        let lineHeight = (fontSize * CGFloat(style.lineHeight)).rounded()
        let padding = (CGFloat(style.padding) * ratio * scale).rounded()
        let borderRadius = (CGFloat(style.borderRadius) * ratio).rounded()

        let blockW = (cw * CGFloat(wRatio) * scale).rounded()
        let indent = (fontSize * 1.4).rounded()
        let textInnerW = blockW - padding * 2

        let wide = wRatio >= 0.5
        let font = UIFont.systemFont(ofSize: fontSize)
        let lines = computeLines(template: template, values: values,
                                 textInnerW: textInnerW, indent: indent,
                                 font: font, isWide: wide)
        guard !lines.isEmpty else { return nil }

        let margin = (cw * 0.04).rounded()
        // 注意：CGFloat 乘整数字面量（如 * 2）在 CGFloat/Double 隐式互转下会产生
        // "Ambiguous use of operator '*'"，须用浮点字面量 2.0 显式定宽
        let blockH = padding * 2.0 + CGFloat(lines.count) * lineHeight
        let cx = (cw - blockW) / 2
        let position = template.position

        var x: CGFloat
        if let customX = customX {
            x = customX
        } else if position == "bottom-center" || position == "top-center" || position == "center" {
            x = cx
        } else if position.contains("right") {
            x = cw - blockW - margin
        } else {
            x = margin
        }

        var y: CGFloat
        if let customY = customY {
            y = customY
        } else if position.contains("top") {
            y = margin
        } else if position.contains("center") {
            y = (ch - blockH) / 2
        } else {
            y = ch - blockH - margin
        }

        x = max(margin, min(x, cw - blockW - margin))
        y = max(margin, min(y, ch - blockH - margin))

        return WMLayout(blockW: blockW, blockH: blockH, fontSize: fontSize,
                        lineHeight: lineHeight, padding: padding, indent: indent,
                        borderRadius: borderRadius, x: x, y: y, lines: lines,
                        textColor: parseColor(style.colorHex, overrideAlpha: 1),
                        isWide: wide)
    }

    private static func computeLines(template: WatermarkTemplate,
                                     values: [String: String],
                                     textInnerW: CGFloat,
                                     indent: CGFloat,
                                     font: UIFont,
                                     isWide: Bool) -> [WMLine] {
        var lines: [WMLine] = []
        for f in template.fields {
            guard let raw = values[f.key], !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
            let v = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            let labelText = f.label + ":"
            let isMultiline = f.multiline || f.type == .textarea

            if isWide && !isMultiline && !v.contains("\n") {
                let combined = labelText + " " + v
                if textWidth(combined, font: font) <= textInnerW {
                    lines.append(WMLine(text: combined, isLabel: false, isInline: true,
                                        labelPart: labelText, valuePart: v))
                } else {
                    lines.append(WMLine(text: labelText, isLabel: true, isInline: false, labelPart: nil, valuePart: nil))
                    lines.append(WMLine(text: v, isLabel: false, isInline: false, labelPart: nil, valuePart: nil))
                }
            } else {
                lines.append(WMLine(text: labelText, isLabel: true, isInline: false, labelPart: nil, valuePart: nil))
                let paragraphs = v.components(separatedBy: "\n")
                for p in paragraphs {
                    if p.trimmingCharacters(in: .whitespaces).isEmpty && paragraphs.count > 1 {
                        // 空段落保留一行行距
                        lines.append(WMLine(text: "", isLabel: false, isInline: false, labelPart: nil, valuePart: nil))
                        continue
                    }
                    for sub in wrapText(p, maxWidth: textInnerW - indent, font: font) {
                        lines.append(WMLine(text: sub, isLabel: false, isInline: false, labelPart: nil, valuePart: nil))
                    }
                }
            }
        }
        return lines
    }

    /// 文本自动换行（与 JS wrapText 对齐，单词优先、超长单词逐字断行）
    static func wrapText(_ text: String, maxWidth: CGFloat, font: UIFont) -> [String] {
        guard !text.isEmpty else { return [] }
        // 与 JS 的 split(/(\s+)/) 等价的词拆分
        let rawTokens = text.components(separatedBy: CharacterSet.whitespacesAndNewlines)
        let tokens = rawTokens.filter { !$0.isEmpty }
        guard !tokens.isEmpty else { return [] }

        var lines: [String] = []
        var current = ""
        for token in tokens {
            let candidate = current.isEmpty ? token : current + " " + token
            if !current.isEmpty && textWidth(candidate, font: font) <= maxWidth {
                current = candidate
            } else {
                if !current.isEmpty {
                    lines.append(current)
                    current = ""
                }
                if textWidth(token, font: font) > maxWidth {
                    // 硬断：逐字符
                    var sub = ""
                    for ch in token {
                        let test = sub + String(ch)
                        if textWidth(test, font: font) > maxWidth && !sub.isEmpty {
                            lines.append(sub)
                            sub = String(ch)
                        } else {
                            sub = test
                        }
                    }
                    current = sub
                } else {
                    current = token
                }
            }
        }
        if !current.isEmpty { lines.append(current) }
        return lines
    }

    private static func textWidth(_ s: String, font: UIFont) -> CGFloat {
        (s as NSString).size(withAttributes: [.font: font]).width
    }

    // MARK: - 绘制

    private static func drawBlock(_ layout: WMLayout,
                                  origin: CGPoint,
                                  bgColor: UIColor?,
                                  opacity: CGFloat?) {
        // 背景
        let bgColor = bgColor ?? UIColor(white: 0, alpha: opacity ?? 0.72)
        let radius = min(layout.borderRadius, layout.blockW / 2, layout.blockH / 2)
        let bgRect = CGRect(x: origin.x, y: origin.y, width: layout.blockW, height: layout.blockH)
        let path = UIBezierPath(roundedRect: bgRect, cornerRadius: radius)
        bgColor.setFill()
        path.fill()

        // 文本
        let font = UIFont.systemFont(ofSize: layout.fontSize)
        let para = NSMutableParagraphStyle()
        para.lineBreakMode = .byClipping
        para.alignment = .left
        let strokePct = max(2, layout.fontSize / 8) / layout.fontSize * 100

        for (i, ln) in layout.lines.enumerated() {
            guard !ln.text.isEmpty else { continue }
            let isContentLine = !ln.isLabel && !ln.isInline
            let tx = origin.x + layout.padding + (isContentLine ? layout.indent : 0)
            let ty = origin.y + layout.padding + CGFloat(i) * layout.lineHeight

            if ln.isInline, let labelPart = ln.labelPart, let valuePart = ln.valuePart {
                let labelStr = labelPart + " "
                drawText(labelStr, at: CGPoint(x: tx, y: ty), maxWidth: layout.blockW,
                         font: font, color: Self.labelColor, strokePct: strokePct, para: para)
                let labelW = textWidth(labelStr, font: font)
                drawText(valuePart, at: CGPoint(x: tx + labelW, y: ty), maxWidth: layout.blockW - labelW,
                         font: font, color: layout.textColor, strokePct: strokePct, para: para)
            } else {
                let color = ln.isLabel ? Self.labelColor : layout.textColor
                drawText(ln.text, at: CGPoint(x: tx, y: ty), maxWidth: layout.blockW,
                         font: font, color: color, strokePct: strokePct, para: para)
            }
        }
    }

    private static func drawText(_ text: String,
                                 at point: CGPoint,
                                 maxWidth: CGFloat,
                                 font: UIFont,
                                 color: UIColor,
                                 strokePct: CGFloat,
                                 para: NSMutableParagraphStyle) {
        let rect = CGRect(x: point.x, y: point.y, width: max(maxWidth, 1), height: font.lineHeight + 4)
        let attrs: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: color,
            .strokeColor: UIColor(white: 0, alpha: 0.5),
            .strokeWidth: -strokePct,   // 描边+填充，等效 JS strokeText(描边) + fillText(填充)
            .paragraphStyle: para
        ]
        (text as NSString).draw(in: rect, withAttributes: attrs)
    }

    // MARK: - 对外渲染入口

    /// 渲染带水印图片：cu/cy 为画布（canvas）坐标系内的水印块左上角坐标
    static func render(template: WatermarkTemplate,
                       values: [String: String],
                       image: UIImage,
                       customX: CGFloat? = nil,
                       customY: CGFloat? = nil,
                       customScale: CGFloat? = nil,
                       opacity: CGFloat? = nil,
                       widthRatio: Double? = nil) -> UIImage? {
        // 像素尺寸
        var imgW = CGFloat(image.size.width) * image.scale
        var imgH = CGFloat(image.size.height) * image.scale
        // 长边最大 4096
        let maxEdge: CGFloat = 4096
        if max(imgW, imgH) > maxEdge {
            let s = maxEdge / max(imgW, imgH)
            imgW = round(imgW * s)
            imgH = round(imgH * s)
        }

        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 1
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: imgW, height: imgH), format: fmt)
        return renderer.image { ctx in
            image.draw(in: CGRect(x: 0, y: 0, width: imgW, height: imgH))
            guard let layout = computeLayout(template: template, values: values,
                                             cw: imgW, ch: imgH,
                                             customX: customX, customY: customY,
                                             customScale: customScale,
                                             widthRatio: widthRatio) else { return }
            let opacity = opacity ?? extractAlpha(template.style.backgroundRGBA)
            drawBlock(layout, origin: CGPoint(x: layout.x, y: layout.y),
                      bgColor: parseColor(template.style.backgroundRGBA, overrideAlpha: opacity),
                      opacity: opacity)
        }
    }

    /// 计算水印块在「画布宽 = canvasWidth」坐标系下的尺寸（pts）
    /// 与 computeLayout(cw:canvasWidth) 完全同参，仅用于预览与坐标换算。
    static func blockSize(template: WatermarkTemplate,
                          values: [String: String],
                          canvasWidth: CGFloat,
                          scale: CGFloat = 1) -> CGSize? {
        let style = template.style
        let ratio = canvasWidth / 750
        let wRatio = template.widthRatio
        let fontSize = max(14, (style.fontSize * Double(ratio) * Double(scale)).rounded())
        let lineHeight = (fontSize * CGFloat(style.lineHeight)).rounded()
        let padding = (CGFloat(style.padding) * ratio * scale).rounded()
        let blockW = (canvasWidth * CGFloat(wRatio) * scale).rounded()
        let indent = (fontSize * 1.4).rounded()
        let textInnerW = max(blockW - padding * 2.0, 10)
        let font = UIFont.systemFont(ofSize: fontSize)
        let wide = wRatio >= 0.5
        let lines = computeLines(template: template, values: values,
                                 textInnerW: textInnerW, indent: indent,
                                 font: font, isWide: wide)
        guard !lines.isEmpty else { return nil }
        let blockH = padding * 2.0 + CGFloat(lines.count) * lineHeight
        return CGSize(width: blockW, height: blockH)
    }

    /// 仅绘制水印块（透明背景），用于相机/编辑器的实时浮层
    /// canvasWidth = 预览画布显示宽度（pts）；scale = 用户缩放手势系数
    static func blockPreview(template: WatermarkTemplate,
                             values: [String: String],
                             canvasWidth: CGFloat,
                             scale: CGFloat = 1,
                             opacity: CGFloat?) -> UIImage? {
        guard let size = blockSize(template: template, values: values,
                                   canvasWidth: canvasWidth, scale: scale) else { return nil }
        let style = template.style
        let ratio = canvasWidth / 750
        let fontSize = max(14, (style.fontSize * Double(ratio) * Double(scale)).rounded())
        let lineHeight = (fontSize * CGFloat(style.lineHeight)).rounded()
        let padding = (CGFloat(style.padding) * ratio * scale).rounded()
        let indent = (fontSize * 1.4).rounded()
        let blockW = size.width
        let textInnerW = max(blockW - padding * 2.0, 10)
        let wide = template.widthRatio >= 0.5
        let font = UIFont.systemFont(ofSize: fontSize)
        let lines = computeLines(template: template, values: values,
                                 textInnerW: textInnerW, indent: indent,
                                 font: font, isWide: wide)

        let layout = WMLayout(blockW: blockW, blockH: size.height, fontSize: fontSize,
                              lineHeight: lineHeight, padding: padding, indent: indent,
                              borderRadius: (CGFloat(style.borderRadius) * ratio).rounded(),
                              x: 0, y: 0, lines: lines,
                              textColor: parseColor(style.colorHex, overrideAlpha: 1),
                              isWide: wide)

        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = UIScreen.main.scale
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: blockW, height: size.height), format: fmt)
        return renderer.image { _ in
            drawBlock(layout, origin: .zero,
                      bgColor: parseColor(style.backgroundRGBA, overrideAlpha: opacity),
                      opacity: opacity)
        }
    }

    /// 预估水印块高度（用于预览容器尺寸 / 坐标换算）
    static func estimateBlockHeight(template: WatermarkTemplate,
                                    values: [String: String],
                                    canvasWidth: CGFloat,
                                    scale: CGFloat = 1) -> CGFloat? {
        blockSize(template: template, values: values, canvasWidth: canvasWidth, scale: scale)?.height
    }

    /// 从 rgba() 字符串提取 alpha
    static func extractAlpha(_ rgba: String?) -> CGFloat? {
        guard let rgba = rgba, rgba.hasPrefix("rgba(") else { return nil }
        let inner = rgba.dropFirst(5).dropLast()
        let parts = inner.split(separator: ",")
        guard parts.count >= 4, let a = Double(parts[3].trimmingCharacters(in: .whitespaces)) else { return nil }
        return CGFloat(a)
    }
}