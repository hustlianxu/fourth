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
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import com.watermark.camera.core.StorageManager
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// MARK: - 相机拍摄页（实时水印浮层 + 字段面板 + 拍摄/相册选图）

@Composable
fun CameraScreen(onClose: () -> Unit, onCaptured: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

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
    var capturing by remember { mutableStateOf(false) }

    // ImageCapture 实例（绑定相机时创建）
    val imageCapture = remember { ImageCapture.Builder().build() }

    // 相册选图
    val pickImage = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri ->
        if (uri != null) {
            val f = File(context.cacheDir,
                "pick_${SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())}.jpg")
            runCatching {
                context.contentResolver.openInputStream(uri)?.use { input ->
                    f.outputStream().use { input.copyTo(it) }
                }
            }
            if (f.exists() && f.length() > 0) {
                PendingCapture.apply {
                    filePath = f.absolutePath
                    templateId = template.id
                    this.values = values
                    this.placement = placement
                    recordId = null
                }
                onCaptured()
            }
        }
    }

    fun doCapture() {
        if (capturing) return
        capturing = true
        val f = File(context.cacheDir,
            "capture_${SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(Date())}.jpg")
        val options = ImageCapture.OutputFileOptions.Builder(f).build()
        imageCapture.takePicture(
            options,
            ContextCompat.getMainExecutor(context),
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(results: ImageCapture.OutputFileResults) {
                    capturing = false
                    PendingCapture.apply {
                        filePath = f.absolutePath
                        templateId = template.id
                        this.values = values
                        this.placement = placement
                        recordId = null
                    }
                    onCaptured()
                }

                override fun onError(exception: ImageCaptureException) {
                    capturing = false
                }
            }
        )
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (hasPermission) {
            BoxWithConstraints(Modifier.fillMaxSize()) {
                val containerW = constraints.maxWidth.toFloat()
                val containerH = constraints.maxHeight.toFloat()

                // 相机预览
                AndroidView(
                    factory = { ctx ->
                        val previewView = PreviewView(ctx)
                        val providerFuture = ProcessCameraProvider.getInstance(ctx)
                        providerFuture.addListener({
                            runCatching {
                                val provider = providerFuture.get()
                                val preview = Preview.Builder().build().also {
                                    it.setSurfaceProvider(previewView.surfaceProvider)
                                }
                                provider.unbindAll()
                                provider.bindToLifecycle(
                                    lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA,
                                    preview, imageCapture
                                )
                            }
                        }, ContextCompat.getMainExecutor(ctx))
                        previewView
                    },
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

                // 顶部：关闭 + 模板选择
                Row(
                    Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = onClose) {
                        Icon(Icons.Filled.Close, "关闭", tint = Color.White)
                    }
                    Box {
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
                                    }
                                )
                            }
                        }
                    }
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
                                        onValueChange = { values[f.key] = it },
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
                            onClick = { doCapture() },
                            modifier = Modifier.size(76.dp),
                            shape = CircleShape,
                            colors = ButtonDefaults.buttonColors(containerColor = Color.White),
                            contentPadding = PaddingValues(0.dp)
                        ) {
                            Box(
                                Modifier.size(62.dp).clip(CircleShape)
                                    .background(Color(0xFF4472C4))
                            )
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
    }
}
