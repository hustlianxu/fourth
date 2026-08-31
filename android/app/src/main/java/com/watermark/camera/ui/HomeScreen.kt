package com.watermark.camera.ui

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Camera
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.watermark.camera.core.AlbumSaver
import com.watermark.camera.core.Record
import com.watermark.camera.core.StorageManager
import com.watermark.camera.core.formatBytes
import com.watermark.camera.core.formatDateTime

private const val UNCATEGORIZED_KEY = "__uncategorized__"

// MARK: - 首页：记录列表（文件夹分组/折叠/多选批量/新建删除文件夹）

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(onOpenRecord: (String) -> Unit,
               onOpenCamera: () -> Unit,
               onOpenExport: () -> Unit,
               onOpenSettings: () -> Unit) {
    val storage = StorageManager
    var selectionMode by rememberSaveable { mutableStateOf(false) }
    var selectedIds by remember { mutableStateOf(setOf<String>()) }
    var collapsedGroups by remember { mutableStateOf(setOf<String>()) }
    var showNewFolder by remember { mutableStateOf(false) }
    var deleteFolderID by remember { mutableStateOf<String?>(null) }
    var moveRecordId by remember { mutableStateOf<String?>(null) }
    var toast by remember { mutableStateOf<String?>(null) }
    var showBatchTrashConfirm by remember { mutableStateOf(false) }

    val allIds = storage.records.map { it.id }.toSet()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("水印相机") },
                navigationIcon = {
                    if (storage.records.isNotEmpty()) {
                        TextButton(onClick = {
                            selectionMode = !selectionMode
                            selectedIds = emptySet()
                        }) { Text(if (selectionMode) "完成" else "选择") }
                    }
                },
                actions = {
                    if (!selectionMode) {
                        if (storage.records.isNotEmpty()) {
                            IconButton(onClick = onOpenExport) {
                                // 分享图标（对齐 iOS square.and.arrow.up），
                                // 语义是“导出并发送”，避免下载图标的误解
                                Icon(Icons.Filled.Share, "导出 Excel")
                            }
                        }
                        IconButton(onClick = { showNewFolder = true }) {
                            Icon(Icons.Filled.Folder, "新建文件夹")
                        }
                        IconButton(onClick = onOpenSettings) {
                            Icon(Icons.Default.MoreVert, "设置")
                        }
                    }
                }
            )
        },
        floatingActionButton = {
            if (!selectionMode) {
                FloatingActionButton(onClick = onOpenCamera) {
                    Icon(Icons.Filled.CameraAlt, "拍摄")
                }
            }
        }
    ) { padding ->
        val uncategorized = storage.recordsInFolder(null)
        val hasContent = uncategorized.isNotEmpty() || storage.folders.isNotEmpty()

        if (!hasContent) {
            Column(
                Modifier.fillMaxSize().padding(padding).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Icon(Icons.Filled.Camera, null, Modifier.size(64.dp), tint = Color(0xFFBBB))
                Spacer(Modifier.height(16.dp))
                Text("还没有水印照片", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                Text("点击右下角相机按钮开始拍摄", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(16.dp))
                OutlinedButton(onClick = onOpenCamera) { Text("去拍摄") }
            }
        } else {
            LazyColumn(
                Modifier.fillMaxSize().padding(padding).animateContentSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 96.dp)
            ) {
                if (uncategorized.isNotEmpty()) {
                    item {
                        groupHeader("未分类", UNCATEGORIZED_KEY, uncategorized.size,
                            showDelete = false, collapsedGroups,
                            onToggle = { key ->
                                collapsedGroups = if (collapsedGroups.contains(key))
                                    collapsedGroups - key else collapsedGroups + key
                            })
                    }
                    if (!collapsedGroups.contains(UNCATEGORIZED_KEY)) {
                        items(uncategorized, key = { it.id }) { rec ->
                            RecordRow(rec, selectionMode, selectedIds.contains(rec.id),
                                onClick = {
                                    if (selectionMode) {
                                        selectedIds =
                                            if (selectedIds.contains(rec.id)) selectedIds - rec.id
                                            else selectedIds + rec.id
                                    } else onOpenRecord(rec.id)
                                },
                                onDelete = { storage.moveToTrash(rec.id) },
                                onMove = { moveRecordId = rec.id })
                        }
                    }
                }
                storage.folders.forEach { folder ->
                    val items = storage.recordsInFolder(folder.id)
                    item {
                        groupHeader(folder.name, folder.id, items.size,
                            showDelete = true, collapsedGroups,
                            onToggle = { key ->
                                collapsedGroups = if (collapsedGroups.contains(key))
                                    collapsedGroups - key else collapsedGroups + key
                            },
                            onDelete = { deleteFolderID = folder.id })
                    }
                    if (!collapsedGroups.contains(folder.id)) {
                        items(items, key = { it.id }) { rec ->
                            RecordRow(rec, selectionMode, selectedIds.contains(rec.id),
                                onClick = {
                                    if (selectionMode) {
                                        selectedIds =
                                            if (selectedIds.contains(rec.id)) selectedIds - rec.id
                                            else selectedIds + rec.id
                                    } else onOpenRecord(rec.id)
                                },
                                onDelete = { storage.moveToTrash(rec.id) },
                                onMove = { moveRecordId = rec.id })
                        }
                    }
                }
            }
        }

        // 多选批量操作条
        if (selectionMode) {
            Surface(
                shadowElevation = 8.dp,
                modifier = Modifier.fillMaxWidth().padding(padding)
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TextButton(onClick = {
                        selectedIds = if (selectedIds == allIds) emptySet() else allIds
                    }) { Text(if (selectedIds == allIds) "取消全选" else "全选") }

                    Text("已选 ${selectedIds.size} 张",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)

                    val ctx = androidx.compose.ui.platform.LocalContext.current
                    TextButton(onClick = {
                        var saved = 0
                        selectedIds.forEach { id ->
                            storage.record(id)?.let { rec ->
                                storage.image(rec)?.let {
                                    if (AlbumSaver.saveToAlbum(ctx, it)) saved++
                                }
                            }
                        }
                        toast = if (saved > 0) "已保存 $saved 张到相册" else "保存失败"
                    }, enabled = selectedIds.isNotEmpty()) { Text("存入相册") }

                    TextButton(onClick = { showBatchTrashConfirm = true },
                        enabled = selectedIds.isNotEmpty()) {
                        Text("移入回收站", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }

    // 新建文件夹（重名校验）
    if (showNewFolder) {
        var name by remember { mutableStateOf("") }
        val duplicate = storage.folderNameExists(name)
        AlertDialog(
            onDismissRequest = { showNewFolder = false },
            title = { Text("新建文件夹") },
            text = {
                Column {
                    OutlinedTextField(
                        value = name, onValueChange = { name = it },
                        label = { Text("文件夹名称") },
                        singleLine = true,
                        isError = duplicate,
                        supportingText = {
                            if (duplicate) Text("已存在同名文件夹", color = MaterialTheme.colorScheme.error)
                        }
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        storage.addFolder(name)
                        showNewFolder = false
                    },
                    enabled = name.isNotBlank() && !duplicate
                ) { Text("创建") }
            },
            dismissButton = { TextButton(onClick = { showNewFolder = false }) { Text("取消") } }
        )
    }

    // 删除文件夹确认
    deleteFolderID?.let { fid ->
        val folder = storage.folders.firstOrNull { it.id == fid }
        AlertDialog(
            onDismissRequest = { deleteFolderID = null },
            title = { Text("删除文件夹「${folder?.name ?: ""}」？") },
            text = { Text("文件夹内的照片会保留并移动到未分类") },
            confirmButton = {
                TextButton(onClick = {
                    storage.removeFolder(fid)
                    collapsedGroups = collapsedGroups - fid
                    deleteFolderID = null
                }) { Text("删除", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { deleteFolderID = null }) { Text("取消") } }
        )
    }

    // 移动到文件夹
    moveRecordId?.let { rid ->
        AlertDialog(
            onDismissRequest = { moveRecordId = null },
            title = { Text("移动到文件夹") },
            text = {
                Column {
                    storage.folders.forEach { f ->
                        Text(
                            f.name,
                            Modifier.fillMaxWidth().clickable {
                                storage.record(rid)?.let { rec ->
                                    rec.folderId = f.id
                                    rec.updatedAt = System.currentTimeMillis() / 1000
                                    storage.updateRecord(rec)
                                }
                                moveRecordId = null
                            }.padding(vertical = 12.dp)
                        )
                    }
                    if (storage.folders.isEmpty()) {
                        Text("暂无文件夹，请先在首页新建", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { moveRecordId = null }) { Text("取消") } }
        )
    }

    // 批量移入回收站确认
    if (showBatchTrashConfirm) {
        AlertDialog(
            onDismissRequest = { showBatchTrashConfirm = false },
            title = { Text("将选中的 ${selectedIds.size} 张照片移入回收站？") },
            text = { Text("移入回收站后仍占用空间，可在设置 → 回收站中彻底删除") },
            confirmButton = {
                TextButton(onClick = {
                    storage.batchMoveToTrash(selectedIds)
                    selectedIds = emptySet()
                    showBatchTrashConfirm = false
                }) { Text("移入回收站", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { showBatchTrashConfirm = false }) { Text("取消") } }
        )
    }

    // Toast 提示
    toast?.let { msg ->
        LaunchedEffect(msg) {
            kotlinx.coroutines.delay(2000)
            toast = null
        }
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Surface(
                color = Color(0xCC000000),
                shape = RoundedCornerShape(8.dp)
            ) {
                Text(msg, color = Color.White, modifier = Modifier.padding(14.dp))
            }
        }
    }
}

// MARK: - 分组标题（点击折叠 + 文件夹删除按钮）

@Composable
private fun groupHeader(title: String, key: String, count: Int,
                        showDelete: Boolean, collapsed: Set<String>,
                        onToggle: (String) -> Unit,
                        onDelete: (() -> Unit)? = null) {
    val isCollapsed = collapsed.contains(key)
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            Modifier.weight(1f).clickable { onToggle(key) }.padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                if (isCollapsed) Icons.Filled.KeyboardArrowRight else Icons.Filled.KeyboardArrowDown,
                null, tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                "$title（$count）",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        if (showDelete) {
            IconButton(onClick = { onDelete?.invoke() }, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Filled.Delete, "删除文件夹",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
            }
        }
    }
}

// MARK: - 记录行

@Composable
private fun RecordRow(rec: Record, selectionMode: Boolean, isSelected: Boolean,
                      onClick: () -> Unit, onDelete: () -> Unit, onMove: () -> Unit) {
    var showMenu by remember { mutableStateOf(false) }
    Surface(color = MaterialTheme.colorScheme.surface) {
        Row(
            Modifier.fillMaxWidth().clickable { onClick() }.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (selectionMode) {
                Icon(
                    if (isSelected) Icons.Filled.CheckCircle else Icons.Outlined.RadioButtonUnchecked,
                    null, tint = if (isSelected) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(Modifier.width(12.dp))
            }
            PhotoThumbnail(rec.imagePath, 56)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    rec.customName ?: rec.values["modelo"] ?: "未命名",
                    style = MaterialTheme.typography.bodyMedium, maxLines = 1
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    formatDateTime(rec.updatedAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (!selectionMode) {
                IconButton(onClick = { showMenu = true }) {
                    Icon(Icons.Default.MoreVert, "更多")
                }
                DropdownMenu(showMenu, onDismissRequest = { showMenu = false }) {
                    DropdownMenuItem(text = { Text("移入回收站") }, onClick = {
                        showMenu = false; onDelete()
                    })
                    DropdownMenuItem(text = { Text("移动到文件夹") }, onClick = {
                        showMenu = false; onMove()
                    })
                }
            }
        }
    }
}
