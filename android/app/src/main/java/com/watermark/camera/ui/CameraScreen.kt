package com.watermark.camera.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FlashOff
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.FlipCameraAndroid
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.watermark.camera.core.BuiltinTemplates
import com.watermark.camera.core.OverlayMapper
import com.watermark.camera.core.OverlayPlacement
import com.watermark.camera.core.PhotoSaver
import com.watermark.camera.core.StorageManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

// MARK: - 相机拍摄页（实时水印浮层 + 字段面板 + 拍摄/相册选图）
//
// 行为对齐 iOS CameraCaptureView：
//   - 顶部：关闭 / 闪光灯（拍照瞬间生效）/ 前后摄像头切换
//   - 底部：相册选图（进编辑器）/ 快门 / 字段面板开关
//   - 拍照后直接渲染水印保存为记录并关闭相机页（不进编辑器）
//   - 相册选图进入编辑器编辑后保存

private suspend fun awaitCameraProvider(context: android.content.Context): ProcessCameraProvider =
    kotlinx.coroutines.suspendCancellableCoroutine { cont ->
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            try { cont.resume(future.get()) }
            catch (e: Exception) { cont.resumeWithException(e) }
        }, ContextCompat.getMainExecutor(context))
    }

@Composable
fun CameraScreen(onClose: () -> Unit, onPicked: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()

    var hasPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED
        )
    }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { hasPermission = it }

    // 模板与字段状态
    var template by remember { mutableStateOf(StorageManager.activeTemplate) }
    var values by remember(template.id) {
        mutableStateOf(BuiltinTemplates.defaultValues(template))
    }
    var placement by remember { mutableStateOf(OverlayPlacement()) }
    var placementInitialized by remember { mutableStateOf(false) }
    var showFields by rememberSaveable { mutableStateOf(false) }
    var templateMenuOpen by remember { mutableStateOf(false) }
    var flashOn by rememberSaveable { mutableStateOf(false) }
    var frontCamera by rememberSaveable { mutableStateOf(false) }
    var flashHint by remember { mutableStateOf<String?>(null) }
    var capturing by remember { mutableStateOf(false) }
    var toast by remember { mutableStateOf<String?>(null) }

    // ImageCapture 实例（限制输出分辨率，避免华为等大底传感器输出 40MP+ 导致 OOM）
    // 注：setTargetResolution 已废弃且在部分华为机型上被忽略（按全分辨率出图），
    // 改用 ResolutionSelector + ResolutionStrategy，保证出图长边约 2048。
    val imageCapture = remember {
        ImageCapture.Builder()
            .setResolutionSelector(
                androidx.camera.core.resolutionselector.ResolutionSelector.Builder()
                    .setResolutionStrategy(
                        androidx.camera.core.resolutionselector.ResolutionStrategy(
                            android.util.Size(2048, 2048),
                            androidx.camera.core.resolutionselector.ResolutionStrategy
                                .FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
                        )
                    )
                    .build()
            )
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
            .build()
    }

    // 相机绑定（前后切换 / 闪光灯变化时重新绑定）
    val previewView = remember { PreviewView(context) }
    LaunchedEffect(hasPermission, frontCamera) {
        if (!hasPermission) return@LaunchedEffect
        try {
            val provider = awaitCameraProvider(context)
            val selector = if (frontCamera) CameraSelector.DEFAULT_FRONT_CAMERA
            else CameraSelector.DEFAULT_BACK_CAMERA
            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }
            provider.unbindAll()
            provider.bindToLifecycle(lifecycleOwner, selector, preview, imageCapture)
        } catch (_: Exception) {
            toast = "相机启动失败，请重试"
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            // bindToLifecycle 已随生命周期自动解绑，无需手动清理
        }
    }

    // 相册选图
    val pickImage = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri ->
        if (uri != null) {
            scope.launch {
                val f = File(context.cacheDir,
                    "pick_${SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(Date())}.jpg")
                val ok = withContext(Dispatchers.IO) {
                    runCatching {
                        context.contentResolver.openInputStream(uri)?.use { input ->
                            f.outputStream().use { input.copyTo(it) }
                        } ?: false
                    }.isSuccess && f.exists() && f.length() > 0
                }
                if (ok) {
                    PendingCapture.apply {
                        filePath = f.absolutePath
                        templateId = template.id
                        this.values = values
                        this.placement = placement
                        recordId = null
                    }
                    onPicked()
                } else {
                    toast = "读取所选图片失败"
                }
            }
        }
    }

    // 拍照：直接渲染水印保存为记录并关闭（对齐 iOS triggerCapture）
    fun doCapture(containerW: Float, containerH: Float) {
        if (capturing) return
        capturing = true
        val f = File(context.cacheDir,
            "capture_${SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(Date())}.jpg")
        val options = ImageCapture.OutputFileOptions.Builder(f).build()
        // takePicture 在相机未成功绑定（如部分华为机型 bind 失败）时会同步抛异常，必须防护
        runCatching {
            imageCapture.takePicture(
                options,
                ContextCompat.getMainExecutor(context),
                object : ImageCapture.OnImageSavedCallback {
                    override fun onImageSaved(results: ImageCapture.OutputFileResults) {
                        scope.launch {
                            // 协程内任何未捕获异常/Error 都会导致闪退，必须兜底
                            try {
                                val rec = withContext(Dispatchers.IO) {
                                    // 解码（含 EXIF 摆正、长边 ≤2048 防 OOM）
                                    val image = StorageManager.decodeScaled(f, 2048)
                                    var saved: com.watermark.camera.core.Record? = null
                                    if (image != null) {
                                        saved = try {
                                            PhotoSaver.save(
                                                image = image, template = template, values = values,
                                                placement = placement,
                                                canvasW = containerW, canvasH = containerH,
                                                folderId = null
                                            )
                                        } catch (_: Exception) { null }
                                        catch (_: OutOfMemoryError) { null }
                                        // 解码位图用完即释放
                                        image.recycle()
                                    }
                                    f.delete()
                                    saved
                                }
                                capturing = false
                                if (rec != null) {
                                    onClose()
                                } else {
                                    toast = "保存失败，请重试"
                                }
                            } catch (e: kotlinx.coroutines.CancellationException) {
                                throw e
                            } catch (_: OutOfMemoryError) {
                                capturing = false
                                toast = "内存不足，保存失败"
                            } catch (_: Exception) {
                                capturing = false
                                toast = "保存失败，请重试"
                            }
                        }
                    }

                    override fun onError(exception: ImageCaptureException) {
                        capturing = false
                        toast = "拍照失败：${exception.message ?: "未知错误"}"
                    }
                }
            )
        }.onFailure {
            capturing = false
            toast = "拍照失败：相机未就绪"
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (hasPermission) {
            BoxWithConstraints(Modifier.fillMaxSize()) {
                val containerW = constraints.maxWidth.toFloat()
                val containerH = constraints.maxHeight.toFloat()

                // 相机预览
                AndroidView(
                    factory = { previewView },
                    modifier = Modifier.fillMaxSize()
                )

                // 初始放置按模板预设位置计算
                LaunchedEffect(template.id, containerW, containerH) {
                    if (!placementInitialized && containerW > 0 && containerH > 0) {
                        placement = OverlayMapper.defaultPlacement(template, containerW, containerH)
                        placementInitialized = true
                    }
                }

                // 实时水印浮层
                WatermarkOverlay(
                    template = template,
                    values = values,
                    containerWidth = containerW,
                    containerHeight = containerH,
                    placement = placement,
                    interactive = true,
                    onPlacementChange = { placement = it }
                )

                // 顶部：关闭 / 闪光灯 / 前后切换
                Row(
                    Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = onClose) {
                        Icon(Icons.Filled.Close, "关闭", tint = Color.White)
                    }
                    Row {
                        IconButton(onClick = {
                            flashOn = !flashOn
                            flashHint = if (flashOn) "闪光灯已开启（拍照瞬间生效）" else "闪光灯已关闭"
                        }) {
                            Icon(
                                if (flashOn) Icons.Filled.FlashOn else Icons.Filled.FlashOff,
                                if (flashOn) "关闭闪光灯" else "开启闪光灯",
                                tint = Color.White
                            )
                        }
                        IconButton(onClick = { frontCamera = !frontCamera }) {
                            Icon(Icons.Filled.FlipCameraAndroid, "切换摄像头", tint = Color.White)
                        }
                    }
                }

                // 闪光灯提示（自动消失）
                flashHint?.let { hint ->
                    LaunchedEffect(hint) {
                        kotlinx.coroutines.delay(1600)
                        flashHint = null
                    }
                    Text(
                        hint,
                        color = Color.White,
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.align(Alignment.TopCenter)
                            .statusBarsPadding().padding(top = 52.dp)
                            .clip(CircleShape)
                            .background(Color(0x99000000))
                            .padding(horizontal = 12.dp, vertical = 6.dp)
                    )
                }

                // 底部：相册选图 / 快门 / 字段面板
                Column(
                    Modifier.fillMaxWidth().align(Alignment.BottomCenter)
                        .navigationBarsPadding().padding(bottom = 20.dp)
                ) {
                    if (showFields) {
                        Surface(
                            color = Color(0xF2FFFFFF),
                            shape = MaterialTheme.shapes.large
                        ) {
                            Column(
                                Modifier.fillMaxWidth().padding(14.dp)
                                    .height(280.dp).verticalScroll(rememberScrollState())
                            ) {
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
                        Spacer(Modifier.height(12.dp))
                    }

                    // 模板选择
                    Box(Modifier.align(Alignment.CenterHorizontally)) {
                        OutlinedButton(onClick = { templateMenuOpen = true }) {
                            Text(template.name, color = Color.White)
                            Icon(Icons.Filled.KeyboardArrowDown, null, tint = Color.White)
                        }
                        DropdownMenu(expanded = templateMenuOpen,
                            onDismissRequest = { templateMenuOpen = false }) {
                            (BuiltinTemplates.all + StorageManager.customTemplates).forEach { t ->
                                DropdownMenuItem(
                                    text = { Text(t.name) },
                                    onClick = {
                                        template = t
                                        templateMenuOpen = false
                                        placementInitialized = false
                                        // 对齐 iOS：切换模板持久化为当前拍摄模板
                                        StorageManager.activeTemplateID = t.id
                                    }
                                )
                            }
                        }
                    }
                    Spacer(Modifier.height(12.dp))

                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 32.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        IconButton(
                            onClick = { pickImage.launch("image/*") },
                            modifier = Modifier.size(52.dp)
                        ) {
                            Icon(Icons.Filled.PhotoLibrary, "相册选图",
                                tint = Color.White, modifier = Modifier.size(30.dp))
                        }

                        Button(
                            onClick = {
                                imageCapture.flashMode =
                                    if (flashOn) ImageCapture.FLASH_MODE_ON else ImageCapture.FLASH_MODE_OFF
                                doCapture(containerW, containerH)
                            },
                            modifier = Modifier.size(76.dp),
                            shape = CircleShape,
                            colors = ButtonDefaults.buttonColors(containerColor = Color.White),
                            contentPadding = PaddingValues(0.dp)
                        ) {
                            if (capturing) {
                                CircularProgressIndicator(
                                    Modifier.size(28.dp), strokeWidth = 3.dp,
                                    color = Color(0xFF4472C4))
                            } else {
                                Box(
                                    Modifier.size(62.dp).clip(CircleShape)
                                        .background(Color(0xFF4472C4))
                                )
                            }
                        }

                        OutlinedButton(
                            onClick = { showFields = !showFields },
                            modifier = Modifier.size(52.dp),
                            shape = CircleShape,
                            contentPadding = PaddingValues(0.dp)
                        ) {
                            Text("字段", color = Color.White,
                                style = MaterialTheme.typography.labelSmall)
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "拖动移动水印 · 双指等比缩放 · 拖动边缘单向缩放",
                        color = Color.White.copy(alpha = 0.8f),
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.align(Alignment.CenterHorizontally)
                    )
                }
            }
        } else {
            // 无权限提示
            Column(
                Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text("需要相机权限", color = Color.White)
                Spacer(Modifier.height(16.dp))
                Button(onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }) {
                    Text("授权相机")
                }
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = onClose) { Text("取消") }
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
                shape = MaterialTheme.shapes.small,
                modifier = Modifier.align(Alignment.Center)
            ) {
                Text(msg, color = Color.White, modifier = Modifier.padding(14.dp))
            }
        }
    }
}
