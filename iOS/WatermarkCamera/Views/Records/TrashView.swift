import SwiftUI

// MARK: - 回收站

struct TrashView: View {
    @EnvironmentObject var storage: StorageManager
    @State private var showEmptyConfirm = false

    var body: some View {
        Group {
            if storage.trash.isEmpty {
                ContentUnavailableView("回收站是空的",
                                       systemImage: "trash",
                                       description: Text("删除的照片会出现在这里，30 天后自动清理"))
            } else {
                List {
                    ForEach(storage.trash) { rec in
                        HStack(spacing: 12) {
                            PhotoThumbnail(record: rec, size: 56)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(rec.customName ?? "记录 \(formatDateTime(Date(timeIntervalSince1970: rec.createdAt)))")
                                    .font(.subheadline)
                                Text("删除于 \(formatDateTime(Date(timeIntervalSince1970: rec.deletedAt ?? 0)))")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                            Spacer()
                            Button {
                                storage.restoreFromTrash(rec.id)
                            } label: {
                                Image(systemName: "arrow.uturn.backward")
                            }
                            .buttonStyle(.bordered)
                            .tint(.blue)
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                storage.deletePermanently(rec.id)
                            } label: {
                                Label("彻底删除", systemImage: "trash.slash")
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("回收站")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !storage.trash.isEmpty {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("清空") { showEmptyConfirm = true }
                        .tint(.red)
                }
            }
        }
        .confirmationDialog("清空回收站将永久删除全部照片，确定？", isPresented: $showEmptyConfirm, titleVisibility: .visible) {
            Button("清空回收站", role: .destructive) {
                storage.emptyTrash()
            }
        }
    }
}

/// 缩略图（列表复用）
struct PhotoThumbnail: View {
    let record: Record
    var size: CGFloat = 56

    var body: some View {
        if let thumb = StorageManager.shared.thumbnail(for: record) {
            Image(uiImage: thumb)
                .resizable()
                .scaledToFill()
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        } else {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(.systemGray5))
                .frame(width: size, height: size)
                .overlay(Image(systemName: "photo").foregroundColor(.secondary))
        }
    }
}