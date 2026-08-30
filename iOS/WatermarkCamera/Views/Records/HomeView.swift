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
    /// 折叠的分组（文件夹 id；未分类用固定 key）
    @State private var collapsedGroups: Set<String> = []
    /// 待删除的文件夹 id
    @State private var deleteFolderID: String?

    var body: some View {
        Group {
            // 记录为空但已建文件夹时仍显示列表：否则空文件夹不可见、无法删除
            if storage.records.isEmpty && storage.folders.isEmpty {
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
        .sheet(isPresented: $showNewFolder) {
            newFolderSheet
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

    // MARK: - 记录列表（文件夹分组，可折叠）

    /// 未分类分组的折叠 key（与文件夹 id 区分）
    private static let uncategorizedKey = "__uncategorized__"

    private var recordList: some View {
        List {
            let uncategorized = storage.records(inFolder: nil)
            if !uncategorized.isEmpty {
                groupSection(title: "未分类", key: Self.uncategorizedKey, count: uncategorized.count,
                             showDelete: false) {
                    ForEach(uncategorized) { rec in
                        RecordRowView(record: rec, onMove: { id in
                            moveRecordID = id
                        })
                        .environmentObject(storage)
                    }
                }
            }

            // 空文件夹也显示：否则创建后看不见，也无法删除
            ForEach(storage.folders) { folder in
                let items = storage.records(inFolder: folder.id)
                groupSection(title: folder.name, key: folder.id, count: items.count,
                             showDelete: true) {
                    ForEach(items) { rec in
                        RecordRowView(record: rec, onMove: { id in
                            moveRecordID = id
                        })
                        .environmentObject(storage)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .confirmationDialog("删除文件夹「\(pendingDeleteFolderName)」？",
                            isPresented: folderDeleteBinding,
                            titleVisibility: .visible) {
            Button("删除（照片移至未分类）", role: .destructive) {
                if let id = deleteFolderID {
                    withAnimation { storage.removeFolder(id) }
                    collapsedGroups.remove(id)
                }
                deleteFolderID = nil
            }
            Button("取消", role: .cancel) { deleteFolderID = nil }
        } message: {
            Text("文件夹内的照片会保留并移动到未分类")
        }
    }

    /// 可折叠分组：点 header 切换折叠；文件夹分组长按 header 可删除
    private func groupSection<Content: View>(title: String, key: String, count: Int,
                                             showDelete: Bool,
                                             @ViewBuilder content: () -> Content) -> some View {
        let collapsed = collapsedGroups.contains(key)
        return Section {
            if !collapsed {
                content()
            }
        } header: {
            Button {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                    if collapsed {
                        collapsedGroups.remove(key)
                    } else {
                        collapsedGroups.insert(key)
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .rotationEffect(.degrees(collapsed ? 0 : 90))
                    Text("\(title)（\(count)）")
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    Spacer()
                }
                .foregroundStyle(.secondary)
                .contentShape(Rectangle())
                .padding(.vertical, 2)
            }
            .buttonStyle(.plain)
            .contextMenu {
                if showDelete {
                    Button(role: .destructive) {
                        deleteFolderID = key
                    } label: {
                        Label("删除文件夹", systemImage: "trash")
                    }
                }
            }
        }
    }

    // MARK: - 新建文件夹（带重名校验）

    /// 输入名称 trim 后为空或与现有文件夹重名时不可创建
    private var trimmedNewFolderName: String {
        newFolderName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var newFolderNameError: String? {
        let n = trimmedNewFolderName
        if n.isEmpty { return "名称不能为空" }
        if storage.folderNameExists(n) { return "已存在同名文件夹" }
        return nil
    }

    private var newFolderSheet: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("文件夹名称", text: $newFolderName)
                } header: {
                    Text("名称")
                } footer: {
                    if let err = newFolderNameError {
                        Label(err, systemImage: "exclamationmark.circle.fill")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("新建文件夹")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        newFolderName = ""
                        showNewFolder = false
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("创建") {
                        storage.addFolder(name: trimmedNewFolderName)
                        newFolderName = ""
                        showNewFolder = false
                    }
                    .disabled(newFolderNameError != nil)
                }
            }
        }
        .presentationDetents([.medium])
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

    private var folderDeleteBinding: Binding<Bool> {
        Binding(
            get: { deleteFolderID != nil },
            set: { if !$0 { deleteFolderID = nil } }
        )
    }

    /// 待删除文件夹显示名（未找到时兜底空串，避免弹窗标题出现 optional）
    private var pendingDeleteFolderName: String {
        storage.folders.first(where: { $0.id == deleteFolderID })?.name ?? ""
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