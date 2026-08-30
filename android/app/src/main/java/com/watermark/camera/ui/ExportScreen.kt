package com.watermark.camera.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.watermark.camera.core.ExportImageCompression
import com.watermark.camera.core.ExportService
import com.watermark.camera.core.ExportSortOrder
import com.watermark.camera.core.StorageManager
import kotlinx.coroutines.launch

// MARK: - 导出 Excel（范围/压缩比/排序选择，列表顺序 = 导出行顺序）

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
                .padding(16.dp)
        ) {
            // 范围
            Text("导出范围", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(8.dp))
            Row {
                FilterChip(
                    selected = scopeFolderId == null,
                    onClick = { scopeFolderId = null },
                    label = { Text("全部（${storage.records.size}）") }
                )
                Spacer(Modifier.padding(4.dp))
                storage.folders.forEach { f ->
                    FilterChip(
                        selected = scopeFolderId == f.id,
                        onClick = { scopeFolderId = f.id },
                        label = { Text("${f.name}（${storage.recordsInFolder(f.id).size}）") }
                    )
                    Spacer(Modifier.padding(4.dp))
                }
            }

            Spacer(Modifier.height(20.dp))

            // 图片压缩
            Text("图片压缩", style = MaterialTheme.typography.titleSmall)
            Text(
                "选择后列表顺序即导出后 Excel 的行顺序",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(8.dp))
            Column {
                ExportImageCompression.entries.forEach { c ->
                    FilterChip(
                        selected = compression == c,
                        onClick = { compression = c },
                        label = { Text(c.displayName) },
                        modifier = Modifier.padding(vertical = 2.dp)
                    )
                }
            }

            Spacer(Modifier.height(20.dp))

            // 导出排序
            Text("导出排序", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(8.dp))
            Column {
                ExportSortOrder.entries.forEach { o ->
                    FilterChip(
                        selected = sortOrder == o,
                        onClick = { sortOrder = o },
                        label = { Text(o.displayName) },
                        modifier = Modifier.padding(vertical = 2.dp)
                    )
                }
            }

            Spacer(Modifier.height(20.dp))

            // 待导出列表
            Text("将导出 ${records.size} 条记录", style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(12.dp))
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
        androidx.compose.foundation.layout.Box(
            Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            androidx.compose.material3.Surface(
                color = androidx.compose.ui.graphics.Color(0xCC000000),
                shape = MaterialTheme.shapes.small
            ) {
                Text(msg, color = androidx.compose.ui.graphics.Color.White,
                    modifier = Modifier.padding(14.dp))
            }
        }
    }
}
