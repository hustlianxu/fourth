import SwiftUI

// MARK: - 首页：记录列表（按文件夹分组）+ 拍照入口

struct HomeView: View {
    @EnvironmentObject var storage: StorageManager

    @State private var showCamera = false
    @State private var showExport = false
    @State private var showNewFolder = false
    @State private var newFolderName = ""
    /// 待移动的记录 id（触发文件夹选择弹窗）
    @State private var moveRecordID: String?

    var body: some View {
        Group {
            if storage.records.isEmpty {
                emptyState
            } else {
                recordList
            }
        }
        .navigationTitle("水印相机")
        .navigationDestination(for: Record.self) { rec in
            RecordDetailView(record: rec)
                .environmentObject(storage)
        }
        .toolbar {
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                if !storage.records.isEmpty {
                    Button {
                        showExport = true
                    } label: {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .accessibilityLabel("导出 Excel")
                }

                Menu {
                    Button {
                        showNewFolder = true
                    } label: {
                        Label("新建文件夹", systemImage: "folder.badge.plus")
                    }
                    Button {
                        showCamera = true
                    } label: {
                        Label("拍摄照片", systemImage: "camera")
                    }
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .overlay(alignment: .bottom) {
            cameraButton
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraCaptureView()
                .environmentObject(storage)
        }
        .sheet(isPresented: $showExport) {
            ExportView()
                .environmentObject(storage)
        }
        .confirmationDialog("移动到文件夹", isPresented: folderPickerBinding, titleVisibility: .visible) {
            Button("未分类") {
                moveRecord(moveRecordID, to: nil)
            }
            ForEach(storage.folders) { folder in
                Button(folder.name) {
                    moveRecord(moveRecordID, to: folder.id)
                }
            }
            Button("取消", role: .cancel) {}
        }
        .alert("新建文件夹", isPresented: $showNewFolder) {
            TextField("文件夹名称", text: $newFolderName)
            Button("创建") {
                storage.addFolder(name: newFolderName)
                newFolderName = ""
            }
            Button("取消", role: .cancel) {
                newFolderName = ""
            }
        }
    }

    // MARK: - 空状态

    private var emptyState: some View {
        ContentUnavailableView {
            Label("还没有照片", systemImage: "camera")
        } description: {
            Text("点击下方按钮开始拍摄，或从相册选择图片添加水印")
        } actions: {
            Button {
                showCamera = true
            } label: {
                Label("开始拍摄", systemImage: "camera.fill")
            }
            .buttonStyle(.borderedProminent)
        }
    }

    // MARK: - 记录列表（文件夹分组）

    private var recordList: some View {
        List {
            let uncategorized = storage.records(inFolder: nil)
            if !uncategorized.isEmpty {
                Section("未分类（\(uncategorized.count)）") {
                    ForEach(uncategorized) { rec in
                        RecordRowView(record: rec, onMove: { id in
                            moveRecordID = id
                        })
                        .environmentObject(storage)
                    }
                }
            }

            ForEach(storage.folders) { folder in
                let items = storage.records(inFolder: folder.id)
                if !items.isEmpty {
                    Section("\(folder.name)（\(items.count)）") {
                        ForEach(items) { rec in
                            RecordRowView(record: rec, onMove: { id in
                                moveRecordID = id
                            })
                            .environmentObject(storage)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    // MARK: - 悬浮快门

    private var cameraButton: some View {
        Button {
            showCamera = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "camera.fill")
                Text("拍照")
            }
            .font(.headline)
            .foregroundColor(.white)
            .padding(.horizontal, 28)
            .padding(.vertical, 14)
            .background(Capsule().fill(Color.accentColor))
            .shadow(color: .black.opacity(0.2), radius: 8, x: 0, y: 4)
        }
        .padding(.bottom, 16)
    }

    // MARK: - 辅助

    private var folderPickerBinding: Binding<Bool> {
        Binding(
            get: { moveRecordID != nil },
            set: { if !$0 { moveRecordID = nil } }
        )
    }

    private func moveRecord(_ id: String?, to folderID: String?) {
        guard let id = id,
              var r = storage.record(withID: id) else {
            moveRecordID = nil
            return
        }
        r.folderId = folderID
        r.updatedAt = Date().timeIntervalSince1970
        storage.updateRecord(r)
        moveRecordID = nil
    }
}

// MARK: - 单条记录行

struct RecordRowView: View {
    @EnvironmentObject var storage: StorageManager
    let record: Record
    var onMove: (String) -> Void

    var body: some View {
        NavigationLink(value: record) {
            HStack(spacing: 12) {
                PhotoThumbnail(record: record, size: 56)
                VStack(alignment: .leading, spacing: 3) {
                    Text(record.customName ?? secondaryTitle)
                        .font(.subheadline.weight(.medium))
                        .lineLimit(1)
                    summaryLine
                }
                Spacer()
                Text(formatDateTime(Date(timeIntervalSince1970: record.updatedAt)))
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                storage.moveToTrash(record.id)
            } label: {
                Label("删除", systemImage: "trash")
            }
            Button {
                onMove(record.id)
            } label: {
                Label("移动", systemImage: "folder")
            }
            .tint(.orange)
        }
        .contextMenu {
            Button("保存到相册") {
                if let img = storage.image(for: record) {
                    UIImageWriteToSavedPhotosAlbum(img, nil, nil, nil)
                }
            }
            Button("移动到文件夹") {
                onMove(record.id)
            }
            Button("移入回收站", role: .destructive) {
                storage.moveToTrash(record.id)
            }
        }
    }

    private var secondaryTitle: String {
        let modelo = record.values["modelo"] ?? ""
        return modelo.isEmpty ? "记录 \(Int(record.updatedAt))" : "记录 · \(modelo)"
    }

    @ViewBuilder
    private var summaryLine: some View {
        let des = record.values["desEs"] ?? record.values["desZh"] ?? ""
        if !des.isEmpty {
            Text(des)
                .font(.caption)
                .foregroundColor(.secondary)
                .lineLimit(1)
        }
    }
}

#Preview {
    NavigationStack {
        HomeView()
            .environmentObject(StorageManager.shared)
    }
}