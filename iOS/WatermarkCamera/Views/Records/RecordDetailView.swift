import SwiftUI

// MARK: - 记录明细视图（查看大图 / 编辑字段 / 重新编辑水印 / 删除）
//
// 交互模型：
//   - 默认只读（防止误编辑）：字段仅展示
//   - 点「编辑详情」进入编辑态：大图切到「原图 + 实时水印浮层」，
//     字段修改立即反映到图片上的水印（实时渲染，保存时落盘）
//   - 「重新编辑水印」打开 PhotoEditorView，在图片上直接调整位置/大小/内容

struct RecordDetailView: View {
    @EnvironmentObject var storage: StorageManager
    let record: Record

    @State private var values: [String: String]
    @State private var template: WatermarkTemplate
    /// 默认只读；点「编辑详情」后可编辑（防误触）
    @State private var isEditing = false
    /// 实时预览：编辑态加载的干净原图（原图缺失时用水印成品图，浮层不再叠加）
    @State private var previewBase: UIImage?
    /// 实时预览水印位置（记录里存的位置；旧记录按模板预设）
    @State private var previewPlacement: OverlayPlacement?
    @State private var editBase: EditBaseImage?
    /// 正在后台预解码大图（避免弹出白屏 / 按钮看似无响应）
    @State private var isLoadingEditBase = false
    @State private var toastMessage: String?
    @State private var showTrashConfirm = false

