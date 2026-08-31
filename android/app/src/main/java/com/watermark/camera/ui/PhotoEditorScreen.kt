package com.watermark.camera.ui

import android.graphics.Bitmap
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Create
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
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
import androidx.compose.ui.layout.layout
import androidx.compose.ui.text.style.TextAlign
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
//
// 入口：相册选图（新记录）/ 记录「重新编辑水印」（已有记录）
// 布局对齐 iOS PhotoEditorView：
//   - 顶部：取消 / 保存
//   - 中部：图片完整显示（aspect-fit，不被面板遮挡）+ 水印浮层
//   - 内容面板：贴在图片下方（不覆盖图片），输入实时重绘
//   - 底部工具栏：模板 / 归位 / 内容

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PhotoEditorScreen(onDone: () -> Unit) {
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
    var templateMenuOpen by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var toast by remember { mutableStateOf<String?>(null) }
    var placementInitialized by remember { mutableStateOf(record?.wmPlacement != null) }
    var canvasW by remember { mutableStateOf(0f) }
    var canvasH by remember { mutableStateOf(0f) }

    // 预解码原图（后台、限制长边避免大图 OOM；对齐 iOS 上限 4096，
    // 保证保存成品与导出不降质；decodeScaled 自带 OOM 自动降档重试）
    var loadFailed by remember { mutableStateOf(false) }
    val bitmap by produceState<Bitmap?>(null, filePath) {
        val bmp = withContext(Dispatchers.IO) {
            filePath?.let { StorageManager.decodeScaled(java.io.File(it), 4096) }
        }
        if (bmp == null && filePath != null) loadFailed = true
        value = bmp
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Column(Modifier.fillMaxSize()) {
        // ===== 顶部：取消 / 保存 =====
        Row(
            Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onDone) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "取消", tint = Color.White)
            }
            Text(
                if (isNew) "编辑水印" else "重新编辑",
                color = Color.White,
                style = MaterialTheme.typography.titleMedium
            )
            Button(
                onClick = {
                    if (saving) return@Button
                    if (canvasW <= 0 || canvasH <= 0) {
                        toast = "画布尚未就绪，请稍候重试"; return@Button
                    }
                    saving = true
                    val b = bitmap
                    if (b == null) { saving = false; toast = "图片尚未加载完成"; return@Button }
                    scope.launch {
                        val ok = withContext(Dispatchers.IO) {
                            runCatching {
                                if (isNew) {
                                    PhotoSaver.save(
                                        image = b, template = template, values = values,
                                        placement = placement,
                                        canvasW = canvasW, canvasH = canvasH,
                                        folderId = null
                                    ) != null
                                } else {
                                    PhotoSaver.update(
                                        recordID = record?.id ?: "", image = b,
                                        template = template, values = values,
                                        placement = placement,
                                        canvasW = canvasW, canvasH = canvasH
                                    )
                                }
                            }.getOrDefault(false)
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

        // ===== 图片区：完整显示（aspect-fit）+ 水印浮层 =====
        Box(Modifier.fillMaxWidth().weight(1f)) {
            if (bitmap == null) {
                Column(
                    Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    if (loadFailed) {
                        Text("图片加载失败", color = Color.White)
                        Spacer(Modifier.height(16.dp))
                        OutlinedButton(onClick = onDone) { Text("返回", color = Color.White) }
                    } else {
                        CircularProgressIndicator(color = Color.White)
                        Spacer(Modifier.height(12.dp))
                        Text("加载中…", color = Color.White.copy(alpha = 0.7f))
                    }
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
                    val imgLeft = ((boxW - dispW) / 2).roundToInt()
                    val imgTop = ((boxH - dispH) / 2).roundToInt()

                    // 保存用的画布尺寸（图像显示区）——SideEffect 中写入避免反向写入
                    SideEffect {
                        if (canvasW != dispW || canvasH != dispH) {
                            canvasW = dispW; canvasH = dispH
                        }
                    }

                    // 首次就绪时按模板预设位置初始化
                    LaunchedEffect(template.id, dispW, dispH) {
                        if (!placementInitialized && dispW > 0 && dispH > 0) {
                            placement = OverlayMapper.defaultPlacement(template, dispW, dispH)
                            placementInitialized = true
                        }
                    }

                    androidx.compose.foundation.Image(
                        bitmap = bmp.asImageBitmap(),
                        contentDescription = null,
                        contentScale = androidx.compose.ui.layout.ContentScale.Fit,
                        modifier = Modifier.fillMaxSize()
                    )

                    // 水印浮层（以图像显示区为画布，位置与保存映射一致）
                    Box(Modifier.absoluteOffsetPx(imgLeft, imgTop)) {
                        WatermarkOverlay(
                            template = template,
                            values = values,
                            containerWidth = dispW,
                            containerHeight = dispH,
                            placement = placement,
                            interactive = true,
                            onTap = { showContentPanel = true },
                            onPlacementChange = { placement = it }
                        )
                    }
                }
            }

            // 顶部操作提示（对齐 iOS 顶部胶囊提示）
            Text(
                "单指拖动水印移动 · 双指等比缩放 · 拖边缘手柄调宽高 · 点按水印改内容",
                color = Color.White,
                style = MaterialTheme.typography.labelSmall,
                textAlign = TextAlign.Center,
                modifier = Modifier.align(Alignment.TopCenter)
                    .statusBarsPadding().padding(top = 4.dp)
                    .clip(CircleShape)
                    .background(Color(0x73000000))
                    .padding(horizontal = 12.dp, vertical = 6.dp)
            )
        }

        // ===== 浮动内容编辑面板：贴在图片下方（不遮挡图片），输入实时重绘 =====
        if (showContentPanel) {
            Surface(
                color = Color(0xF7FFFFFF),
                shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    Modifier.fillMaxWidth()
                        .height(220.dp).verticalScroll(rememberScrollState())
                        .padding(horizontal = 14.dp, vertical = 8.dp)
                ) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("水印内容", style = MaterialTheme.typography.titleSmall)
                        TextButton(onClick = { showContentPanel = false }) { Text("收起") }
                    }
                    template.fields.forEach { f ->
                        OutlinedTextField(
                            value = values[f.key] ?: "",
                            onValueChange = { text ->
                                values = values.toMutableMap().apply { put(f.key, text) }
                            },
                            label = { Text(f.label) },
                            placeholder = f.placeholder?.let { p -> { Text(p) } },
                            minLines = if (f.multiline) 2 else 1,
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)
                        )
                    }
                }
            }
        }

        // ===== 底部工具栏：模板 / 归位 / 内容（对齐 iOS） =====
        Row(
            Modifier.fillMaxWidth().background(Color(0xF2FFFFFF))
                .navigationBarsPadding().padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 模板切换（切换后重置字段默认值与预设位置，对齐 iOS switchTemplate）
            Box {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    OutlinedButton(onClick = { templateMenuOpen = true }) {
                        Text(template.name, style = MaterialTheme.typography.labelMedium)
                        Icon(Icons.Filled.KeyboardArrowDown, null,
                            Modifier.size(16.dp))
                    }
                    Text("模板", style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                DropdownMenu(expanded = templateMenuOpen,
                    onDismissRequest = { templateMenuOpen = false }) {
                    (BuiltinTemplates.all + StorageManager.customTemplates).forEach { t ->
                        DropdownMenuItem(
                            text = { Text(t.name) },
                            trailingIcon = {
                                if (t.id == template.id) {
                                    Icon(Icons.Filled.Check, null,
                                        tint = MaterialTheme.colorScheme.primary)
                                }
                            },
                            onClick = {
                                template = t
                                templateMenuOpen = false
                                values = BuiltinTemplates.defaultValues(t)
                                if (canvasW > 0 && canvasH > 0) {
                                    placement = OverlayMapper.defaultPlacement(t, canvasW, canvasH)
                                } else {
                                    placementInitialized = false
                                }
                                // 对齐 iOS：切换模板持久化为当前拍摄模板
                                StorageManager.activeTemplateID = t.id
                            }
                        )
                    }
                }
            }

            // 归位：恢复模板预设位置
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                IconButton(onClick = {
                    if (canvasW > 0 && canvasH > 0) {
                        placement = OverlayMapper.defaultPlacement(template, canvasW, canvasH)
                    }
                }) {
                    Icon(Icons.Filled.Refresh, "归位")
                }
                Text("归位", style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            // 内容：打开/收起水印内容面板
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                IconButton(onClick = { showContentPanel = !showContentPanel }) {
                    Icon(Icons.Filled.Create, if (showContentPanel) "收起内容" else "编辑内容")
                }
                Text("内容", style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        }

        // Toast（居中覆盖提示）
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
