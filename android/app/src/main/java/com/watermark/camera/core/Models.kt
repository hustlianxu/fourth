package com.watermark.camera.core

import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// MARK: - 字段类型

enum class FieldType(val raw: String) {
    TEXT("text"), TEXTAREA("textarea"), DATE("date"), DATETIME("datetime"), TIME("time"), SELECT("select");

    val displayName: String
        get() = when (this) {
            TEXT -> "单行文本"; TEXTAREA -> "多行文本"; DATE -> "日期"
            DATETIME -> "日期时间"; TIME -> "时间"; SELECT -> "单选"
        }

    companion object {
        fun from(raw: String?): FieldType = entries.firstOrNull { it.raw == raw } ?: TEXT
    }
}

// MARK: - 模板

data class TemplateField(
    var key: String,
    var label: String,
    var type: FieldType = FieldType.TEXT,
    var placeholder: String? = null,
    var options: List<String>? = null,
    var required: Boolean = false,
    var multiline: Boolean = false,
    var defaultValue: String? = null
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("key", key); put("label", label); put("type", type.raw)
        placeholder?.let { put("placeholder", it) }
        options?.let { o -> put("options", JSONArray(o)) }
        if (required) put("required", true)
        if (multiline) put("multiline", true)
        defaultValue?.let { put("defaultValue", it) }
    }

    companion object {
        fun fromJson(o: JSONObject): TemplateField = TemplateField(
            key = o.optString("key"),
            label = o.optString("label"),
            type = FieldType.from(o.optString("type")),
            placeholder = if (o.has("placeholder")) o.getString("placeholder") else null,
            options = o.optJSONArray("options")?.let { a -> List(a.length()) { a.optString(it) } },
            required = o.optBoolean("required", false),
            multiline = o.optBoolean("multiline", false),
            defaultValue = if (o.has("defaultValue")) o.getString("defaultValue") else null
        )
    }
}

data class TemplateStyle(
    var fontSize: Double = 22.0,
    var colorHex: String = "#ffffff",
    var backgroundRGBA: String = "rgba(0,0,0,0.70)",
    var padding: Double = 14.0,
    var borderRadius: Double = 10.0,
    var lineHeight: Double = 1.35
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("fontSize", fontSize); put("colorHex", colorHex)
        put("backgroundRGBA", backgroundRGBA); put("padding", padding)
        put("borderRadius", borderRadius); put("lineHeight", lineHeight)
    }

    companion object {
        fun fromJson(o: JSONObject): TemplateStyle = TemplateStyle(
            fontSize = o.optDouble("fontSize", 22.0),
            colorHex = o.optString("colorHex", "#ffffff"),
            backgroundRGBA = o.optString("backgroundRGBA", "rgba(0,0,0,0.70)"),
            padding = o.optDouble("padding", 14.0),
            borderRadius = o.optDouble("borderRadius", 10.0),
            lineHeight = o.optDouble("lineHeight", 1.35)
        )
    }
}

data class WatermarkTemplate(
    var id: String,
    var name: String,
    var desc: String? = null,
    var isBuiltin: Boolean = false,
    var position: String = "bottom-center",
    var widthRatio: Double = 0.42,
    var style: TemplateStyle = TemplateStyle(),
    var fields: List<TemplateField> = emptyList()
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id); put("name", name); put("isBuiltin", isBuiltin)
        desc?.let { put("desc", it) }
        put("position", position); put("widthRatio", widthRatio)
        put("style", style.toJson())
        put("fields", JSONArray(fields.map { it.toJson() }))
    }

    companion object {
        fun fromJson(o: JSONObject): WatermarkTemplate = WatermarkTemplate(
            id = o.optString("id"),
            name = o.optString("name"),
            desc = if (o.has("desc")) o.getString("desc") else null,
            isBuiltin = o.optBoolean("isBuiltin", false),
            position = o.optString("position", "bottom-center"),
            widthRatio = o.optDouble("widthRatio", 0.42),
            style = o.optJSONObject("style")?.let { TemplateStyle.fromJson(it) } ?: TemplateStyle(),
            fields = o.optJSONArray("fields")?.let { a ->
                List(a.length()) { TemplateField.fromJson(a.getJSONObject(it)) }
            } ?: emptyList()
        )
    }
}

// MARK: - 水印放置状态（拖动 + 缩放），与 iOS OverlayPlacement 一致

data class OverlayPlacement(
    var dx: Double = 0.0,        // 归一化中心偏移（相对容器宽/高）
    var dy: Double = 0.0,
    var scale: Double = 1.0,     // 双指等比缩放
    var scaleX: Double = 1.0,     // 左右边缘拖动：仅块宽
    var scaleY: Double = 1.0     // 上下边缘拖动：字号/行距
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("dx", dx); put("dy", dy); put("scale", scale)
        put("scaleX", scaleX); put("scaleY", scaleY)
    }

    companion object {
        fun fromJson(o: JSONObject?): OverlayPlacement? = o?.run {
            OverlayPlacement(
                dx = optDouble("dx", 0.0), dy = optDouble("dy", 0.0),
                scale = optDouble("scale", 1.0),
                scaleX = optDouble("scaleX", 1.0), scaleY = optDouble("scaleY", 1.0)
            )
        }
    }
}

