package com.watermark.camera.core

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.max

// MARK: - 本地存储（JSON 索引 + 图片文件），对齐 iOS StorageManager

object StorageManager {

    const val origFile = "orig.jpg"
    const val wmFile = "wm.jpg"

    lateinit var appContext: Context
        private set

    private lateinit var rootDir: File     // filesDir/WatermarkCamera
    private lateinit var recordsDir: File
    val exportsDir: File get() = File(appContext.getExternalFilesDir(null), "exports")

    // 可观察状态（Compose 直接读取即可刷新 UI）
    var records by mutableStateOf(listOf<Record>())
        private set
    var trash by mutableStateOf(listOf<Record>())
        private set
    var folders by mutableStateOf(listOf<Folder>())
        private set
    var customTemplates by mutableStateOf(listOf<WatermarkTemplate>())
        private set

    fun init(context: Context) {
        if (::appContext.isInitialized) return
        appContext = context.applicationContext
        rootDir = File(context.filesDir, "WatermarkCamera")
        recordsDir = File(rootDir, "records")
        recordsDir.mkdirs()
        exportsDir.mkdirs()

        val prefs = context.getSharedPreferences("app", Context.MODE_PRIVATE)
        activeTemplateID = prefs.getString("activeTemplateID", null) ?: "handwrite"
        load()
        purgeExpiredTrash()
    }

    // MARK: - 当前拍摄模板

    var activeTemplateID: String = "handwrite"
        set(value) {
            field = value
            appContext.getSharedPreferences("app", Context.MODE_PRIVATE)
                .edit().putString("activeTemplateID", value).apply()
        }

    val activeTemplate: WatermarkTemplate
        get() = BuiltinTemplates.template(activeTemplateID) ?: BuiltinTemplates.all.first()

    // MARK: - 索引读写

    private fun indexFile(): File = File(rootDir, "index.json")
    private fun templatesFile(): File = File(rootDir, "templates.json")

    private fun load() {
        try {
            val idx = indexFile()
            if (idx.exists()) {
                val o = JSONObject(idx.readText())
                records = optList(o, "records") { Record.fromJson(it) }
                trash = optList(o, "trash") { Record.fromJson(it) }
                folders = optList(o, "folders") { Folder.fromJson(it) }
            }
        } catch (_: Exception) { }
        try {
            val tf = templatesFile()
            if (tf.exists()) {
                val arr = JSONArray(tf.readText())
                customTemplates = List(arr.length()) { WatermarkTemplate.fromJson(arr.getJSONObject(it)) }
            }
        } catch (_: Exception) { }
    }

    private inline fun <T> optList(o: JSONObject, key: String, map: (JSONObject) -> T): List<T> {
        val a = o.optJSONArray(key) ?: return emptyList()
        return List(a.length()) { map(a.getJSONObject(it)) }
    }

    private fun save() {
        try {
            val o = JSONObject().apply {
                put("records", JSONArray(records.map { it.toJson() }))
                put("trash", JSONArray(trash.map { it.toJson() }))
                put("folders", JSONArray(folders.map { it.toJson() }))
            }
            indexFile().writeText(o.toString())
        } catch (_: Exception) { }
    }

    private fun saveTemplates() {
        try {
            templatesFile().writeText(JSONArray(customTemplates.map { it.toJson() }).toString())
        } catch (_: Exception) { }
    }

    // MARK: - 记录

    fun recordDir(id: String): File = File(recordsDir, id)

    /** 相对路径（records/{id}/wm.jpg）转绝对文件 */
    fun fileFor(relativePath: String?): File? {
        if (relativePath.isNullOrBlank()) return null
        val f = File(rootDir, relativePath)
        return if (f.exists()) f else null
    }

    /** 水印成品图 */
    fun image(record: Record): Bitmap? = fileFor(record.imagePath)?.let { decodeScaled(it, 2048) }

    /** 按相对路径读图 */
    fun imageAtPath(relativePath: String?): Bitmap? =
        fileFor(relativePath)?.let { decodeScaled(it, 2048) }

    /** 干净原图 */
    fun originalImage(record: Record): Bitmap? =
        (record.originalPath?.let { fileFor(it) } ?: fileFor(record.imagePath))?.let { decodeScaled(it, 2048) }

