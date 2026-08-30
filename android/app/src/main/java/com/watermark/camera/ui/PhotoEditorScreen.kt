package com.watermark.camera.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.watermark.camera.core.BuiltinTemplates
import com.watermark.camera.core.OverlayMapper
import com.watermark.camera.core.OverlayPlacement
import com.watermark.camera.core.PhotoSaver
import com.watermark.camera.core.StorageManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt

// MARK: - 照片水印编辑器（完整显示图片 + 手势编辑水印 + 浮动内容面板）

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PhotoEditorScreen(onDone: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    // 入参（拍摄新图 / 编辑已有记录）
    val record = PendingCapture.recordId?.let { StorageManager.record(it) }
    val isNew = PendingCapture.recordId == null || record == null
    val filePath = PendingCapture.filePath

    var template by remember {
        mutableStateOf(
            (PendingCapture.recordId?.let { record?.wmTemplateID }
                ?: PendingCapture.templateId)
                ?.let { BuiltinTemplates.template(it) } ?: StorageManager.activeTemplate
        )
    }
    var values by remember {
        mutableStateOf(
            (record?.values?.toMutableMap() ?: PendingCapture.values.toMutableMap())
        )
    }
    var placement by remember {
        mutableStateOf(record?.wmPlacement ?: PendingCapture.placement ?: OverlayPlacement())
    }
    var showContentPanel by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var toast by remember { mutableStateOf<String?>(null) }
    var fitRect by remember { mutableStateOf(androidx.compose.ui.geometry.Rect(0f, 0f, 0f, 0f)) }

    // 预解码原图（后台，避免白屏）
    val bitmap by produceState<Bitmap?>(null, filePath) {
        value = withContext(Dispatchers.IO) {
            filePath?.let { BitmapFactory.decodeFile(it) }
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (bitmap == null) {
            Column(
                Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                CircularProgressIndicator(color = Color.White)
                Spacer(Modifier.height(12.dp))
                Text("加载中…", color = Color.White.copy(alpha = 0.7f))
            }
        } else {
            val bmp = bitmap!!
            BoxWithConstraints(Modifier.fillMaxSize()) {
                val boxW = constraints.maxWidth.toFloat()
                val boxH = constraints.maxHeight.toFloat()
                // 图片完整显示（Fit）：计算图像显示矩形
                val scale = minOf(boxW / bmp.width, boxH / bmp.height)
                val dispW = bmp.width * scale
                val dispH = bmp.height * scale
                val imgLeft = (boxW - dispW) / 2
                val imgTop = (boxH - dispH) / 2
                fitRect = androidx.compose.ui.geometry.Rect(
                    imgLeft, imgTop, imgLeft + dispW, imgTop + dispH)

                Image(
                    bitmap = bmp.asImageBitmap(),
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize()
                )

                // 水印浮层（以图像显示区为画布，位置与保存映射一致）
                Box(
                    Modifier.padding(0.dp)
                        .absoluteOffsetPx(imgLeft.roundToInt(), imgTop.roundToInt())
                ) {
                    Box(Modifier.size(dispW.dp, dispH.dp)) {
                        WatermarkOverlay(
                            template = template,
                            values = values,
                            containerWidth = dispW,
                            containerHeight = dispH,
                            placement = placement,
                            interactive = true,
                            onTap = { showContentPanel = !showContentPanel },
                            onPlacementChange = { placement = it }
                        )
                    }
                }
            }

            // 顶部：取消/保存
            Row(
                Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onDone) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "取消", tint = Color.White)
                }
                Row {
                    // 归位按钮：恢复模板预设位置
                    OutlinedButton(onClick = {
                        if (fitRect.width > 0 && fitRect.height > 0) {
                            placement = OverlayMapper.defaultPlacement(
                                template, fitRect.width, fitRect.height)
                        }
                    }) { Text("归位", color = Color.White) }
                    Spacer(Modifier.width(8.dp))
                    Button(
                        onClick = {
                            if (saving) return@Button
                            saving = true
                            val b = bmp
                            scope.launch {
                                val ok = if (isNew) {
                                    PhotoSaver.save(
                                        image = b, template = template, values = values,
                                        placement = placement,
                                        canvasW = fitRect.width, canvasH = fitRect.height,
                                        folderId = null
                                    ) != null
                                } else {
                                    PhotoSaver.update(
                                        recordID = record?.id ?: "", image = b,
                                        template = template, values = values,
                                        placement = placement,
                                        canvasW = fitRect.width, canvasH = fitRect.height
                                    )
                                }
                                saving = false
                                if (ok) {
                                    // 清理临时文件
                                    filePath?.let {
                                        if (isNew) java.io.File(it).delete()
                                    }
                                    onDone()
                                } else {
                                    toast = "保存失败，请重试"
                                }
                            }
                        },
                        enabled = !saving
                    ) { Text(if (saving) "保存中…" else "保存") }
                }
            }

            // 底部提示
            Text(
                "点按水印可编辑内容 · 拖动移动 · 双指等比缩放 · 拖动边缘单向缩放",
                color = Color.White.copy(alpha = 0.6f),
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.align(Alignment.BottomCenter)
                    .navigationBarsPadding().padding(bottom = 8.dp)
            )

            // 浮动内容编辑面板
            if (showContentPanel) {
                Surface(
                    color = Color(0xF2FFFFFF),
                    shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
                    modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                ) {
                    Column(
                        Modifier.fillMaxWidth().navigationBarsPadding()
                            .height(320.dp).verticalScroll(rememberScrollState())
                            .padding(14.dp)
                    ) {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("编辑水印内容", style = MaterialTheme.typography.titleMedium)
                            TextButton(onClick = { showContentPanel = false }) { Text("收起") }
                        }
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

        // Toast
        toast?.let { msg ->
            LaunchedEffect(msg) {
                kotlinx.coroutines.delay(2000)
                toast = null
            }
            Surface(
                color = Color(0xCC000000),
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.align(Alignment.Center)
            ) {
                Text(msg, color = Color.White, modifier = Modifier.padding(14.dp))
            }
        }
    }
}

private fun Modifier.absoluteOffsetPx(x: Int, y: Int): Modifier =
    this.then(layout { measurable, constraints ->
        val placeable = measurable.measure(constraints)
        layout(placeable.width, placeable.height) {
            placeable.placeRelative(x, y)
        }
    })
