package com.watermark.camera.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import com.watermark.camera.core.OverlayPlacement
import com.watermark.camera.core.StorageManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// MARK: - 跨屏传参（拍摄 → 编辑器）

object PendingCapture {
    /** 拍摄后的临时图片文件路径 */
    var filePath: String? = null
    var templateId: String? = null
    var values: Map<String, String> = emptyMap()
    var placement: OverlayPlacement = OverlayPlacement()
    /** 非空 = 编辑已有记录 */
    var recordId: String? = null
}

// MARK: - 公共 UI 组件

/** 异步解码并显示记录图片 */
@Composable
fun PhotoImage(path: String?, modifier: Modifier = Modifier, maxDim: Int = 1280) {
    val bitmap by produceState<Bitmap?>(initialValue = null, path) {
        value = withContext(Dispatchers.IO) {
            path?.let { StorageManager.fileFor(it) }?.let { StorageManager.decodeScaled(it, maxDim) }
        }
    }
    Box(modifier.background(Color(0xFFE8E8EC)), contentAlignment = Alignment.Center) {
        bitmap?.let {
            Image(
                bitmap = it.asImageBitmap(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.matchParentSize()
            )
        } ?: Text("…", color = Color.Gray)
    }
}

/** 列表缩略图 */
@Composable
fun PhotoThumbnail(path: String?, size: Int = 56) {
    PhotoImage(path, Modifier.size(androidx.compose.ui.unit.Dp(size.toFloat()))
        .clip(RoundedCornerShape(8)))
}

/** 异步加载整图（编辑/详情用，带解码标志） */
@Composable
fun rememberDecodedBitmap(path: String?, maxDim: Int = 4096): Pair<Bitmap?, Boolean> {
    var loading by remember(path) { mutableStateOf(true) }
    val bitmap by produceState<Bitmap?>(initialValue = null, path) {
        value = withContext(Dispatchers.IO) {
            path?.let { StorageManager.fileFor(it) }?.let { StorageManager.decodeScaled(it, maxDim) }
        }
        loading = false
    }
    return bitmap to loading
}

/** 简单提示条 */
@Composable
fun HintText(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier
    )
}
