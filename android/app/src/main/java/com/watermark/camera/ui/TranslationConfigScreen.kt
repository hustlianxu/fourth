package com.watermark.camera.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.watermark.camera.core.AppSettings
import com.watermark.camera.core.TranslationAPIConfig
import com.watermark.camera.core.TranslatorService
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// MARK: - 翻译接口配置（多服务商 / 多密钥，OpenAI 兼容协议；对齐 iOS TranslationConfigView）

private data class Preset(
    val name: String,
    val provider: String,
    val baseURL: String,
    val model: String,
    val note: String
)

/** 主流大模型服务商预设（均兼容 OpenAI /chat/completions 协议） */
private val presets = listOf(
    Preset("DeepSeek", "deepseek", "https://api.deepseek.com/v1", "deepseek-chat", "性价比高，推荐"),
    Preset("通义千问", "qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus", "阿里 DashScope 兼容模式"),
    Preset("Kimi", "moonshot", "https://api.moonshot.cn/v1", "moonshot-v1-8k", "月之暗面"),
    Preset("智谱 GLM", "zhipu", "https://open.bigmodel.cn/api/paas/v4", "glm-4-flash", "glm-4-flash 免费"),
    Preset("OpenAI", "openai", "https://api.openai.com/v1", "gpt-4o-mini", "官方接口"),
    Preset("Ollama 本地", "ollama", "http://192.168.1.100:11434/v1", "qwen2.5:7b", "填你电脑的局域网 IP")
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TranslationConfigScreen(onBack: () -> Unit) {
    val scope = rememberCoroutineScope()

    var provider by remember { mutableStateOf("") }
    var baseURL by remember { mutableStateOf("") }
    var model by remember { mutableStateOf("") }
    var apiKey by remember { mutableStateOf("") }
    var testInput by remember { mutableStateOf("") }
    var testResult by remember { mutableStateOf("") }
    var isTesting by remember { mutableStateOf(false) }
    var savedToast by remember { mutableStateOf(false) }
    /** 正在编辑的配置 id（null = 新建） */
    var editingConfigID by remember { mutableStateOf<String?>(null) }

    val configs = AppSettings.apiConfigs
    val hasConfig = apiKey.isNotBlank() && baseURL.isNotBlank()

    fun load(cfg: TranslationAPIConfig) {
        editingConfigID = cfg.id
        provider = cfg.provider
        baseURL = cfg.baseURL
        model = cfg.model
        apiKey = cfg.apiKey
    }

    fun applyPreset(p: Preset) {
        editingConfigID = null
        provider = p.provider
        baseURL = p.baseURL
        model = p.model
    }

    fun saveConfig(asNew: Boolean) {
        val cfg = TranslationAPIConfig(
            provider = provider.trim(),
            baseURL = baseURL.trim(),
            model = model.trim(),
            apiKey = apiKey.trim()
        )
        val list = configs.toMutableList()
        val editingID = editingConfigID
        val idx = if (editingID != null && !asNew) list.indexOfFirst { it.id == editingID } else -1
        val finalCfg = if (idx >= 0) {
            cfg.copy(id = editingID!!).also { list[idx] = it }
        } else {
            list.add(cfg)
            cfg
        }
        AppSettings.saveApiConfigs(list)
        AppSettings.updateActiveAPIConfigID(finalCfg.id)
        editingConfigID = finalCfg.id
        savedToast = true
    }

    fun deleteConfig(cfg: TranslationAPIConfig) {
        AppSettings.deleteApiConfig(cfg.id)
        if (editingConfigID == cfg.id) editingConfigID = null
    }

    fun runTest() {
        val text = testInput.trim()
        if (text.isEmpty() || isTesting) return
        val lang = TranslatorService.detectLang(text)
        val from = if (lang == "zh") "zh" else "es"
        val to = if (lang == "zh") "es" else "zh"
        isTesting = true
        testResult = ""
        scope.launch {
            val result = TranslatorService.translate(text, from, to)
            isTesting = false
            testResult = result
        }
    }

    // 首次进入：载入当前激活配置
    LaunchedEffect(Unit) {
        if (editingConfigID == null) load(AppSettings.apiConfig)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("翻译接口配置") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
        ) {
            // 已保存配置
            Text("已保存配置（${configs.size}）", style = MaterialTheme.typography.titleSmall)
            if (configs.isEmpty()) {
                Text(
                    "尚未保存任何配置",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 8.dp)
                )
            } else {
                configs.forEach { cfg ->
                    Row(
                        Modifier.fillMaxWidth()
                            .clickable {
                                AppSettings.updateActiveAPIConfigID(cfg.id)
                                load(cfg)
                            }
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(cfg.displayName, style = MaterialTheme.typography.bodyMedium)
                            Text(
                                if (cfg.hasKey) "密钥已配置" else "密钥未配置",
                                style = MaterialTheme.typography.labelSmall,
                                color = if (cfg.hasKey) MaterialTheme.colorScheme.onSurfaceVariant
                                else MaterialTheme.colorScheme.error
                            )
                        }
                        if (cfg.id == AppSettings.activeAPIConfigID) {
                            Icon(
                                Icons.Filled.CheckCircle, "使用中",
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                        IconButton(onClick = { load(cfg) }) {
                            Icon(Icons.Filled.Edit, "编辑",
                                tint = MaterialTheme.colorScheme.primary)
                        }
                        IconButton(onClick = { deleteConfig(cfg) }) {
                            Icon(Icons.Filled.Delete, "删除",
                                tint = MaterialTheme.colorScheme.error)
                        }
                    }
                }
                Text(
                    "翻译引擎仅使用「使用中」的那一条配置。点击条目可直接切换。",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Divider(Modifier.padding(vertical = 12.dp))

            // 服务商预设
            Text("服务商预设", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(4.dp))
            presets.forEach { p ->
                Row(
                    Modifier.fillMaxWidth().clickable { applyPreset(p) }
                        .padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(p.name, style = MaterialTheme.typography.bodyMedium)
                        Text(
                            p.note,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Icon(
                        Icons.Filled.CloudDownload, "填入",
                        tint = MaterialTheme.colorScheme.primary
                    )
                }
            }
            Text(
                "点击预设自动填入接口地址与模型名，只需再填 API Key 保存即可。",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Divider(Modifier.padding(vertical = 12.dp))

            // 接口参数
            Text("接口参数", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = provider,
                onValueChange = { provider = it },
                label = { Text("服务商（如 deepseek）") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
            OutlinedTextField(
                value = baseURL,
                onValueChange = { baseURL = it },
                label = { Text("Base URL（如 https://api.deepseek.com/v1）") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
            OutlinedTextField(
                value = model,
                onValueChange = { model = it },
                label = { Text("模型名（如 deepseek-chat）") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
            OutlinedTextField(
                value = apiKey,
                onValueChange = { apiKey = it },
                label = { Text("API Key") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                visualTransformation = PasswordVisualTransformation()
            )

            Divider(Modifier.padding(vertical = 12.dp))

            // 测试翻译
            Text("测试翻译", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = testInput,
                onValueChange = { testInput = it },
                label = { Text("待翻译文本（中文或西语）") },
                modifier = Modifier.fillMaxWidth()
            )
            if (testResult.isNotEmpty()) {
                Text(
                    testResult,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 4.dp)
                )
            }
            Button(
                onClick = { runTest() },
                enabled = testInput.isNotBlank() && !isTesting
            ) {
                Text(if (isTesting) "翻译中..." else "测试")
            }

            Divider(Modifier.padding(vertical = 12.dp))

            // 保存
            Button(onClick = { saveConfig(false) }, enabled = hasConfig) {
                Text(if (editingConfigID == null) "保存配置" else "保存修改")
            }
            if (editingConfigID != null) {
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { saveConfig(true) }, enabled = hasConfig) {
                    Icon(Icons.Filled.Add, null)
                    Spacer(Modifier.width(4.dp))
                    Text("另存为新配置")
                }
            }
            Text(
                "可保存多个服务商的密钥，按需切换。兼容任意 OpenAI 格式接口：DeepSeek、通义千问、Kimi、智谱、本地 Ollama 等。留空不保存则仅使用本地词典与免费词典。",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp)
            )

            // 保存成功提示
            if (savedToast) {
                LaunchedEffect(savedToast) {
                    delay(1200)
                    savedToast = false
                }
                Text(
                    "已保存",
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }
        }
    }
}
