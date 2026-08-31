package com.watermark.camera.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.watermark.camera.core.ExportImageCompression
import com.watermark.camera.core.ExportService
import com.watermark.camera.core.ExportSortOrder
import com.watermark.camera.core.StorageManager
import kotlinx.coroutines.launch

// MARK: - 导出 Excel（范围/压缩比/排序选择，列表顺序 = 导出行顺序）
//
// 选项样式对齐 iOS ExportView 的 inline Picker：
// 每个选项独占一行，左侧标题、右侧选中打勾，分组卡片呈现。

/** iOS 风格设置分组卡片 */
@Composable
private fun SettingsGroup(title: String, content: @Composable () -> Unit) {
    Text(title, style = MaterialTheme.typography.titleSmall,
        modifier = Modifier.padding(top = 20.dp, bottom = 8.dp))
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)
    ) {
        Column(Modifier.fillMaxWidth()) { content() }
    }
}

/** iOS 风格单选行：右侧打勾（对齐 SwiftUI Picker inline 选中态） */
@Composable
private fun PickerRow(
    label: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    Row(
        Modifier.fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            color = if (selected) MaterialTheme.colorScheme.primary
            else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f)
        )
        if (selected) {
            Icon(
                Icons.Filled.Check, "已选中",
                tint = MaterialTheme.colorScheme.primary
            )
        }
    }
}

/** iOS 风格分段选择（组内多个选项连续排列，中间细分隔线） */
@Composable
private fun <T> PickerGroup(
    options: List<T>,
    selected: T,
    label: (T) -> String,
    onSelect: (T) -> Unit
) {
    options.forEachIndexed { i, opt ->
        PickerRow(label = label(opt), selected = selected == opt) { onSelect(opt) }
        if (i < options.size - 1) {
            androidx.compose.material3.HorizontalDivider(
                modifier = Modifier.padding(start = 16.dp),
                thickness = 0.5.dp,
                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExportScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val storage = StorageManager

    // 全部 or 按文件夹
    var scopeFolderId by remember { mutableStateOf<String?>(null) }  // null = 全部
    var compression by remember { mutableStateOf(ExportImageCompression.UNDER_1MB) }
    var sortOrder by remember { mutableStateOf(ExportSortOrder.CREATED_AT_DESC) }
    var exporting by remember { mutableStateOf(false) }
    var toast by remember { mutableStateOf<String?>(null) }

    // 所见即所得：列表顺序 = 导出行顺序
    val records = remember(scopeFolderId, sortOrder, storage.records) {
        val base = if (scopeFolderId == null) storage.records
        else storage.records.filter { it.folderId == scopeFolderId }
        sortOrder.sort(base)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("导出 Excel") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp)
        ) {
            // 范围
            SettingsGroup("导出范围") {
                val folderOptions = buildList {
                    add(null to "全部（${storage.records.size}）")
                    storage.folders.forEach { f ->
                        add(f.id to "${f.name}（${storage.recordsInFolder(f.id).size}）")
                    }
                }
                PickerGroup(
                    options = folderOptions.map { it.first },
                    selected = scopeFolderId,
                    label = { id -> folderOptions.first { it.first == id }.second },
                    onSelect = { scopeFolderId = it }
                )
            }

            // 图片压缩
            SettingsGroup("图片压缩") {
                PickerGroup(
                    options = ExportImageCompression.entries.toList(),
                    selected = compression,
                    label = { it.displayName },
                    onSelect = { compression = it }
                )
            }
            Text(
                "列表顺序即导出后 Excel 的行顺序",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 4.dp, top = 6.dp)
            )

            // 导出排序
            SettingsGroup("导出排序") {
                PickerGroup(
                    options = ExportSortOrder.entries.toList(),
                    selected = sortOrder,
                    label = { it.displayName },
                    onSelect = { sortOrder = it }
                )
            }

            // 待导出列表
            Text(
                "将导出 ${records.size} 条记录",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(top = 20.dp, bottom = 8.dp)
            )
            if (records.isEmpty()) {
                Text("当前范围没有记录", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            Spacer(Modifier.height(24.dp))

            Button(
                onClick = {
                    if (exporting || records.isEmpty()) return@Button
                    exporting = true
                    val template = storage.activeTemplate
                    scope.launch {
                        val file = ExportService.exportExcel(records, template, compression)
                        exporting = false
                        if (file != null) {
                            ExportService.shareFile(context, file)
                        } else {
                            toast = "导出失败"
                        }
                    }
                },
                enabled = !exporting && records.isNotEmpty(),
                modifier = Modifier.fillMaxWidth()
            ) {
                if (exporting) {
                    CircularProgressIndicator(Modifier.height(20.dp), strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary)
                    Spacer(Modifier.padding(4.dp))
                }
                Text(if (exporting) "导出中…" else "导出并分享")
            }
        }
    }

    toast?.let { msg ->
        androidx.compose.runtime.LaunchedEffect(msg) {
            kotlinx.coroutines.delay(1800)
            toast = null
        }
        Box(
            Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Surface(
                color = Color(0xCC000000),
                shape = MaterialTheme.shapes.small
            ) {
                Text(msg, color = Color.White,
                    modifier = Modifier.padding(14.dp))
            }
        }
    }
}
