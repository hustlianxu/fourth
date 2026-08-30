package com.watermark.camera.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.unit.dp
import com.watermark.camera.core.StorageManager
import com.watermark.camera.core.formatDateTime

// MARK: - 回收站（恢复 / 彻底删除 / 清空）

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrashScreen(onBack: () -> Unit) {
    val storage = StorageManager
    var emptyConfirm by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("回收站（${storage.trash.size}）") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回")
                    }
                },
                actions = {
                    if (storage.trash.isNotEmpty()) {
                        TextButton(onClick = { emptyConfirm = true }) { Text("清空") }
                    }
                }
            )
        }
    ) { padding ->
        if (storage.trash.isEmpty()) {
            Column(
                Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text("回收站是空的", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            LazyColumn(Modifier.fillMaxSize().padding(padding)) {
                items(storage.trash, key = { it.id }) { rec ->
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        PhotoThumbnail(rec.imagePath, 48)
                        Spacer(Modifier.padding(8.dp))
                        Column(Modifier.weight(1f)) {
                            Text(rec.customName ?: rec.values["modelo"] ?: "未命名",
                                style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                            Text(
                                "删除于 ${formatDateTime(rec.deletedAt ?: rec.updatedAt)}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        TextButton(onClick = { storage.restoreFromTrash(rec.id) }) { Text("恢复") }
                        OutlinedButton(onClick = { storage.deleteForever(rec.id) }) {
                            Text("彻底删除", color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
        }
    }

    if (emptyConfirm) {
        AlertDialog(
            onDismissRequest = { emptyConfirm = false },
            title = { Text("清空回收站？") },
            text = { Text("将彻底删除回收站内的 ${storage.trash.size} 条记录，且不可恢复") },
            confirmButton = {
                TextButton(onClick = {
                    storage.emptyTrash()
                    emptyConfirm = false
                }) { Text("清空", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { emptyConfirm = false }) { Text("取消") } }
        )
    }
}
