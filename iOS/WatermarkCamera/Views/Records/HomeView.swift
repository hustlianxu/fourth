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
    /// 多选模式：批量保存到相册 / 批量移入回收站
    @State private var selectionMode = false
    @State private var selectedRecordIDs: Set<String> = []
    @State private var toastMessage: String?
    /// 批量移入回收站确认
    @State private var showBatchTrashConfirm = false

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
            ToolbarItem(placement: .navigationBarLeading) {
                if !storage.records.isEmpty {
                    Button(selectionMode ? "完成" : "选择") {
                        selectionMode.toggle()
                        selectedRecordIDs = []
                    }
                }
            }
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                if !selectionMode {
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
        }
        .overlay(alignment: .bottom) {
            if selectionMode {
                batchToolbar
            } else {
                cameraButton
            }
        }
        .alert("提示", isPresented: .constant(!toastMessage.isNilOrEmpty)) {
            Button("好") { toastMessage = nil }
        } message: {
            Text(toastMessage ?? "")
        }
        .confirmationDialog("将选中的 \(selectedRecordIDs.count) 张照片移入回收站？",
                            isPresented: $showBatchTrashConfirm,
                            titleVisibility: .visible) {
            Button("移入回收站", role: .destructive) {
                withAnimation {
                    storage.batchMoveToTrash(selectedRecordIDs)
                    selectedRecordIDs = []
                }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("移入回收站后仍占用空间，可在设置 → 回收站中彻底删除")
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
                        recordRow(rec)
                    }
                }
            }

            // 空文件夹也显示：否则创建后看不见，也无法删除
            ForEach(storage.folders) { folder in
                let items = storage.records(inFolder: folder.id)
                groupSection(title: folder.name, key: folder.id, count: items.count,
                             showDelete: true) {
                    ForEach(items) { rec in
                        recordRow(rec)
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

    /// 单条记录行：多选模式下点击切换选中，否则进入详情
    private func recordRow(_ rec: Record) -> some View {
        RecordRowView(record: rec,
                      onMove: { id in
                          moveRecordID = id
                      },
                      selectionMode: selectionMode,
                      isSelected: selectedRecordIDs.contains(rec.id),
                      onToggleSelect: {
                          if selectedRecordIDs.contains(rec.id) {
                              selectedRecordIDs.remove(rec.id)
                          } else {
                              selectedRecordIDs.insert(rec.id)
                          }
                      })
            .environmentObject(storage)
    }

    /// 可折叠分组：点标题区切换折叠；文件夹分组尾部「…」按钮触发删除
    /// （不用 contextMenu：header 整体是 Button 时长按手势会被按压吞掉；
    ///   swipeActions 也只对列表行生效、对 Section header 无效）
    private func groupSection<Content: View>(title: String, key: String, count: Int,
                                             showDelete: Bool,
                                             @ViewBuilder content: () -> Content) -> some View {
        let collapsed = collapsedGroups.contains(key)
        return Section {
            if !collapsed {
                content()
            }
        } header: {
            HStack(spacing: 0) {
                // 标题区：点击折叠/展开
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
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(.secondary)
                    .contentShape(Rectangle())
                    .padding(.vertical, 2)
                }
                .buttonStyle(.plain)

                // 文件夹分组：显式「…」删除入口（点按即触发，不依赖长按）
                if showDelete {
                    Button {
                        deleteFolderID = key
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.secondary)
                            .frame(width: 34, height: 28)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("删除文件夹 \(title)")
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

    // MARK: - 多选批量操作

    /// 多选模式底部批量操作条：全选 / 已选数量 / 批量存相册 / 批量移入回收站
    private var batchToolbar: some View {
        let allIDs = Set(storage.records.map(\.id))
        let allSelected = !selectedRecordIDs.isEmpty && selectedRecordIDs == allIDs
        return HStack(spacing: 10) {
            Button {
                selectedRecordIDs = allSelected ? [] : allIDs
            } label: {
                Text(allSelected ? "取消全选" : "全选")
                    .font(.subheadline.weight(.medium))
            }
            .disabled(storage.records.isEmpty)

            Spacer()

            Text("已选 \(selectedRecordIDs.count) 张")
                .font(.caption)
                .foregroundColor(.secondary)

            Button {
                batchSaveToAlbum()
            } label: {
                Label("存入相册", systemImage: "square.and.arrow.down")
                    .font(.subheadline.weight(.medium))
            }
            .disabled(selectedRecordIDs.isEmpty)

            Button {
                showBatchTrashConfirm = true
            } label: {
                Label("移入回收站", systemImage: "trash")
                    .font(.subheadline.weight(.medium))
            }
            .tint(.red)
            .disabled(selectedRecordIDs.isEmpty)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    /// 批量保存选中记录的水印图到系统相册（首次会请求相册写入权限）
    private func batchSaveToAlbum() {
        let recs = storage.records.filter { selectedRecordIDs.contains($0.id) }
        var saved = 0
        for rec in recs {
            if let img = storage.image(for: rec) {
                UIImageWriteToSavedPhotosAlbum(img, nil, nil, nil)
                saved += 1
            }
        }
        toastMessage = saved > 0
            ? "已提交 \(saved) 张到系统相册（首次保存需授权）"
            : "选中记录的图片不可读"
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
    /// 多选模式：点击行切换选中（不进详情）
    var selectionMode: Bool = false
    var isSelected: Bool = false
    var onToggleSelect: (() -> Void)? = nil

    var body: some View {
        // 多选：整行可点切换；浏览：NavigationLink 进详情
        Group {
            if selectionMode {
                Button {
                    onToggleSelect?()
                } label: {
                    rowContent
                }
                .buttonStyle(.plain)
            } else {
                NavigationLink(value: record) {
                    rowContent
                }
            }
        }
        .swipeActions(edge: .trailing) {
            if !selectionMode {
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
        }
        .contextMenu {
            if !selectionMode {
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
    }

    private var rowContent: some View {
        HStack(spacing: 12) {
            if selectionMode {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundColor(isSelected ? .accentColor : .secondary)
            }
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
        .contentShape(Rectangle())
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