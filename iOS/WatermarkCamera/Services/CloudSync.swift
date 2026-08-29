import Foundation

// MARK: - 云端存储扩展协议
//
// 当前应用为「纯本地」模式：所有照片与 Excel 都保存在手机本机。
// 后续如需接入 OSS / S3 / WebDAV(NAS) 等外部存储，只需：
//   1. 实现 CloudSyncProvider 协议（上传图片、列表、下载、删除）；
//   2. 在 CloudSyncManager.configure(provider:) 中注入实现（可在「设置」中通过 URL/凭证配置）；
//   3. Record 预留了 folderId / customName 字段，云端场景可扩展为云端 fileId。
// 应用其他部分无需改动。

public struct CloudFileRef: Hashable {
    public var remotePath: String
    public var localRelativePath: String   // StorageManager 中的相对路径
}

public protocol CloudSyncProvider {
    var isConfigured: Bool { get }
    var displayName: String { get }

    /// 上传单个文件
    func upload(localURL: URL, remotePath: String) async throws -> CloudFileRef
    /// 下载单个文件到本地
    func download(remotePath: String, to localURL: URL) async throws
    /// 列出云端文件
    func list(prefix: String?) async throws -> [CloudFileRef]
    /// 删除云端文件
    func delete(remotePath: String) async throws
}

/// 未配置时使用的空实现：本地模式下一切方法直接成功/返回空。
public struct NoopCloudProvider: CloudSyncProvider {
    public var isConfigured: Bool { false }
    public var displayName: String { "未配置（本地模式）" }

    public func upload(localURL: URL, remotePath: String) async throws -> CloudFileRef {
        CloudFileRef(remotePath: remotePath, localRelativePath: remotePath)
    }
    public func download(remotePath: String, to localURL: URL) async throws {}
    public func list(prefix: String?) async throws -> [CloudFileRef] { [] }
    public func delete(remotePath: String) async throws {}
}

public final class CloudSyncManager {
    public static let shared = CloudSyncManager()

    /// 可注入的云端提供方（默认 Noop = 本地模式）
    public var provider: CloudSyncProvider = NoopCloudProvider()

    public var isConfigured: Bool { provider.isConfigured }
}