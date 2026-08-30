package com.watermark.camera.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import com.watermark.camera.core.BuiltinTemplates
import com.watermark.camera.core.OverlayPlacement
import com.watermark.camera.core.PhotoSaver
import com.watermark.camera.core.StorageManager
import com.watermark.camera.core.formatDateTime
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

// MARK: - 记录详情（默认只读 + 编辑实时预览 + 重新编辑水印）

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecordDetailScreen(recordId: String,
                       onBack: () -> Unit,
                       onReeditWatermark: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val storage = StorageManager
    val record = storage.record(recordId) ?: run { onBack(); return }
    val template = remember(record.wmTemplateID) {
        record.wmTemplateID?.let { BuiltinTemplates.template(it) } ?: storage.activeTemplate
    }

    var editing by remember { mutableStateOf(false) }
    var values by remember(record.id) { mutableStateOf(record.values.toMutableMap()) }
    var saving by remember { mutableStateOf(false) }
    var toast by remember { mutableStateOf<String?>(null) }

    // 编辑态加载干净原图；只读态显示水印成品图
    val displayPath = if (editing) record.originalPath ?: record.imagePath else record.imagePath
    val bitmap by produceState<android.graphics.Bitmap?>(null, displayPath) {
        value = displayPath?.let { storage.imageAtPath(it) }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(record.customName ?: "记录详情") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回")
                    }
                },
                actions = {
                    TextButton(onClick = {
                        if (editing) {
                            // 保存：按原位置/原模板重渲染
                            if (!saving) {
                                saving = true
                                scope.launch {
                                    val ok = PhotoSaver.rerenderValues(record, template, values)
                                    saving = false
                                    if (ok) {
                                        editing = false
                                        toast = "已保存并重渲染水印"
                                    } else toast = "保存失败"
                                }
                            }
                        } else {
                            editing = true
                        }
                    }) { Text(if (editing) "保存" else "编辑") }
                    if (editing) {
                        TextButton(onClick = {
                            values = record.values.toMutableMap()
                            editing = false
                        }) { Text("取消") }
                    }
                }
            )
        }
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding)
                .verticalScroll(rememberScrollState())
        ) {
            // 大图区（编辑态实时预览水印）
            Box(
                Modifier.fillMaxWidth().height(360.dp)
                    .background(Color(0xFF101014)),
                contentAlignment = Alignment.Center
            ) {
                if (bitmap == null) {
                    CircularProgressIndicator()
                } else {
                    val bmp = bitmap!!
                    BoxWithConstraints(Modifier.fillMaxSize()) {
                        val boxW = constraints.maxWidth.toFloat()
                        val boxH = constraints.maxHeight.toFloat()
                        val scale = minOf(boxW / bmp.width, boxH / bmp.height)
                        val dispW = bmp.width * scale
                        val dispH = bmp.height * scale

                        Box(
                            Modifier.align(Alignment.Center).size(dispW.dp, dispH.dp)
                        ) {
                            Image(
                                bitmap = bmp.asImageBitmap(),
                                contentDescription = null,
                                contentScale = ContentScale.Fit,
                                modifier = Modifier.fillMaxSize()
                            )
                            if (editing) {
                                // 原图 + 实时水印浮层（只读交互）
                                WatermarkOverlay(
                                    template = template,
                                    values = values,
                                    containerWidth = dispW,
                                    containerHeight = dispH,
                                    placement = record.wmPlacement ?: OverlayPlacement(),
                                    interactive = false
                                )
                            }
                        }
                    }
                }
            }

            // 信息与字段区
            Column(Modifier.fillMaxWidth().padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            "拍摄于 ${formatDateTime(record.createdAt)}",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            "更新于 ${formatDateTime(record.updatedAt)}",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    OutlinedButton(onClick = {
                        PendingCapture.apply {
                            filePath = record.originalPath?.let { storage.fileFor(it)?.absolutePath }
                                ?: storage.fileFor(record.imagePath)?.absolutePath
                            templateId = record.wmTemplateID
                            this.values = record.values
                            this.placement = record.wmPlacement ?: OverlayPlacement()
                            this.recordId = record.id
                        }
                        onReeditWatermark(record.id)
                    }) {
                        Icon(Icons.Filled.Edit, null, Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("重新编辑水印")
                    }
                }

                Spacer(Modifier.height(12.dp))
                Text("字段内容", style = MaterialTheme.typography.titleSmall)

                if (!editing) {
                    // 只读展示
                    template.fields.forEach { f ->
                        val v = values[f.key] ?: ""
                        if (v.isNotBlank()) {
                            FieldRow(f.label, v)
                        }
                    }
                } else {
                    // 编辑态：实时预览（每个字段改动立即反映到上方大图）
                    template.fields.forEach { f ->
                        OutlinedTextField(
                            value = values[f.key] ?: "",
                            onValueChange = { values[f.key] = it },
                            label = { Text(f.label) },
                            placeholder = f.placeholder?.let { p -> { Text(p) } },
                            minLines = if (f.multiline) 2 else 1,
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)
                        )
                    }
                }
            }
        }
    }

    toast?.let { msg ->
        LaunchedEffect(msg) {
            kotlinx.coroutines.delay(1800)
            toast = null
        }
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Surface(color = Color(0xCC000000), shape = RoundedCornerShape(8.dp)) {
                Text(msg, color = Color.White, modifier = Modifier.padding(14.dp))
            }
        }
    }
}

@Composable
private fun FieldRow(label: String, value: String) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
        shape = MaterialTheme.shapes.small,
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)
    ) {
        Column(Modifier.padding(10.dp)) {
            Text(label, style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
