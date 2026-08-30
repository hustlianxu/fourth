package com.watermark.camera.core

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max
import kotlin.math.roundToInt

// MARK: - 照片保存（渲染水印 → 落盘 → 建立记录）

object PhotoSaver {

    /** 把原图渲染水印后保存为新记录（对齐 iOS PhotoSaver.save） */
    suspend fun save(image: Bitmap,
                     template: WatermarkTemplate,
                     values: Map<String, String>,
                     placement: OverlayPlacement,
                     canvasW: Float, canvasH: Float,
                     folderId: String?): Record? = withContext(Dispatchers.IO) {
        val params = OverlayMapper.renderParams(template, values, placement,
            canvasW, canvasH, image.width.toFloat(), image.height.toFloat())
            ?: return@withContext null
        val wmImage = WatermarkRenderer.render(template, values, image,
            params.customX, params.customY, params.scale, params.scaleX, params.scaleY)
            ?: return@withContext null

        val id = genId("r")
        val dir = StorageManager.recordDir(id)
        dir.mkdirs()
        val origFile = File(dir, StorageManager.origFile)
        val wmFile = File(dir, StorageManager.wmFile)
        origFile.writeBytes(bitmapBytes(image, 90))
        wmFile.writeBytes(bitmapBytes(wmImage, 90))

        val now = System.currentTimeMillis() / 1000
        val rec = Record(
            id = id, folderId = folderId, customName = null,
            createdAt = now, updatedAt = now,
            imagePath = "records/$id/${StorageManager.wmFile}",
            originalPath = "records/$id/${StorageManager.origFile}",
            width = wmImage.width, height = wmImage.height,
            values = values.toMutableMap(),
            deletedAt = null,
            wmTemplateID = template.id,
            wmPlacement = placement
        )
        StorageManager.addRecord(rec)
        rec
    }

    /** 详情编辑后：按原位置/原模板重渲染并覆盖 wm.jpg（对齐 iOS rerenderValues） */
    suspend fun rerenderValues(record: Record,
                               template: WatermarkTemplate,
                               values: Map<String, String>): Boolean =
        withContext(Dispatchers.IO) {
            val origFile = record.originalPath?.let { StorageManager.fileFor(it) }
                ?: StorageManager.fileFor(record.imagePath)
                ?: return@withContext false
            val image = BitmapFactory.decodeFile(origFile.absolutePath) ?: return@withContext false

            // 用保存时记录的画布比例反推 canvasPoints，保证位置一致：
            // 保存时 customX/customY 是图片像素坐标；直接按模板位置换算
            val placement = record.wmPlacement ?: OverlayPlacement()
            val params = OverlayMapper.renderParams(template, values, placement,
                image.width * 1f, image.height * 1f, image.width.toFloat(), image.height.toFloat())
                ?: return@withContext false
            // renderParams 以画布=全图计算，等价于按记录位置重绘
            val wmImage = WatermarkRenderer.render(template, values, image,
                params.customX, params.customY, params.scale, params.scaleX, params.scaleY)
                ?: return@withContext false
            val wmFile = StorageManager.fileFor(record.imagePath) ?: return@withContext false
            wmFile.writeBytes(bitmapBytes(wmImage, 90))
            record.values = values.toMutableMap()
            record.width = wmImage.width
            record.height = wmImage.height
            record.updatedAt = System.currentTimeMillis() / 1000
            StorageManager.updateRecord(record)
            true
        }

    /** 编辑已有记录：重新渲染并覆盖（对齐 iOS PhotoSaver.update） */
    suspend fun update(recordID: String,
                       image: Bitmap,
                       template: WatermarkTemplate,
                       values: Map<String, String>,
                       placement: OverlayPlacement,
                       canvasW: Float, canvasH: Float): Boolean =
        withContext(Dispatchers.IO) {
            val rec = StorageManager.record(recordID) ?: return@withContext false
            val params = OverlayMapper.renderParams(template, values, placement,
                canvasW, canvasH, image.width.toFloat(), image.height.toFloat())
                ?: return@withContext false
            val wmImage = WatermarkRenderer.render(template, values, image,
                params.customX, params.customY, params.scale, params.scaleX, params.scaleY)
                ?: return@withContext false

            val dir = StorageManager.recordDir(recordID)
            val origFile = File(dir, StorageManager.origFile)
            val wmFile = File(dir, StorageManager.wmFile)
            if (!origFile.exists()) origFile.writeBytes(bitmapBytes(image, 90))
            wmFile.writeBytes(bitmapBytes(wmImage, 90))

            rec.values = values.toMutableMap()
            rec.wmTemplateID = template.id
            rec.wmPlacement = placement
            rec.width = wmImage.width
            rec.height = wmImage.height
            rec.updatedAt = System.currentTimeMillis() / 1000
            StorageManager.updateRecord(rec)
            true
        }

    private fun bitmapBytes(bmp: Bitmap, quality: Int): ByteArray {
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, quality, out)
        return out.toByteArray()
    }
}

// MARK: - 保存到系统相册

object AlbumSaver {