// MARK: - 记录与文件夹

data class Record(
    var id: String,
    var folderId: String? = null,
    var customName: String? = null,
    var createdAt: Long,
    var updatedAt: Long,
    var imagePath: String,          // 相对路径 records/{id}/wm.jpg
    var originalPath: String? = null,
    var width: Int = 0,
    var height: Int = 0,
    var values: MutableMap<String, String> = mutableMapOf(),
    var deletedAt: Long? = null,    // 非 null => 回收站
    var wmTemplateID: String? = null,
    var wmPlacement: OverlayPlacement? = null
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id); put("createdAt", createdAt); put("updatedAt", updatedAt)
        put("imagePath", imagePath)
        folderId?.let { put("folderId", it) }
        customName?.let { put("customName", it) }
        originalPath?.let { put("originalPath", it) }
        put("width", width); put("height", height)
        put("values", JSONObject(values as Map<*, *>))
        deletedAt?.let { put("deletedAt", it) }
        wmTemplateID?.let { put("wmTemplateID", it) }
        wmPlacement?.let { put("wmPlacement", it.toJson()) }
    }

    companion object {
        fun fromJson(o: JSONObject): Record = Record(
            id = o.optString("id"),
            folderId = if (o.has("folderId")) o.getString("folderId") else null,
            customName = if (o.has("customName")) o.getString("customName") else null,
            createdAt = o.optLong("createdAt", System.currentTimeMillis() / 1000),
            updatedAt = o.optLong("updatedAt", System.currentTimeMillis() / 1000),
            imagePath = o.optString("imagePath"),
            originalPath = if (o.has("originalPath")) o.getString("originalPath") else null,
            width = o.optInt("width", 0),
            height = o.optInt("height", 0),
            values = o.optJSONObject("values")?.let { v ->
                val m = mutableMapOf<String, String>()
                v.keys().forEach { k -> m[k] = v.optString(k) }
                m
            } ?: mutableMapOf(),
            deletedAt = if (o.has("deletedAt")) o.getLong("deletedAt") else null,
            wmTemplateID = if (o.has("wmTemplateID")) o.getString("wmTemplateID") else null,
            wmPlacement = OverlayPlacement.fromJson(o.optJSONObject("wmPlacement"))
        )
    }
}

data class Folder(
    var id: String,
    var name: String,
    var createdAt: Long,
    var updatedAt: Long
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id); put("name", name); put("createdAt", createdAt); put("updatedAt", updatedAt)
    }

    companion object {
        fun fromJson(o: JSONObject): Folder = Folder(
            id = o.optString("id"), name = o.optString("name"),
            createdAt = o.optLong("createdAt"), updatedAt = o.optLong("updatedAt")
        )
    }
}

// MARK: - 内置模板（与 iOS Templates.swift 一致）

object BuiltinTemplates {

    val handwrite = WatermarkTemplate(
        id = "handwrite", name = "手写·双语", isBuiltin = true,
        desc = "货号 + 西语描述 + 中文描述 + 单价 + 装箱数 + 件数 + 体积 + 日期",
        position = "bottom-center", widthRatio = 0.42,
        style = TemplateStyle(fontSize = 22.0, colorHex = "#ffffff",
            backgroundRGBA = "rgba(0,0,0,0.70)", padding = 14.0, borderRadius = 10.0, lineHeight = 1.35),
        fields = listOf(
            TemplateField("modelo", "货号 · Modelo / Código", FieldType.TEXT, "如：RL-034 · HB098"),
            TemplateField("desEs", "Descripción ES · 西语描述", FieldType.TEXTAREA,
                "如：6 estrellas grande + 6 estrellas chicas · 8 secuencias · sin música", multiline = true),
            TemplateField("desZh", "Descripción ZH · 中文描述", FieldType.TEXTAREA,
                "如：6 大星星 + 6 小星星挂灯 · 8 种闪烁模式 · 不带音乐", multiline = true),
            TemplateField("precio", "单价 · Precio unitario", FieldType.TEXT, "如：¥11 · $0.65"),
            TemplateField("pzs", "每箱件数 · Pzs / caja", FieldType.TEXT, "如：48 pzs / caja"),
            TemplateField("cajas", "件数 · Total cajas / pzs", FieldType.TEXT, "如：50 cajas · 1200 pzs"),
            TemplateField("volumen", "体积 · Volumen", FieldType.TEXT, "如：0.125 m³ / 2 cajas"),
            TemplateField("peso", "重量 · Peso", FieldType.TEXT, "如：2.5 kg"),
            TemplateField("nota", "备注 · Nota", FieldType.TEXTAREA,
                "如：con luz y música · movimiento · poner más opp en la caja", multiline = true),
            TemplateField("fecha", "日期 · Fecha", FieldType.DATETIME)
        )
    )

