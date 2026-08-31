package com.watermark.camera.core

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// MARK: - 水印渲染引擎（Android Canvas 移植，公式对齐 iOS WatermarkRenderer.swift）
//
// 渲染规则：每一项独立成行；标签一行、内容缩进另起一行；长文本自动换行；
// 水印块默认占图片宽 42%，支持 9 个预设位置 + 自定义坐标 + 缩放。

object WatermarkRenderer {

    // MARK: - 行/布局模型

    data class WMLine(
        val text: String,
        val isLabel: Boolean,
        val isInline: Boolean,
        val labelPart: String? = null,
        val valuePart: String? = null
    )

    data class WMLayout(
        val blockW: Float, val blockH: Float,
        val fontSize: Float, val lineHeight: Float,
        val padding: Float, val indent: Float,
        val borderRadius: Float,
        val x: Float, val y: Float,
        val lines: List<WMLine>,
        val textColor: Int,   // ARGB
        val isWide: Boolean
    )

    const val LABEL_COLOR = 0xFFFFE58F.toInt()

    private fun measurePaint(fontSize: Float): Paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = fontSize
        isFakeBoldText = false
    }

    // MARK: - 颜色解析

    /** 解析 "#ffffff" / "rgba(r,g,b,a)" / "rgb(r,g,b)"，返回 ARGB Int */
    fun parseColor(color: String?, overrideAlpha: Float? = null): Int {
        if (color.isNullOrBlank()) {
            val a = ((overrideAlpha ?: 0.6f) * 255).toInt().coerceIn(0, 255)
            return (a shl 24)
        }
        val c = color.trim()
        try {
            if (c.startsWith("rgba(")) {
                val parts = c.removePrefix("rgba(").removeSuffix(")").split(",").map { it.trim() }
                if (parts.size >= 3) {
                    val r = parts[0].toFloat(); val g = parts[1].toFloat(); val b = parts[2].toFloat()
                    val a = overrideAlpha ?: (if (parts.size >= 4) parts[3].toFloat() else 1f)
                    return argb(a, r, g, b)
                }
            }
            if (c.startsWith("rgb(")) {
                val parts = c.removePrefix("rgb(").removeSuffix(")").split(",").map { it.trim() }
                if (parts.size >= 3) {
                    val a = overrideAlpha ?: 1f
                    return argb(a, parts[0].toFloat(), parts[1].toFloat(), parts[2].toFloat())
                }
            }
            if (c.startsWith("#")) {
                var h = c.removePrefix("#")
                if (h.length == 3) h = h.map { "$it$it" }.joinToString("")
                if (h.length == 6) {
                    val v = h.toLong(16)
                    val r = ((v shr 16) and 0xFF).toFloat()
                    val g = ((v shr 8) and 0xFF).toFloat()
                    val b = (v and 0xFF).toFloat()
                    return argb(overrideAlpha ?: 1f, r, g, b)
                }
            }
        } catch (_: Exception) { }
        val a = ((overrideAlpha ?: 0.6f) * 255).toInt().coerceIn(0, 255)
        return (a shl 24)
    }

    private fun argb(alpha: Float, r: Float, g: Float, b: Float): Int {
        val a = (alpha.coerceIn(0f, 1f) * 255).toInt()
        return Color.argb(a, r.toInt().coerceIn(0, 255), g.toInt().coerceIn(0, 255), b.toInt().coerceIn(0, 255))
    }

    /** 从 rgba() 提取 alpha */
    fun extractAlpha(rgba: String?): Float? {
        if (rgba == null || !rgba.startsWith("rgba(")) return null
        val parts = rgba.removePrefix("rgba(").removeSuffix(")").split(",").map { it.trim() }
        return if (parts.size >= 4) parts[3].toFloatOrNull() else null
    }

    // MARK: - 布局计算（与 iOS computeLayout 对齐）

    fun computeLayout(
        template: WatermarkTemplate,
        values: Map<String, String>,
        cw: Float, ch: Float,
        customX: Float? = null, customY: Float? = null,
        customScale: Float = 1f, customScaleX: Float = 1f, customScaleY: Float = 1f
    ): WMLayout? {
        val style = template.style
        val ratio = cw / 750f
        val scale = customScale
        val sx = customScaleX
        val sy = customScaleY
        // 垂直缩放作用于字号；水平缩放仅作用于块宽（文字重排）
        val fontSize = max(14f, (style.fontSize * ratio * scale * sy).roundToInt().toFloat())
        val lineHeight = (fontSize * style.lineHeight).roundToInt().toFloat()
        val padding = (style.padding * ratio * scale * sy).roundToInt().toFloat()
        val borderRadius = (style.borderRadius * ratio).roundToInt().toFloat()
        val blockW = (cw * template.widthRatio * scale * sx).roundToInt().toFloat()
        val indent = (fontSize * 1.4f).roundToInt().toFloat()
        val textInnerW = blockW - padding * 2

        val wide = template.widthRatio >= 0.5
        val font = measurePaint(fontSize)
        val lines = computeLines(template, values, textInnerW, indent, font, wide)
        if (lines.isEmpty()) return null

        val margin = (cw * 0.04f).roundToInt().toFloat()
        val blockH = padding * 2 + lines.size * lineHeight
        val cx = (cw - blockW) / 2f
        val position = template.position

        var x: Float = when {
            customX != null -> customX
            position == "bottom-center" || position == "top-center" || position == "center" -> cx
            position.contains("right") -> cw - blockW - margin
            else -> margin
        }
        var y: Float = when {
            customY != null -> customY
            position.contains("top") -> margin
            position.contains("center") -> (ch - blockH) / 2f
            else -> ch - blockH - margin
        }
        x = x.coerceIn(margin, max(margin, cw - blockW - margin))
        y = y.coerceIn(margin, max(margin, ch - blockH - margin))

        return WMLayout(blockW, blockH, fontSize, lineHeight, padding, indent, borderRadius,
            x, y, lines, parseColor(style.colorHex, 1f), wide)
    }

    private fun computeLines(
        template: WatermarkTemplate,
        values: Map<String, String>,
        textInnerW: Float,
        indent: Float,
        font: Paint,
        isWide: Boolean
    ): List<WMLine> {
        val lines = mutableListOf<WMLine>()
        for (f in template.fields) {
            val raw = values[f.key] ?: continue
            if (raw.isBlank()) continue
            val v = raw.trim()
            val labelText = f.label + ":"
            val isMultiline = f.multiline || f.type == FieldType.TEXTAREA

            if (isWide && !isMultiline && !v.contains("\n")) {
                val combined = "$labelText $v"
                if (font.measureText(combined) <= textInnerW) {
                    lines.add(WMLine(combined, false, true, labelText, v))
                } else {
                    lines.add(WMLine(labelText, true, false))
                    lines.add(WMLine(v, false, false))
                }
            } else {
                lines.add(WMLine(labelText, true, false))
                val paragraphs = v.split("\n")
                for (p in paragraphs) {
                    if (p.isBlank() && paragraphs.size > 1) {
                        // 空段落保留一行行距
                        lines.add(WMLine("", false, false))
                        continue
                    }
                    wrapText(p, textInnerW - indent, font).forEach { lines.add(WMLine(it, false, false)) }
                }
            }
        }
        return lines
    }

    /** 文本自动换行（单词优先、超长单词逐字断行，与 iOS/JS 对齐） */
    fun wrapText(text: String, maxWidth: Float, font: Paint): List<String> {
        if (text.isEmpty() || maxWidth <= 0) return if (text.isEmpty()) emptyList() else listOf(text)
        val tokens = text.split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (tokens.isEmpty()) return emptyList()

        val lines = mutableListOf<String>()
        var current = ""
        for (token in tokens) {
            val candidate = if (current.isEmpty()) token else "$current $token"
            if (current.isNotEmpty() && font.measureText(candidate) <= maxWidth) {
                current = candidate
            } else {
                if (current.isNotEmpty()) {
                    lines.add(current); current = ""
                }
                if (font.measureText(token) > maxWidth) {
                    // 硬断：逐字符
                    var sub = ""
                    for (ch in token) {
                        val test = sub + ch
                        if (font.measureText(test) > maxWidth && sub.isNotEmpty()) {
                            lines.add(sub); sub = ch.toString()
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
        if (current.isNotEmpty()) lines.add(current)
        return lines
    }

    // MARK: - 绘制

    private fun drawBlock(layout: WMLayout, canvas: Canvas, originX: Float, originY: Float,
                          bgColor: Int) {
        // 圆角背景
        val radius = min(layout.borderRadius, min(layout.blockW / 2, layout.blockH / 2))
        val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = bgColor }
        canvas.drawRoundRect(
            RectF(originX, originY, originX + layout.blockW, originY + layout.blockH),
            radius, radius, bgPaint)

        // 文本（标签金色，内容用模板色；黑描边增强可读性）
        val font = measurePaint(layout.fontSize)
        val fm = font.fontMetrics
        val strokePct = max(2f, layout.fontSize / 8f)

        fun drawText(text: String, x: Float, top: Float, color: Int, maxWidth: Float) {
            if (text.isEmpty()) return
            // 行内垂直居中（top 为行框顶部）
            val baseline = top + (layout.lineHeight - (fm.descent - fm.ascent)) / 2f - fm.ascent
            // 描边
            font.style = Paint.Style.STROKE
            font.strokeWidth = strokePct
            font.color = (0x55000000).toInt()
            canvas.drawText(text.take(4000), x, baseline, font)
            // 填充
            font.style = Paint.Style.FILL
            font.strokeWidth = 0f
            font.color = color
            canvas.drawText(text.take(4000), x, baseline, font)
        }

        for ((i, ln) in layout.lines.withIndex()) {
            if (ln.text.isEmpty()) continue
            val isContentLine = !ln.isLabel && !ln.isInline
            val tx = originX + layout.padding + (if (isContentLine) layout.indent else 0f)
            val ty = originY + layout.padding + i * layout.lineHeight

            if (ln.isInline && ln.labelPart != null && ln.valuePart != null) {
                drawText("${ln.labelPart} ", tx, ty, LABEL_COLOR, layout.blockW)
                val labelW = font.measureText("${ln.labelPart} ")
                drawText(ln.valuePart, tx + labelW, ty, layout.textColor, layout.blockW - labelW)
            } else {
                drawText(ln.text, tx, ty, if (ln.isLabel) LABEL_COLOR else layout.textColor, layout.blockW)
            }
        }
    }

    // MARK: - 对外渲染入口

    /** 渲染带水印的完整图片；customX/customY 为图片坐标系内水印块左上角 */
    fun render(template: WatermarkTemplate,
               values: Map<String, String>,
               image: Bitmap,
               customX: Float? = null, customY: Float? = null,
               customScale: Float = 1f, customScaleX: Float = 1f, customScaleY: Float = 1f,
               opacity: Float? = null): Bitmap? {
        // 长边上限对齐 iOS（4096）；低内存机型 OOM 时逐级降档重试，
        // 保证“能保存出图”优先于“满分辨率”
        for (maxEdge in intArrayOf(4096, 3072, 2048)) {
            try {
                return renderAt(template, values, image, maxEdge,
                    customX, customY, customScale, customScaleX, customScaleY, opacity)
            } catch (_: OutOfMemoryError) {
                // 降档重试
            } catch (_: Exception) {
                return null
            }
        }
        return null
    }

    private fun renderAt(template: WatermarkTemplate,
                         values: Map<String, String>,
                         image: Bitmap,
                         maxEdge: Int,
                         customX: Float?, customY: Float?,
                         customScale: Float, customScaleX: Float, customScaleY: Float,
                         opacity: Float?): Bitmap? {
        return run {
            var imgW = image.width.toFloat()
            var imgH = image.height.toFloat()
            val edge = maxEdge.toFloat()
            var bmp = image
            var scaledByUs = false
            if (max(imgW, imgH) > edge) {
                val s = edge / max(imgW, imgH)
                imgW = (imgW * s).roundToInt().toFloat()
                imgH = (imgH * s).roundToInt().toFloat()
                bmp = Bitmap.createScaledBitmap(image, imgW.toInt(), imgH.toInt(), true)
                scaledByUs = bmp !== image
            }

            val out = bmp.copy(Bitmap.Config.ARGB_8888, true)
            // copy 成功后可释放缩放中间位图
            if (scaledByUs) bmp.recycle()

            val canvas = Canvas(out)
            val layout = computeLayout(template, values, imgW, imgH, customX, customY,
                customScale, customScaleX, customScaleY) ?: return@run out
            val op = opacity ?: (extractAlpha(template.style.backgroundRGBA) ?: 0.72f)
            drawBlock(layout, canvas, layout.x, layout.y,
                parseColor(template.style.backgroundRGBA, op))
            out
        }
    }

    /** 水印块尺寸（px），与 computeLayout 同参，用于预览与坐标换算 */
    fun blockSize(template: WatermarkTemplate, values: Map<String, String>,
                  canvasWidth: Float, scale: Float = 1f,
                  scaleX: Float = 1f, scaleY: Float = 1f): Pair<Float, Float>? {
        val style = template.style
        val ratio = canvasWidth / 750f
        val fontSize = max(14f, (style.fontSize * ratio * scale * scaleY).roundToInt().toFloat())
        val lineHeight = (fontSize * style.lineHeight).roundToInt().toFloat()
        val padding = (style.padding * ratio * scale * scaleY).roundToInt().toFloat()
        val blockW = (canvasWidth * template.widthRatio * scale * scaleX).roundToInt().toFloat()
        val indent = (fontSize * 1.4f).roundToInt().toFloat()
        val textInnerW = max(blockW - padding * 2, 10f)
        val font = measurePaint(fontSize)
        val wide = template.widthRatio >= 0.5
        val lines = computeLines(template, values, textInnerW, indent, font, wide)
        if (lines.isEmpty()) return null
        val blockH = padding * 2 + lines.size * lineHeight
        return blockW to blockH
    }

    /** 估算块高 */
    fun estimateBlockHeight(template: WatermarkTemplate, values: Map<String, String>,
                            canvasWidth: Float, scale: Float = 1f): Float =
        blockSize(template, values, canvasWidth, scale)?.second ?: 80f

    /** 仅绘制水印块（透明背景位图），用于相机/编辑器实时浮层 */
    fun blockPreview(template: WatermarkTemplate, values: Map<String, String>,
                    canvasWidth: Float, scale: Float = 1f,
                    scaleX: Float = 1f, scaleY: Float = 1f,
                    opacity: Float? = null,
                    density: Float = 2f): Bitmap? {
        val (w, h) = blockSize(template, values, canvasWidth, scale, scaleX, scaleY) ?: return null
        val style = template.style
        val ratio = canvasWidth / 750f
        val fontSize = max(14f, (style.fontSize * ratio * scale * scaleY).roundToInt().toFloat())
        val lineHeight = (fontSize * style.lineHeight).roundToInt().toFloat()
        val padding = (style.padding * ratio * scale * scaleY).roundToInt().toFloat()
        val indent = (fontSize * 1.4f).roundToInt().toFloat()
        val textInnerW = max(w - padding * 2, 10f)
        val wide = template.widthRatio >= 0.5
        val font = measurePaint(fontSize)
        val lines = computeLines(template, values, textInnerW, indent, font, wide)

        val bmp = Bitmap.createBitmap(
            max((w * density).toInt(), 1), max((h * density).toInt(), 1), Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        canvas.scale(density, density)
        val layout = WMLayout(w, h, fontSize, lineHeight, padding, indent,
            (style.borderRadius * ratio).roundToInt().toFloat(), 0f, 0f,
            lines, parseColor(style.colorHex, 1f), wide)
        drawBlock(layout, canvas, 0f, 0f,
            parseColor(style.backgroundRGBA, opacity ?: extractAlpha(style.backgroundRGBA)))
        return bmp
    }
}

// MARK: - 浮层坐标 → 渲染参数换算（与 iOS OverlayMapper 一致）

object OverlayMapper {

    data class RenderParams(
        val customX: Float, val customY: Float,
        val scale: Float, val scaleX: Float, val scaleY: Float
    )

    /**
     * 把浮层放置换算为最终渲染所需的像素坐标。
     * @param canvasPoints 预览画布显示尺寸（px，即图像显示区域）
     * @param imagePixels 最终图片像素尺寸
     */
    fun renderParams(template: WatermarkTemplate, values: Map<String, String>,
                     placement: OverlayPlacement,
                     canvasW: Float, canvasH: Float,
                     imageW: Float, imageH: Float): RenderParams? {
        val size = WatermarkRenderer.blockSize(template, values, canvasW,
            placement.scale.toFloat(), placement.scaleX.toFloat(), placement.scaleY.toFloat())
            ?: return null
        if (canvasW <= 0 || canvasH <= 0) return null
        val sx = imageW / canvasW
        val sy = imageH / canvasH
        val centerX = canvasW / 2 + placement.dx.toFloat() * canvasW
        val centerY = canvasH / 2 + placement.dy.toFloat() * canvasH
        val customX = (centerX - size.first / 2) * sx
        val customY = (centerY - size.second / 2) * sy
        return RenderParams(customX, customY,
            placement.scale.toFloat(), placement.scaleX.toFloat(), placement.scaleY.toFloat())
    }

    /** 依据模板预设位置计算初始放置（9 宫格） */
    fun defaultPlacement(template: WatermarkTemplate, canvasW: Float, canvasH: Float): OverlayPlacement {
        val blockW = canvasW * template.widthRatio.toFloat()
        val blockH = WatermarkRenderer.estimateBlockHeight(template, emptyMap(), canvasW)
        val marginFraction = 0.04f
        val pos = template.position

        val dx: Float = when {
            pos.contains("left") -> -(0.5f - blockW / (2 * canvasW) - marginFraction)
            pos.contains("right") -> 0.5f - blockW / (2 * canvasW) - marginFraction
            else -> 0f
        }
        // dy 向下为正：top 取负、bottom 取正
        val dy: Float = when {
            pos.contains("top") -> -(0.5f - blockH / (2 * canvasH) - marginFraction)
            pos.contains("bottom") -> 0.5f - blockH / (2 * canvasH) - marginFraction
            else -> 0f
        }
        return OverlayPlacement(dx.toDouble(), dy.toDouble(), 1.0)
    }
}
