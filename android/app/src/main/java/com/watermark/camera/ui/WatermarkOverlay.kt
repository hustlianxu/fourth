package com.watermark.camera.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.watermark.camera.core.OverlayPlacement
import com.watermark.camera.core.WatermarkRenderer
import com.watermark.camera.core.WatermarkTemplate
import kotlin.math.roundToInt

// MARK: - 可拖动/可缩放的水印浮层
//
// 交互模型（与 iOS WatermarkOverlay 一致）：
//   - 单指在块内拖动 → 移动水印位置
//   - 双指 → 等比缩放（字体 + 块一起）
//   - 单指拖动左右边缘手柄 → 仅水平缩放（文字重排）
//   - 单指拖动上下边缘手柄 → 仅垂直缩放（字号/行距变化）
//   - 点按水印块 → onTap（编辑器中打开内容编辑）

private enum class Edge { LEFT, RIGHT, TOP, BOTTOM }

@Composable
fun WatermarkOverlay(
    template: WatermarkTemplate,
    values: Map<String, String>,
    containerWidth: Float,
    containerHeight: Float,
    placement: OverlayPlacement,
    interactive: Boolean = true,
    onTap: (() -> Unit)? = null,
    onPlacementChange: ((OverlayPlacement) -> Unit)? = null
) {
    if (containerWidth <= 0 || containerHeight <= 0) return

    // 当前值的手势安全读取（避免 pointerInput 闭包捕获旧值）
    val currentPlacement by rememberUpdatedState(placement)
    val currentOnChange by rememberUpdatedState(onPlacementChange)
    // 手柄拖动基准（手势开始时的块尺寸）
    var handleBase by remember { mutableStateOf<Pair<Float, Float>?>(null) }

    // 字段值全为空时 blockSize 为 null —— 此时也必须显示占位块，
    // 否则水印“消失”（既无法点按唤出编辑，保存也会因 renderParams 为 null 失败）
    val hasContent = WatermarkRenderer.blockSize(
        template, values, containerWidth,
        placement.scale.toFloat(), placement.scaleX.toFloat(), placement.scaleY.toFloat()
    ) != null
    val size = WatermarkRenderer.blockSize(
        template, values, containerWidth,
        placement.scale.toFloat(), placement.scaleX.toFloat(), placement.scaleY.toFloat()
    ) ?: (containerWidth * template.widthRatio.toFloat() to 80f)

    // 预览位图：scale/内容变化时重渲染（scale 量化到 5% 步进，降低重建频率）
    val renderKey = remember(placement.scale, placement.scaleX, placement.scaleY,
        containerWidth, template, values) {
        listOf(
            (placement.scale * 20).roundToInt(),
            (placement.scaleX * 20).roundToInt(),
            (placement.scaleY * 20).roundToInt(),
            values.hashCode()
        )
    }
    val blockBitmap = remember(renderKey) {
        // 位图创建可能 OOM（组合期间主线程未捕获的 Error 会直接闪退），失败时退化为不显示内容图
        try {
            WatermarkRenderer.blockPreview(
                template, values, containerWidth,
                placement.scale.toFloat(), placement.scaleX.toFloat(), placement.scaleY.toFloat(),
                density = 2f
            )
        } catch (_: OutOfMemoryError) {
            try {
                WatermarkRenderer.blockPreview(
                    template, values, containerWidth,
                    placement.scale.toFloat(), placement.scaleX.toFloat(), placement.scaleY.toFloat(),
                    density = 1f
                )
            } catch (_: Throwable) { null }
        } catch (_: Exception) { null }
    }

    val centerX = containerWidth / 2 + placement.dx.toFloat() * containerWidth
    val centerY = containerHeight / 2 + placement.dy.toFloat() * containerHeight
    val wDp = with(LocalDensity.current) { size.first.toDp() }
    val hDp = with(LocalDensity.current) { size.second.toDp() }
    val offsetX = (centerX - size.first / 2).roundToInt()
    val offsetY = (centerY - size.second / 2).roundToInt()

    Box(
        Modifier
            .offset { IntOffset(offsetX, offsetY) }
            .requiredSize(wDp, hDp)
    ) {
        // 虚线边框提示可编辑
        if (interactive) {
            Box(
                Modifier
                    .fillMaxSize()
                    .border(1.dp, Color.White.copy(alpha = 0.55f))
            )
        }

        blockBitmap?.let { bmp ->
            Image(
                bitmap = bmp.asImageBitmap(),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize()
            )
        }

        // 无内容占位提示（字段值全空）：保证水印块可见、可点按唤出编辑
        if (blockBitmap == null && interactive) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    "点按输入水印内容",
                    color = Color.White.copy(alpha = 0.9f),
                    style = MaterialTheme.typography.labelSmall,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
            }
        }

        // 手势层：独立于内容位图（占位态也要可拖动/缩放/点按）
        if (interactive) {
            Box(
                Modifier
                    .fillMaxSize()
                    .pointerInput(containerWidth, containerHeight) {
                        detectTapGestures { onTap?.invoke() }
                    }
                    .pointerInput(containerWidth, containerHeight) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            val p = currentPlacement
                            val newDx = p.dx + pan.x / containerWidth
                            val newDy = p.dy + pan.y / containerHeight
                            val newScale = (p.scale * zoom).coerceIn(0.4, 3.0)
                            currentOnChange?.invoke(
                                p.copy(dx = newDx, dy = newDy, scale = newScale)
                            )
                        }
                    }
            )
        }

        if (interactive && hasContent) {
            // 四个边缘手柄：拖动开始时记录当前块尺寸作为缩放基准
            val startHandle: () -> Unit = { handleBase = size.first to size.second }
            EdgeHandle(Edge.LEFT, Modifier.align(Alignment.CenterStart), startHandle) { total ->
                applyHandle(currentPlacement, currentOnChange, handleBase) { base, s ->
                    s.copy(scaleX = ((base.first - total) / base.first).toDouble().coerceIn(0.3, 3.0))
                }
            }
            EdgeHandle(Edge.RIGHT, Modifier.align(Alignment.CenterEnd), startHandle) { total ->
                applyHandle(currentPlacement, currentOnChange, handleBase) { base, s ->
                    s.copy(scaleX = ((base.first + total) / base.first).toDouble().coerceIn(0.3, 3.0))
                }
            }
            EdgeHandle(Edge.TOP, Modifier.align(Alignment.TopCenter), startHandle) { total ->
                applyHandle(currentPlacement, currentOnChange, handleBase) { base, s ->
                    s.copy(scaleY = ((base.second - total) / base.second).toDouble().coerceIn(0.3, 3.0))
                }
            }
            EdgeHandle(Edge.BOTTOM, Modifier.align(Alignment.BottomCenter), startHandle) { total ->
                applyHandle(currentPlacement, currentOnChange, handleBase) { base, s ->
                    s.copy(scaleY = ((base.second + total) / base.second).toDouble().coerceIn(0.3, 3.0))
                }
            }
        }
    }
}

