package com.watermark.camera.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Divider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.watermark.camera.core.AppSettings
import com.watermark.camera.core.BuiltinTemplates
import com.watermark.camera.core.CloudSyncManager
import com.watermark.camera.core.ExportService
import com.watermark.camera.core.StorageManager
import com.watermark.camera.core.formatBytes

// MARK: - 设置（模板/拍摄/翻译/存储/云端扩展/回收站/导出文件）

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onBack: () -> Unit,
                   onOpenTrash: () -> Unit,
                   onOpenTemplateEditor: (String?) -> Unit,
                   onOpenDictionary: () -> Unit,
                   onOpenTranslationConfig: () -> Unit) {
    val context = LocalContext.current
    val storage = StorageManager
    var clearExportsConfirm by remember { mutableStateOf(false) }
    var storageBytes by remember { mutableStateOf(0L) }
    val exportFiles = remember { mutableStateOf(storage.exportFiles()) }

    // 每次进入刷新占用
    androidx.compose.runtime.LaunchedEffect(Unit) {
        storageBytes = storage.totalStorageBytes()
        exportFiles.value = storage.exportFiles()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("设置") },
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
        ) {
            // 拍摄模板
            Text(
                "拍摄模板",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
            )
            (BuiltinTemplates.all + storage.customTemplates).forEach { t ->
                Row(
                    Modifier.fillMaxWidth().clickable {
                        storage.activeTemplateID = t.id
                    }.padding(horizontal = 16.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    RadioButton(
                        selected = storage.activeTemplateID == t.id,
                        onClick = { storage.activeTemplateID = t.id }
                    )
                    Column(Modifier.weight(1f)) {
                        Text(t.name, style = MaterialTheme.typography.bodyMedium)
                        t.desc?.let {
                            Text(it, style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                        }
                    }
                    if (!t.isBuiltin) {
                        IconButton(onClick = { onOpenTemplateEditor(t.id) }) {
                            Icon(Icons.Default.Share, "编辑",
                                tint = MaterialTheme.colorScheme.primary)
                        }
                        IconButton(onClick = { storage.deleteTemplate(t.id) }) {
                            Icon(Icons.Default.Delete, "删除",
                                tint = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
            OutlinedButton(
                onClick = { onOpenTemplateEditor(null) },
                modifier = Modifier.padding(horizontal = 16.dp)
            ) {
                Icon(Icons.Default.Add, null)
                Spacer(Modifier.padding(4.dp))
                Text("新建模板")
            }

            Divider(Modifier.padding(vertical = 12.dp))

            // 拍摄
            Text(
                "拍摄",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
            )
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("拍照后保存到系统相册", Modifier.weight(1f))
                Switch(
                    checked = AppSettings.autoSaveAlbum,
                    onCheckedChange = { AppSettings.updateAutoSaveAlbum(it) }
                )
            }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("编辑保存时也备份到相册", Modifier.weight(1f))
                Switch(
                    checked = AppSettings.autoSaveEditAlbum,
                    onCheckedChange = { AppSettings.updateAutoSaveEditAlbum(it) }
                )
            }

            Divider(Modifier.padding(vertical = 12.dp))

            // 翻译引擎
            Text(
                "翻译引擎",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
            )
            OutlinedButton(
                onClick = onOpenDictionary,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp).fillMaxWidth()
            ) { Text("自定义词典") }
            OutlinedButton(
                onClick = onOpenTranslationConfig,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp).fillMaxWidth()
            ) { Text("翻译接口配置") }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("优先调用大模型翻译", Modifier.weight(1f))
                Switch(
                    checked = AppSettings.llmFirst,
                    onCheckedChange = { AppSettings.updateLlmFirst(it) }
                )
            }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("允许使用免费在线词典（MyMemory）", Modifier.weight(1f))
                Switch(
                    checked = AppSettings.freeDictEnabled,
                    onCheckedChange = { AppSettings.updateFreeDictEnabled(it) }
                )
            }
            Text(
                "导出时描述（西语/中文）空缺会自动翻译补全：优先本地词典，其次免费词典，最后大模型接口。",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp)
            )

            Divider(Modifier.padding(vertical = 12.dp))

            // 云端存储（预留扩展）
            Text(
                "云端存储（扩展）",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
            )
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("当前模式", Modifier.weight(1f))
                Text(
                    CloudSyncManager.provider.displayName,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Text(
                "当前为纯本机模式，照片与 Excel 全部保存在手机内，不受存储配额限制。后续接入 OSS / S3 / NAS(WebDAV) 后，可在应用内配置远端地址自动同步。",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp)
            )

            Divider(Modifier.padding(vertical = 12.dp))

            // 存储
            Text(
                "存储",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
            )
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("本机占用", Modifier.weight(1f))
                Text(formatBytes(storageBytes), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(
                "每张照片保存两份（干净原图 + 水印成品图）；回收站中的照片在彻底删除前仍占用空间。",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp)
            )
            OutlinedButton(
                onClick = onOpenTrash,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
            ) {
                Text("回收站（${storage.trash.size}）")
            }

            // 导出文件
            if (exportFiles.value.isNotEmpty()) {
                Divider(Modifier.padding(vertical = 12.dp))
                Text(
                    "导出文件（.xlsx）",
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                )
                exportFiles.value.forEach { f ->
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(f.name, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                            Text(formatBytes(f.length()),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        IconButton(onClick = { ExportService.shareFile(context, f) }) {
                            Icon(Icons.Default.Share, "分享")
                        }
                        IconButton(onClick = {
                            f.delete()
                            exportFiles.value = storage.exportFiles()
                        }) {
                            Icon(Icons.Default.Delete, "删除",
                                tint = MaterialTheme.colorScheme.error)
                        }
                    }
                }
                OutlinedButton(
                    onClick = { clearExportsConfirm = true },
                    modifier = Modifier.padding(horizontal = 16.dp)
                ) { Text("清空全部导出文件") }
            }
        }
    }

    if (clearExportsConfirm) {
        AlertDialog(
            onDismissRequest = { clearExportsConfirm = false },
            title = { Text("清空全部 ${exportFiles.value.size} 个导出文件？") },
            confirmButton = {
                TextButton(onClick = {
                    exportFiles.value.forEach { it.delete() }
                    exportFiles.value = storage.exportFiles()
                    clearExportsConfirm = false
                }) { Text("清空", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { clearExportsConfirm = false }) { Text("取消") } }
        )
    }
}