    init(record: Record) {
        self.record = record
        // 模板优先取记录里存的水印模板（保证详情编辑/重渲染与拍摄时一致），
        // 其次当前激活模板
        let tpl = BuiltinTemplates.template(withID: record.wmTemplateID ?? AppSettings.activeTemplateID)
            ?? BuiltinTemplates.handwrite
        _template = State(initialValue: tpl)
        _values = State(initialValue: record.values)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                imageSection

                // 快捷操作
                HStack(spacing: 12) {
                    Button {
                        loadOriginalForEdit()
                    } label: {
                        HStack(spacing: 6) {
                            if isLoadingEditBase {
                                ProgressView()
                                    .controlSize(.small)
                            }
                            Label("重新编辑水印", systemImage: "wand.and.stars")
                        }
                        .font(.subheadline)
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(.blue)
                    .disabled(isLoadingEditBase)

                    Button {
                        showTrashConfirm = true
                    } label: {
                        Label("删除", systemImage: "trash")
                            .font(.subheadline)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(.red)
                }
                .padding(.horizontal, 16)

                // 字段区（编辑态可改 + 实时渲染；只读态纯展示）
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(isEditing ? "详情编辑（实时预览）" : "详情")
                            .font(.headline)
                        Spacer()
                        if isEditing {
                            Button("取消") {
                                values = record.values
                                isEditing = false
                            }
                            .font(.subheadline)
                        } else {
                            Button {
                                startEditing()
                            } label: {
                                Label("编辑", systemImage: "pencil")
                                    .font(.subheadline)
                            }
                        }
                    }

                    if isEditing {
                        TemplateFieldsEditor(template: template, values: $values)
                            .padding(16)
                            .background(RoundedRectangle(cornerRadius: 12).fill(Color(.secondarySystemGroupedBackground)))
                    } else {
                        readOnlyFields
                            .padding(16)
                            .background(RoundedRectangle(cornerRadius: 12).fill(Color(.secondarySystemGroupedBackground)))
                    }
                }
                .padding(.horizontal, 16)

                // 元信息
                VStack(alignment: .leading, spacing: 6) {
                    Text("元信息").font(.headline)
                    LabeledContent("创建时间", value: formatDateTime(Date(timeIntervalSince1970: record.createdAt)))
                    LabeledContent("更新时间", value: formatDateTime(Date(timeIntervalSince1970: record.updatedAt)))
                    LabeledContent("尺寸", value: "\(record.width) × \(record.height)")
                }
                .font(.footnote)
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color(.secondarySystemGroupedBackground)))
                .padding(.horizontal, 16)
            }
            .padding(.vertical, 16)
        }
        .navigationTitle(record.customName ?? "记录详情")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if isEditing {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("保存") { saveValues() }
                        .fontWeight(.semibold)
                }
            }
        }
        .sheet(item: $editBase) { base in
            PhotoEditorView(image: base.image,
                            folderId: record.folderId,
                            recordID: record.id,
                            initialValues: record.values,
                            initialTemplateID: record.wmTemplateID,
                            initialPlacement: record.wmPlacement) {
                editBase = nil
            }
            .environmentObject(storage)
        }
        .alert("提示", isPresented: .constant(!toastMessage.isNilOrEmpty)) {
            Button("好") { toastMessage = nil }
        } message: {
            Text(toastMessage ?? "")
        }
        .confirmationDialog("确认删除这条记录？照片会进入回收站", isPresented: $showTrashConfirm, titleVisibility: .visible) {
            Button("移入回收站", role: .destructive) {
                storage.moveToTrash(record.id)
            }
        }
        .onAppear { loadPreviewBaseIfNeeded() }
    }

    // MARK: - 图片区

    /// 编辑态：原图 + 非交互水印浮层（values 变化即实时重绘）；
    /// 查看态：带水印成品图
    @ViewBuilder
    private var imageSection: some View {
        Group {
            if isEditing, let base = previewBase {
                Image(uiImage: base)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .frame(maxWidth: .infinity)
                    .overlay {
                        // 浮层限定在图片显示区域内，位置沿用记录里存的水印放置
                        GeometryReader { geo in
                            if let p = previewPlacement {
                                WatermarkOverlay(template: template,
                                                 values: values,
                                                 containerSize: geo.size,
                                                 placement: .constant(p),
                                                 interactive: false)
                            }
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .padding(.horizontal, 16)
            } else if let image = storage.image(for: record) {
                Image(uiImage: image)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .padding(.horizontal, 16)
                    .contextMenu {
                        Button("保存到相册") { saveToAlbum(image) }
                    }
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "photo")
                        .font(.system(size: 40))
                        .foregroundColor(.secondary)
                    Text("图片缺失")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .frame(height: 200)
            }
        }
    }

    /// 只读字段展示
    private var readOnlyFields: some View {
        VStack(alignment: .leading, spacing: 10) {
            let filled = template.fields.filter { !($0.label.isEmpty) }
            if filled.isEmpty {
                Text("暂无字段")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            ForEach(filled) { field in
                LabeledContent(field.label) {
                    Text(values[field.key] ?? "—")
                        .multilineTextAlignment(.trailing)
                        .foregroundStyle(.secondary)
                }
                .font(.subheadline)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - 编辑流程

    private func startEditing() {
        loadPreviewBaseIfNeeded()
        isEditing = true
    }

    /// 加载实时预览基础图（优先干净原图；原图缺失用水印成品图）
    private func loadPreviewBaseIfNeeded() {
        guard previewBase == nil else { return }
        if let rel = record.originalPath, let url = storage.url(forRelativePath: rel),
           let img = UIImage(contentsOfFile: url.path) {
            previewBase = img
            previewPlacement = record.wmPlacement
                ?? OverlayMapper.defaultPlacement(for: template, canvasPoints: img.size)
        } else if let img = storage.image(for: record) {
            // 无原图：预览直接显示成品图（叠加浮层会水印叠水印）
            previewBase = nil
            previewPlacement = nil
        }
    }

    private func saveValues() {
        guard var r = storage.record(withID: record.id) else { return }
        r.values = values
        r.updatedAt = Date().timeIntervalSince1970
        // 按原水印位置/模板重渲染图片（详情编辑与「重新编辑水印」行为一致）
        if PhotoSaver.rerenderValues(recordID: record.id, values: values, storage: storage) {
            toastMessage = "已保存修改并更新水印图片"
            isEditing = false
        } else {
            // 无原图可重绘（如旧记录缺 orig）：仅保存字段
            storage.updateRecord(r)
            toastMessage = "已保存修改（原图缺失，图片未重绘）"
            isEditing = false
        }
    }

    private func saveToAlbum(_ image: UIImage) {
        UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
        toastMessage = "已保存到系统相册"
    }

    // MARK: - 重新编辑水印（sheet(item:) 避免首帧白屏）

    private func loadOriginalForEdit() {
        guard !isLoadingEditBase else { return }
        isLoadingEditBase = true
        // 优先干净原图，缺失则用水印图；后台解码完成后再弹出
        let origURL = record.originalPath.flatMap { storage.url(forRelativePath: $0) }
        let wmURL = storage.url(forRelativePath: record.imagePath)
        Task.detached(priority: .userInitiated) {
            let img: UIImage? = (origURL.flatMap { UIImage(contentsOfFile: $0.path) })
                ?? (wmURL.flatMap { UIImage(contentsOfFile: $0.path) })
            // 预解码：避免 sheet 弹出首帧因 12MP 解码卡白屏
            let decoded = img.flatMap { Self.preDecoded($0) }
            await MainActor.run {
                isLoadingEditBase = false
                if let decoded = decoded {
                    editBase = EditBaseImage(id: record.id, image: decoded)
                } else {
                    toastMessage = "图片加载失败"
                }
            }
        }
    }

    /// 强制解码位图，避免 Image 首次渲染时才解码造成白屏
    private static func preDecoded(_ image: UIImage) -> UIImage {
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 1
        return UIGraphicsImageRenderer(size: image.size, format: fmt).image { _ in
            image.draw(at: .zero)
        }
    }
}

/// sheet(item:) 载荷：item 非空才会弹出，规避 isPresented 模式下
/// 首次点击时内容闭包拿到 nil 导致的白屏
struct EditBaseImage: Identifiable {
    let id: String
    let image: UIImage
}

extension Optional where Wrapped == String {
    var isNilOrEmpty: Bool {
        switch self {
        case .some(let v): return v.isEmpty
        case .none: return true
        }
    }
}
