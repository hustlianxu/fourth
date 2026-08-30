package com.watermark.camera.ui

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
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Divider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
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
import com.watermark.camera.core.FieldType
import com.watermark.camera.core.StorageManager
import com.watermark.camera.core.TemplateField
import com.watermark.camera.core.TemplateStyle
import com.watermark.camera.core.WatermarkTemplate
import com.watermark.camera.core.genId

private val POSITIONS = listOf(
    "top-left", "top-center", "top-right",
    "center-left", "center", "center-right",
    "bottom-left", "bottom-center", "bottom-right"
)

private val POSITION_LABELS = mapOf(
    "top-left" to "上左", "top-center" to "上中", "top-right" to "上右",
    "center-left" to "中左", "center" to "居中", "center-right" to "中右",
    "bottom-left" to "下左", "bottom-center" to "下中", "bottom-right" to "下右"
)

// MARK: - 模板编辑器（名称/位置/宽度比/样式/字段增删改）

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TemplateEditorScreen(templateId: String?, onBack: () -> Unit) {
    val existing = templateId?.let { id ->
        StorageManager.customTemplates.firstOrNull { it.id == id }
    }

    var name by remember { mutableStateOf(existing?.name ?: "") }
    var desc by remember { mutableStateOf(existing?.desc ?: "") }
    var position by remember { mutableStateOf(existing?.position ?: "bottom-center") }
    var widthRatio by remember { mutableStateOf((existing?.widthRatio ?: 0.42).toFloat()) }
    var style by remember { mutableStateOf(existing?.style ?: TemplateStyle()) }
    var fields by remember {
        mutableStateOf(
            (existing?.fields ?: listOf(
                TemplateField("modelo", "货号 · Modelo", FieldType.TEXT, "如：RL-034"),
                TemplateField("fecha", "日期 · Fecha", FieldType.DATETIME)
            )).toMutableList()
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (existing == null) "新建模板" else "编辑模板") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回")
                    }
                },
                actions = {
                    TextButton(
                        onClick = {
                            val t = WatermarkTemplate(
                                id = existing?.id ?: genId("t"),
                                name = name.ifBlank { "未命名模板" },
                                desc = desc.ifBlank { null },
                                isBuiltin = false,
                                position = position,
                                widthRatio = widthRatio.toDouble(),
                                style = style,
                                fields = fields
                            )
                            StorageManager.saveTemplate(t)
                            onBack()
                        },
                        enabled = name.isNotBlank() && fields.isNotEmpty()
                    ) { Text("保存") }
                }
            )
        }
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())
                .padding(16.dp)
        ) {
            OutlinedTextField(
                value = name, onValueChange = { name = it },
                label = { Text("模板名称") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = desc, onValueChange = { desc = it },
                label = { Text("描述（可选）") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
            )

            Spacer(Modifier.padding(8.dp))
            Text("水印位置", style = MaterialTheme.typography.titleSmall)
            Row(Modifier.padding(vertical = 4.dp)) {
                POSITIONS.take(3).forEach { p ->
                    FilterChip(selected = position == p, onClick = { position = p },
                        label = { Text(POSITION_LABELS[p] ?: p) })
                    Spacer(Modifier.padding(2.dp))
                }
            }
            Row {
                POSITIONS.drop(3).take(3).forEach { p ->
                    FilterChip(selected = position == p, onClick = { position = p },
                        label = { Text(POSITION_LABELS[p] ?: p) })
                    Spacer(Modifier.padding(2.dp))
                }
            }
            Row {
                POSITIONS.drop(6).forEach { p ->
                    FilterChip(selected = position == p, onClick = { position = p },
                        label = { Text(POSITION_LABELS[p] ?: p) })
                    Spacer(Modifier.padding(2.dp))
                }
            }

            Spacer(Modifier.padding(8.dp))
            Text("水印宽度比例：${(widthRatio * 100).toInt()}%", style = MaterialTheme.typography.titleSmall)
            Slider(
                value = widthRatio,
                onValueChange = { widthRatio = it },
                valueRange = 0.2f..0.95f
            )

            Spacer(Modifier.padding(8.dp))
            Text("样式", style = MaterialTheme.typography.titleSmall)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("字号", Modifier.weight(1f))
                Text("${style.fontSize.toInt()}")
            }
            Slider(
                value = style.fontSize.toFloat(),
                onValueChange = { style = style.copy(fontSize = it.toDouble()) },
                valueRange = 12f..48f
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("文字颜色", Modifier.weight(1f))
                OutlinedTextField(
                    value = style.colorHex,
                    onValueChange = { style = style.copy(colorHex = it) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(0.5f)
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                Text("背景色", Modifier.weight(1f))
                OutlinedTextField(
                    value = style.backgroundRGBA,
                    onValueChange = { style = style.copy(backgroundRGBA = it) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(0.7f)
                )
            }

            Divider(Modifier.padding(vertical = 12.dp))

            Text("字段（${fields.size}）", style = MaterialTheme.typography.titleSmall)
            fields.forEachIndexed { idx, f ->
                Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("#${idx + 1}", style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.weight(1f))
                        IconButton(onClick = {
                            fields = fields.toMutableList().also { it.removeAt(idx) }
                        }) {
                            Icon(Icons.Default.Delete, "删除字段",
                                tint = MaterialTheme.colorScheme.error)
                        }
                    }
                    OutlinedTextField(
                        value = f.label, onValueChange = { v ->
                            fields = fields.toMutableList().also { it[idx] = f.copy(label = v) }
                        },
                        label = { Text("标签") }, singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = f.key, onValueChange = { v ->
                            fields = fields.toMutableList().also { it[idx] = f.copy(key = v) }
                        },
                        label = { Text("字段键名（英文）") }, singleLine = true,
                        modifier = Modifier.fillMaxWidth().padding(top = 4.dp)
                    )
                    Row(Modifier.padding(top = 4.dp)) {
                        FieldType.entries.forEach { t ->
                            FilterChip(
                                selected = f.type == t,
                                onClick = { fields = fields.toMutableList().also { it[idx] = f.copy(type = t) } },
                                label = { Text(t.displayName, style = MaterialTheme.typography.labelSmall) }
                            )
                            Spacer(Modifier.padding(2.dp))
                        }
                    }
                }
            }

            OutlinedButton(
                onClick = {
                    fields = fields.toMutableList().also {
                        it.add(TemplateField(genId("k"), "新字段", FieldType.TEXT))
                    }
                },
                modifier = Modifier.padding(vertical = 8.dp)
            ) { Text("+ 添加字段") }

            Spacer(Modifier.padding(bottom = 24.dp))
        }
    }
}
