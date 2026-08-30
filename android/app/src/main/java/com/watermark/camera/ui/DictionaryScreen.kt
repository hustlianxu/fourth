package com.watermark.camera.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.watermark.camera.core.AppSettings
import com.watermark.camera.core.genId

// MARK: - 自定义词典 / 不翻译白名单（对齐 iOS DictionaryView）

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DictionaryScreen(onBack: () -> Unit) {
    var zh by remember { mutableStateOf("") }
    var es by remember { mutableStateOf("") }
    var whitelistText by remember { mutableStateOf(AppSettings.customWhitelist.joinToString("\n")) }
    var whitelistSaved by remember { mutableStateOf<String?>(null) }
    val dict = AppSettings.customDict

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("自定义词典") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回")
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // 新增对照
            item {
                Text("新增对照", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(6.dp))
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedTextField(
                        value = zh, onValueChange = { zh = it },
                        label = { Text("中文") },
                        singleLine = true,
                        modifier = Modifier.weight(1f)
                    )
                    OutlinedTextField(
                        value = es, onValueChange = { es = it },
                        label = { Text("西语") },
                        singleLine = true,
                        modifier = Modifier.weight(1f)
                    )
                    IconButton(
                        onClick = {
                            val z = zh.trim(); val e = es.trim()
                            if (z.isNotEmpty() && e.isNotEmpty()) {
                                AppSettings.saveCustomDict(
                                    listOf(com.watermark.camera.core.DictEntry(genId("d"), z, e)) + dict)
                                zh = ""; es = ""
                            }
                        },
                        enabled = zh.isNotBlank() && es.isNotBlank()
                    ) {
                        Icon(Icons.Filled.Add, "添加",
                            tint = MaterialTheme.colorScheme.primary)
                    }
                }
                Text(
                    "本地词典优先匹配，支持“整句 + 词边界”两种匹配方式（与翻译引擎一致）。",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // 词条列表
            item {
                Spacer(Modifier.height(12.dp))
                Text("自定义词典（${dict.size}）", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(6.dp))
            }
            if (dict.isEmpty()) {
                item {
                    Text("暂无自定义词条", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else {
                items(dict, key = { it.id }) { entry ->
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(entry.zh, Modifier.weight(1f),
                            style = MaterialTheme.typography.bodyMedium)
                        Text(entry.es,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.width(8.dp))
                        IconButton(onClick = {
                            AppSettings.saveCustomDict(dict.filter { it.id != entry.id })
                        }) {
                            Icon(Icons.Filled.Delete, "删除",
                                tint = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }

            // 白名单
            item {
                Spacer(Modifier.height(12.dp))
                Text("不翻译白名单（${AppSettings.customWhitelist.size}）",
                    style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(6.dp))
                OutlinedTextField(
                    value = whitelistText,
                    onValueChange = { whitelistText = it },
                    label = { Text("每行一个词，如：RGB / LED / pcs") },
                    minLines = 4, maxLines = 10,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(8.dp))
                Row {
                    Button(
                        onClick = {
                            val cleaned = whitelistText.split("\n")
                                .map { it.trim() }.filter { it.isNotEmpty() }
                            AppSettings.saveCustomWhitelist(cleaned)
                            whitelistSaved = "已保存 ${cleaned.size} 个白名单词"
                        },
                        enabled = whitelistText.isNotBlank()
                    ) { Text("保存白名单") }
                    Spacer(Modifier.width(12.dp))
                    whitelistSaved?.let {
                        Text(it, color = MaterialTheme.colorScheme.primary,
                            style = MaterialTheme.typography.labelMedium,
                            modifier = Modifier.align(Alignment.CenterVertically))
                    }
                }
                Text(
                    "数字、货号、单位（m³、kg、pcs 等）自带白名单，无需重复添加。",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