    val minimal = WatermarkTemplate(
        id = "minimal", name = "极简模板", isBuiltin = true,
        desc = "货号 + 单价 + 描述 + 装箱数 + 体积 + 件数",
        position = "bottom-center", widthRatio = 0.42,
        style = TemplateStyle(fontSize = 22.0, colorHex = "#ffffff",
            backgroundRGBA = "rgba(0,0,0,0.70)", padding = 14.0, borderRadius = 10.0, lineHeight = 1.35),
        fields = listOf(
            TemplateField("modelo", "货号 · Modelo", FieldType.TEXT, "如：RL-034"),
            TemplateField("precio", "单价 · Precio ￥", FieldType.TEXT, "如：¥11"),
            TemplateField("desEs", "描述 · Des.", FieldType.TEXTAREA, "如：6 estrellas grande", multiline = true),
            TemplateField("pzs", "装箱数 · Pzas/Caja", FieldType.TEXT, "如：48 pzs / caja"),
            TemplateField("volumen", "体积 · Cúbico", FieldType.TEXT, "如：0.125 m³"),
            TemplateField("cajas", "件数 · Cajas", FieldType.TEXT, "如：50 cajas")
        )
    )

    val handwriteSimple = WatermarkTemplate(
        id = "handwriteSimple", name = "手写·精简", isBuiltin = true,
        desc = "货号 + 西语描述 + 单价 + 装箱数 + 体积",
        position = "bottom-center", widthRatio = 0.42,
        style = TemplateStyle(fontSize = 24.0, colorHex = "#ffffff",
            backgroundRGBA = "rgba(0,0,0,0.70)", padding = 14.0, borderRadius = 10.0, lineHeight = 1.35),
        fields = listOf(
            TemplateField("modelo", "货号 · Modelo", FieldType.TEXT, "如：RL-034"),
            TemplateField("desEs", "Descripción ES", FieldType.TEXTAREA,
                "如：3ctn × 48 pcs × 29 rmb · con luz y música", multiline = true),
            TemplateField("precio", "单价 · Precio", FieldType.TEXT, "如：¥11"),
            TemplateField("pzs", "每箱 · Pzs / caja", FieldType.TEXT, "如：48 pzs / caja"),
            TemplateField("cajas", "件数 · Total", FieldType.TEXT, "如：10 cajas"),
            TemplateField("volumen", "体积 · Volumen", FieldType.TEXT, "如：0.125 m³")
        )
    )

    val all: List<WatermarkTemplate> = listOf(handwrite, minimal, handwriteSimple)

    /** 模板默认字段值（datetime/date/time 自动填入当前时间） */
    fun defaultValues(template: WatermarkTemplate): MutableMap<String, String> {
        val now = Date()
        val dt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.CHINA).format(now)
        val d = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(now)
        val t = SimpleDateFormat("HH:mm:ss", Locale.US).format(now)
        val values = mutableMapOf<String, String>()
        for (f in template.fields) {
            values[f.key] = when (f.type) {
                FieldType.DATETIME -> dt
                FieldType.DATE -> d
                FieldType.TIME -> t
                FieldType.SELECT -> f.options?.firstOrNull() ?: f.defaultValue ?: ""
                else -> f.defaultValue ?: ""
            }
        }
        return values
    }

    fun template(id: String?): WatermarkTemplate? {
        all.firstOrNull { it.id == id }?.let { return it }
        return StorageManager.customTemplates.firstOrNull { it.id == id }
    }
}

// MARK: - 导出排序（与 iOS ExportSortOrder 一致）

enum class ExportSortOrder(val displayName: String) {
    CREATED_AT_DESC("创建时间倒序（最新在前）"),
    CREATED_AT_ASC("创建时间正序（最早在前）"),
    UPDATED_AT_DESC("更新时间倒序（最近编辑在前）"),
    UPDATED_AT_ASC("更新时间正序（最久未编辑在前）");

    fun sort(records: List<Record>): List<Record> = when (this) {
        CREATED_AT_DESC -> records.sortedByDescending { it.createdAt }
        CREATED_AT_ASC -> records.sortedBy { it.createdAt }
        UPDATED_AT_DESC -> records.sortedByDescending { it.updatedAt }
        UPDATED_AT_ASC -> records.sortedBy { it.updatedAt }
    }
}

// MARK: - 图片压缩选项（与 iOS 一致）

enum class ExportImageCompression(val displayName: String) {
    ORIGINAL("原像素（不压缩）"),
    HALF("50% 压缩"),
    QUARTER("25% 压缩"),
    UNDER_1MB("压缩至 1MB 内");

    /** 按 maxDim 缓存的原图像素估算压缩后长边像素 */
    fun estimatePixels(maxDim: Int): Int = when (this) {
        ORIGINAL, UNDER_1MB -> maxDim
        HALF -> maxDim / 2
        QUARTER -> maxDim / 4
    }
}

// MARK: - 通用工具

fun formatDateTime(ts: Long): String =
    SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA).format(Date(ts * 1000))

fun formatBytes(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val kb = bytes / 1024.0
    if (kb < 1024) return String.format(Locale.US, "%.1f KB", kb)
    return String.format(Locale.US, "%.1f MB", kb / 1024.0)
}

fun genId(prefix: String): String = "$prefix-${System.currentTimeMillis()}-${(0..9999).random()}"