    /** 保存图片到相册 Pictures/WatermarkCamera（API 29+ 免权限） */
    fun saveToAlbum(context: Context, bitmap: Bitmap): Boolean {
        return try {
            val name = "wm_${SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())}.jpg"
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, name)
                put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/WatermarkCamera")
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
            }
            val uri = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                ?: return false
            context.contentResolver.openOutputStream(uri)?.use { os ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, 92, os)
            } ?: return false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.clear()
                values.put(MediaStore.Images.Media.IS_PENDING, 0)
                context.contentResolver.update(uri, values, null, null)
            }
            true
        } catch (_: Exception) {
            false
        }
    }
}

// MARK: - Excel 导出服务（压缩 + 列定义 + 生成 + 分享）

object ExportService {

    private const val IMG_COL_WIDTH = 220   // 图片列宽（px）

    /** 按压缩选项处理图片字节 */
    fun compressedImageBytes(file: File, compression: ExportImageCompression): ByteArray? {
        val bmp = StorageManager.decodeScaled(file, 8192) ?: return null
        var target = bmp
        when (compression) {
            ExportImageCompression.ORIGINAL -> {}
            ExportImageCompression.HALF -> {
                val w = max(1, bmp.width / 2); val h = max(1, bmp.height / 2)
                target = Bitmap.createScaledBitmap(bmp, w, h, true)
            }
            ExportImageCompression.QUARTER -> {
                val w = max(1, bmp.width / 4); val h = max(1, bmp.height / 4)
                target = Bitmap.createScaledBitmap(bmp, w, h, true)
            }
            ExportImageCompression.UNDER_1MB -> {
                // 逐步缩到 1MB 内
                var cur = bmp
                var bytes = bytes(cur, 85)
                var iter = 0
                while (bytes.size > 1_000_000 && iter < 6) {
                    val w = max(1, (cur.width * 0.8).roundToInt())
                    val h = max(1, (cur.height * 0.8).roundToInt())
                    cur = Bitmap.createScaledBitmap(cur, w, h, true)
                    bytes = bytes(cur, 85)
                    iter++
                }
                target = cur
                return bytes
            }
        }
        return bytes(target, 88)
    }

    private fun bytes(bmp: Bitmap, q: Int): ByteArray {
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, q, out)
        return out.toByteArray()
    }

    /**
     * 导出 Excel：图片 + 记录字段 + 时间。
     * @return 生成的文件
     */
    suspend fun exportExcel(records: List<Record>,
                            template: WatermarkTemplate,
                            compression: ExportImageCompression): File? =
        withContext(Dispatchers.IO) {
            if (records.isEmpty()) return@withContext null

            // 列：图片 + 名称 + 模板字段 + 拍摄时间
            val columns = mutableListOf(
                XlsxWriter.Column("imagePath", "图片", true),
                XlsxWriter.Column("customName", "名称", false)
            )
            template.fields.forEach { f ->
                columns.add(XlsxWriter.Column(f.key, f.label, false))
            }
            columns.add(XlsxWriter.Column("createdAt", "拍摄时间", false))

            val flat = mutableListOf<Map<String, String>>()
            val rowHeights = mutableListOf<Int>()
            val imgDisplayHeights = mutableListOf<Int>()
            val imageBytesCache = mutableMapOf<String, ByteArray?>()

            records.forEach { rec ->
                val row = mutableMapOf(
                    "imagePath" to rec.imagePath,
                    "customName" to (rec.customName ?: rec.values["modelo"] ?: ""),
                    "createdAt" to formatDateTime(rec.createdAt)
                )
                template.fields.forEach { f -> row[f.key] = rec.values[f.key] ?: "" }
                flat.add(row)

                // 图片字节（压缩）
                val imgFile = StorageManager.fileFor(rec.imagePath)
                var imgW = 1; var imgH = 1
                var data: ByteArray? = null
                if (imgFile != null) {
                    if (!imageBytesCache.containsKey(rec.imagePath)) {
                        imageBytesCache[rec.imagePath] = compressedImageBytes(imgFile, compression)
                    }
                    data = imageBytesCache[rec.imagePath]
                }
                if (data != null) {
                    val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(data, 0, data.size, opts)
                    imgW = max(opts.outWidth, 1); imgH = max(opts.outHeight, 1)
                }
                val dispH = (IMG_COL_WIDTH.toFloat() * imgH / imgW).roundToInt()
                imgDisplayHeights.add(dispH)
                rowHeights.add(max(dispH, 60))
            }

            val stamp = SimpleDateFormat("yyyyMMdd_HHmm", Locale.US).format(Date())
            val out = File(StorageManager.exportsDir, "export_$stamp.xlsx")
            try {
                XlsxWriter.write(
                    records = flat,
                    columns = columns,
                    outFile = out,
                    imageData = { path ->
                        imageBytesCache[path] ?: run {
                            StorageManager.fileFor(path)?.let { compressedImageBytes(it, compression) }
                                .also { imageBytesCache[path] = it }
                        }
                    },
                    rowHeights = rowHeights,
                    imgDisplayHeights = imgDisplayHeights,
                    columnWidths = columns.associate { c ->
                        if (c.isImage) "imagePath" to IMG_COL_WIDTH
                        else c.key to if (c.key == "createdAt") 130 else 160
                    },
                    imgColWidth = IMG_COL_WIDTH
                )
                out
            } catch (e: Exception) {
                e.printStackTrace()
                null
            }
        }

    /** 分享 xlsx 文件（微信/QQ/邮件等） */
    fun shareFile(context: Context, file: File) {
        val uri: Uri = FileProvider.getUriForFile(
            context, "${context.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, "分享导出文件"))
    }
}
