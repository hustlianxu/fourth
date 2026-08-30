package com.watermark.camera

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.watermark.camera.core.AppSettings
import com.watermark.camera.core.StorageManager
import com.watermark.camera.ui.CameraScreen
import com.watermark.camera.ui.DictionaryScreen
import com.watermark.camera.ui.ExportScreen
import com.watermark.camera.ui.HomeScreen
import com.watermark.camera.ui.PhotoEditorScreen
import com.watermark.camera.ui.PendingCapture
import com.watermark.camera.ui.RecordDetailScreen
import com.watermark.camera.ui.SettingsScreen
import com.watermark.camera.ui.TemplateEditorScreen
import com.watermark.camera.ui.TranslationConfigScreen
import com.watermark.camera.ui.TrashScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        StorageManager.init(this)
        AppSettings.init(this)
        setContent {
            WatermarkCameraTheme {
                AppNav()
            }
        }
    }
}

@Composable
fun WatermarkCameraTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val colors = if (dark) {
        darkColorScheme(
            primary = Color(0xFF9BBBF3),
            surface = Color(0xFF1A1A1E),
            background = Color(0xFF121216)
        )
    } else {
        lightColorScheme(
            primary = Color(0xFF4472C4),
            surface = Color(0xFFF7F7FA),
            background = Color(0xFFEDEDF2)
        )
    }
    MaterialTheme(colorScheme = colors, content = content)
}

@Composable
fun AppNav() {
    val nav = rememberNavController()

    NavHost(navController = nav, startDestination = "home") {
        composable("home") {
            HomeScreen(
                onOpenRecord = { id -> nav.navigate("detail/$id") },
                onOpenCamera = { nav.navigate("camera") },
                onOpenExport = { nav.navigate("export") },
                onOpenSettings = { nav.navigate("settings") }
            )
        }

        composable("camera") {
            CameraScreen(
                onClose = { nav.popBackStack() },
                // 相册选图 → 编辑器（对齐 iOS：选图后进 PhotoEditorView）
                onPicked = {
                    nav.navigate("editor") {
                        popUpTo("camera") { inclusive = true }
                    }
                }
            )
        }

        composable("editor") {
            PhotoEditorScreen(onDone = {
                PendingCapture.filePath = null
                PendingCapture.recordId = null
                nav.popBackStack()
            })
        }

        composable("detail/{recordId}") { entry ->
            val recordId = entry.arguments?.getString("recordId") ?: return@composable
            RecordDetailScreen(
                recordId = recordId,
                onBack = { nav.popBackStack() },
                onReeditWatermark = { nav.navigate("editor") }
            )
        }

        composable("export") {
            ExportScreen(onBack = { nav.popBackStack() })
        }

        composable("trash") {
            TrashScreen(onBack = { nav.popBackStack() })
        }

        composable("settings") {
            SettingsScreen(
                onBack = { nav.popBackStack() },
                onOpenTrash = { nav.navigate("trash") },
                onOpenTemplateEditor = { id ->
                    nav.navigate(if (id == null) "templateEditor/new" else "templateEditor/$id")
                },
                onOpenDictionary = { nav.navigate("dictionary") },
                onOpenTranslationConfig = { nav.navigate("translationConfig") }
            )
        }

        composable("dictionary") {
            DictionaryScreen(onBack = { nav.popBackStack() })
        }

        composable("translationConfig") {
            TranslationConfigScreen(onBack = { nav.popBackStack() })
        }

        composable("templateEditor/{templateId}") { entry ->
            val id = entry.arguments?.getString("templateId")
            TemplateEditorScreen(
                templateId = if (id == "new") null else id,
                onBack = { nav.popBackStack() }
            )
        }
    }
}