    fun decodeScaled(f: File, maxDim: Int): Bitmap? {
        if (!f.exists()) return null
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.absolutePath, opts)
        var sample = 1
        while (max(opts.outWidth, opts.outHeight) / sample > maxDim * 2) sample *= 2
        val real = BitmapFactory.Options().apply { inSampleSize = sample }
        val bmp = BitmapFactory.decodeFile(f.absolutePath, real) ?: return null
        return applyExifRotation(f, bmp)
    }

    /** 按 EXIF 方向摆正（相册选图/拍摄照片常带旋转标记） */
    private fun applyExifRotation(f: File, bmp: Bitmap): Bitmap {
        return try {
            val exif = android.media.ExifInterface(f.absolutePath)
            val rotation = when (exif.getAttributeInt(
                android.media.ExifInterface.TAG_ORIENTATION,
                android.media.ExifInterface.ORIENTATION_NORMAL)) {
                android.media.ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                android.media.ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                android.media.ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
            if (rotation == 0f) bmp
            else {
                val m = android.graphics.Matrix().apply { postRotate(rotation) }
                Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
            }
        } catch (_: Exception) {
            bmp
        }
    }

    fun addRecord(rec: Record) {
        records = (listOf(rec) + records)
        save()
    }

    fun updateRecord(rec: Record) {
        val i = records.indexOfFirst { it.id == rec.id }
        if (i >= 0) {
            val list = records.toMutableList()
            list[i] = rec
            records = list
            save()
        }
    }

    fun record(id: String): Record? = records.firstOrNull { it.id == id }

    fun recordsInFolder(folderId: String?): List<Record> =
        records.filter { it.folderId == folderId }.sortedByDescending { it.createdAt }

    fun moveToTrash(id: String) {
        val i = records.indexOfFirst { it.id == id }
        if (i < 0) return
        val list = records.toMutableList()
        val r = list.removeAt(i)
        r.deletedAt = System.currentTimeMillis() / 1000
        r.updatedAt = r.deletedAt ?: 0
        trash = (listOf(r) + trash)
        records = list
        save()
    }

    fun batchMoveToTrash(ids: Set<String>) {
        if (ids.isEmpty()) return
        val now = System.currentTimeMillis() / 1000
        val trashed = mutableListOf<Record>()
        val remain = mutableListOf<Record>()
        records.forEach { r ->
            if (ids.contains(r.id)) {
                r.deletedAt = now; r.updatedAt = now
                trashed.add(r)
            } else remain.add(r)
        }
        if (trashed.isEmpty()) return
        trash = (trashed + trash)
        records = remain
        save()
    }

    fun restoreFromTrash(id: String) {
        val i = trash.indexOfFirst { it.id == id }
        if (i < 0) return
        val list = trash.toMutableList()
        val r = list.removeAt(i)
        r.deletedAt = null
        trash = list
        records = (listOf(r) + records)
        save()
    }

    fun deleteForever(id: String) {
        val i = trash.indexOfFirst { it.id == id }
        if (i < 0) return
        val list = trash.toMutableList()
        val r = list.removeAt(i)
        trash = list
        save()
        recordDir(r.id).deleteRecursively()
    }

    fun emptyTrash() {
        val ids = trash.map { it.id }
        trash = emptyList()
        save()
        ids.forEach { recordDir(it).deleteRecursively() }
    }

    /** 回收站 30 天过期自动清理 */
    private fun purgeExpiredTrash() {
        val expire = 30L * 24 * 3600
        val now = System.currentTimeMillis() / 1000
        val expired = trash.filter { (it.deletedAt ?: 0) + expire < now }
        if (expired.isEmpty()) return
        trash = trash.filter { it !in expired }
        save()
        expired.forEach { recordDir(it.id).deleteRecursively() }
    }

    // MARK: - 文件夹

    fun folderNameExists(name: String): Boolean =
        folders.any { it.name.equals(name.trim(), ignoreCase = true) }

    fun addFolder(name: String): Folder {
        val now = System.currentTimeMillis() / 1000
        val f = Folder(genId("f"), name.trim(), now, now)
        folders = (folders + f).sortedBy { it.name }
        save()
        return f
    }

    fun removeFolder(id: String) {
        val i = folders.indexOfFirst { it.id == id }
        if (i < 0) return
        val list = folders.toMutableList()
        list.removeAt(i)
        folders = list
        // 组内照片移至未分类
        records = records.map { r -> if (r.folderId == id) r.copy(folderId = null) else r }
        save()
    }

    // MARK: - 自定义模板

    fun saveTemplate(t: WatermarkTemplate) {
        val i = customTemplates.indexOfFirst { it.id == t.id }
        val list = customTemplates.toMutableList()
        if (i >= 0) list[i] = t else list.add(t)
        customTemplates = list
        saveTemplates()
    }

    fun deleteTemplate(id: String) {
        customTemplates = customTemplates.filter { it.id != id }
        if (activeTemplateID == id) activeTemplateID = "handwrite"
        saveTemplates()
    }

    // MARK: - 空间占用

    fun totalStorageBytes(): Long {
        var total = 0L
        recordsDir.walkTopDown().filter { it.isFile }.forEach { total += it.length() }
        return total
    }

    fun exportFiles(): List<File> =
        exportsDir.listFiles()?.filter { it.extension == "xlsx" }?.sortedByDescending { it.lastModified() } ?: emptyList()
}
