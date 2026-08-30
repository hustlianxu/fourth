package com.watermark.camera.core

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject

// MARK: - 词典 / 翻译配置模型（对齐 iOS Models.swift）

data class DictEntry(val id: String, val zh: String, val es: String) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id); put("zh", zh); put("es", es)
    }

    companion object {
        fun fromJson(o: JSONObject): DictEntry = DictEntry(
            id = o.optString("id"), zh = o.optString("zh"), es = o.optString("es"))
    }
}

data class TranslationAPIConfig(
    var id: String = genId("cfg"),
    var provider: String = "deepseek",
    var baseURL: String = "",
    var model: String = "",
    var apiKey: String = ""
) {
    val displayName: String
        get() {
            val p = if (provider.isBlank()) "自定义" else provider
            return if (model.isBlank()) p else "$p · $model"
        }

    val hasKey: Boolean get() = apiKey.isNotBlank()

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id); put("provider", provider); put("baseURL", baseURL)
        put("model", model); put("apiKey", apiKey)
    }

    companion object {
        fun fromJson(o: JSONObject): TranslationAPIConfig = TranslationAPIConfig(
            id = o.optString("id").ifBlank { genId("cfg") },
            provider = o.optString("provider", "deepseek"),
            baseURL = o.optString("baseURL"),
            model = o.optString("model"),
            apiKey = o.optString("apiKey")
        )
    }
}

data class FreeDictConfig(
    var enabled: Boolean = false,
    var provider: String = ""    // "mymemory" | ""
)

// MARK: - 应用级设置（SharedPreferences 持久化，对齐 iOS AppSettings）

object AppSettings {

    private lateinit var prefs: android.content.SharedPreferences

    // Compose 可观察状态（写入即持久化 + 触发 UI 刷新）
    var autoSaveAlbum by mutableStateOf(false)
        private set
    var autoSaveEditAlbum by mutableStateOf(false)
        private set
    var llmFirst by mutableStateOf(false)
        private set
    var freeDictEnabled by mutableStateOf(false)
        private set
    var apiConfigs by mutableStateOf(listOf<TranslationAPIConfig>())
        private set
    var activeAPIConfigID by mutableStateOf("")
        private set
    var customDict by mutableStateOf(listOf<DictEntry>())
        private set
    var customWhitelist by mutableStateOf(listOf<String>())
        private set

    fun init(context: Context) {
        prefs = context.getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        autoSaveAlbum = prefs.getBoolean("auto_save_album", false)
        autoSaveEditAlbum = prefs.getBoolean("auto_save_edit_album", false)
        llmFirst = prefs.getBoolean("translator_llm_first", false)
        freeDictEnabled = prefs.getBoolean("translator_free_dict_enabled", false)
        activeAPIConfigID = prefs.getString("translator_active_api_config", "") ?: ""
        apiConfigs = loadConfigs()
        customDict = loadDict()
        customWhitelist = (prefs.getString("custom_whitelist", "") ?: "")
            .split("\n").map { it.trim() }.filter { it.isNotEmpty() }
    }

    private fun loadConfigs(): List<TranslationAPIConfig> = try {
        val raw = prefs.getString("translator_api_configs", null)
        if (raw == null) emptyList()
        else {
            val arr = JSONArray(raw)
            List(arr.length()) { TranslationAPIConfig.fromJson(arr.getJSONObject(it)) }
        }
    } catch (_: Exception) { emptyList() }

    private fun loadDict(): List<DictEntry> = try {
        val raw = prefs.getString("custom_dict", null)
        if (raw == null) emptyList()
        else {
            val arr = JSONArray(raw)
            List(arr.length()) { DictEntry.fromJson(arr.getJSONObject(it)) }
        }
    } catch (_: Exception) { emptyList() }

    // MARK: - 写入接口（持久化 + 刷新观察状态）

    fun updateAutoSaveAlbum(v: Boolean) {
        autoSaveAlbum = v; prefs.edit().putBoolean("auto_save_album", v).apply()
    }

    fun updateAutoSaveEditAlbum(v: Boolean) {
        autoSaveEditAlbum = v; prefs.edit().putBoolean("auto_save_edit_album", v).apply()
    }

    fun updateLlmFirst(v: Boolean) {
        llmFirst = v; prefs.edit().putBoolean("translator_llm_first", v).apply()
    }

    fun updateFreeDictEnabled(v: Boolean) {
        freeDictEnabled = v; prefs.edit().putBoolean("translator_free_dict_enabled", v).apply()
    }

    fun updateActiveAPIConfigID(id: String) {
        activeAPIConfigID = id
        prefs.edit().putString("translator_active_api_config", id).apply()
    }

    fun saveApiConfigs(list: List<TranslationAPIConfig>) {
        apiConfigs = list
        val arr = JSONArray()
        list.forEach { arr.put(it.toJson()) }
        prefs.edit().putString("translator_api_configs", arr.toString()).apply()
    }

    fun deleteApiConfig(id: String) {
        val list = apiConfigs.filter { it.id != id }
        saveApiConfigs(list)
        if (activeAPIConfigID == id) updateActiveAPIConfigID(list.firstOrNull()?.id ?: "")
    }

    fun saveCustomDict(list: List<DictEntry>) {
        customDict = list
        val arr = JSONArray()
        list.forEach { arr.put(it.toJson()) }
        prefs.edit().putString("custom_dict", arr.toString()).apply()
    }

    fun saveCustomWhitelist(list: List<String>) {
        customWhitelist = list
        prefs.edit().putString("custom_whitelist", list.joinToString("\n")).apply()
    }

    // MARK: - 派生值

    /** 翻译引擎实际使用的配置（激活项；无激活则取第一个） */
    val apiConfig: TranslationAPIConfig
        get() = apiConfigs.firstOrNull { it.id == activeAPIConfigID }
            ?: apiConfigs.firstOrNull()
            ?: TranslationAPIConfig()

    val hasLLM: Boolean
        get() = apiConfig.hasKey && apiConfig.baseURL.isNotBlank()

    val appVersion: String = "1.0.0"
}
