package com.watermark.camera.core

import java.io.File

// MARK: - 云端存储扩展协议（对齐 iOS CloudSync.swift，预留扩展点）
//
// 当前应用为「纯本地」模式：所有照片与 Excel 都保存在手机本机。
// 后续如需接入 OSS / S3 / WebDAV(NAS) 等外部存储，只需：
//   1. 实现 CloudSyncProvider 接口（上传图片、列表、下载、删除）；
//   2. 在 CloudSyncManager.configure(provider) 中注入实现（可在「设置」中通过 URL/凭证配置）；
//   3. Record 预留了 folderId / customName 字段，云端场景可扩展为云端 fileId。
// 应用其他部分无需改动。

data class CloudFileRef(
    val remotePath: String,
    val localRelativePath: String    // StorageManager 中的相对路径
)

interface CloudSyncProvider {
    val isConfigured: Boolean
    val displayName: String

    /** 上传单个文件 */
    suspend fun upload(localFile: File, remotePath: String): CloudFileRef
    /** 下载单个文件到本地 */
    suspend fun download(remotePath: String, localFile: File)
    /** 列出云端文件 */
    suspend fun list(prefix: String? = null): List<CloudFileRef>
    /** 删除云端文件 */
    suspend fun delete(remotePath: String)
}

/** 未配置时使用的空实现：本地模式下一切方法直接成功/返回空。 */
class NoopCloudProvider : CloudSyncProvider {
    override val isConfigured: Boolean = false
    override val displayName: String = "未配置（本地模式）"

    override suspend fun upload(localFile: File, remotePath: String): CloudFileRef =
        CloudFileRef(remotePath, remotePath)

    override suspend fun download(remotePath: String, localFile: File) {}
    override suspend fun list(prefix: String?): List<CloudFileRef> = emptyList()
    override suspend fun delete(remotePath: String) {}
}

object CloudSyncManager {
    /** 可注入的云端提供方（默认 Noop = 本地模式） */
    @Volatile
    var provider: CloudSyncProvider = NoopCloudProvider()

    val isConfigured: Boolean get() = provider.isConfigured
    val displayName: String get() = provider.displayName

    fun configure(p: CloudSyncProvider) { provider = p }
}