private fun applyHandle(
    placement: OverlayPlacement,
    onChange: ((OverlayPlacement) -> Unit)?,
    base: Pair<Float, Float>?,
    transform: (Pair<Float, Float>, OverlayPlacement) -> OverlayPlacement
) {
    if (base == null) return
    onChange?.invoke(transform(base, placement))
}

@Composable
private fun EdgeHandle(edge: Edge, modifier: Modifier,
                        onDragStart: () -> Unit, onDelta: (Float) -> Unit) {
    val isHorizontal = edge == Edge.LEFT || edge == Edge.RIGHT
    Box(
        modifier
            .requiredSize(26.dp)
            .clip(CircleShape)
            .background(Color.White)
            .pointerInput(edge) {
                var total = 0f
                detectDragGestures(
                    onDragStart = {
                        total = 0f
                        onDragStart()
                    },
                    onDragEnd = { },
                    onDragCancel = { }
                ) { change, amount ->
                    change.consume()
                    total += if (isHorizontal) amount.x else amount.y
                    onDelta(total)
                }
            },
        contentAlignment = Alignment.Center
    ) {
        // 方向指示点
        Box(
            Modifier
                .requiredSize(6.dp)
                .clip(CircleShape)
                .background(Color(0xFF4472C4))
        )
    }
}
