import SwiftUI

// MARK: - 记录明细视图（查看大图 / 编辑字段 / 重新编辑水印 / 删除）

struct RecordDetailView: View {
    @EnvironmentObject var storage: StorageManager
    let record: Record

    @State private var values: [String: String]
    @State private var template: WatermarkTemplate
    @State private var showEditWatermark = false
    @State private var editBaseImage: UIImage?
    @State private var toastMessage: String?
    @State private var showTrashConfirm = false

    init(record: Record) {
        self.record = record
        let tpl = BuiltinTemplates.template(withID: AppSettings.activeTemplateID) ?? BuiltinTemplates.handwrite
        _template = State(initialValue: tpl)
        _values = State(initialValue: record.values)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                // 大图
                if let image = storage.image(for: record) {
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

                // 快捷操作
                HStack(spacing: 12) {
                    Button {
                        loadOriginalForEdit()
                    } label: {
                        Label("重新编辑水印", systemImage: "wand.and.stars")
                            .font(.subheadline)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(.blue)

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

                // 字段编辑
                VStack(alignment: .leading, spacing: 6) {
                    Text("详情编辑")
                        .font(.headline)
                    TemplateFieldsEditor(template: template, values: $values)
                        .padding(16)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Color(.secondarySystemGroupedBackground)))
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
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("保存") { saveValues() }
                    .fontWeight(.semibold)
            }
        }
        .sheet(isPresented: $showEditWatermark) {
            if let base = editBaseImage {
                PhotoEditorView(image: base,
                                folderId: record.folderId,
                                recordID: record.id,
                                initialValues: values) {
                    showEditWatermark = false
                }
                .environmentObject(storage)
            }
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
    }

    private func saveValues() {
        guard var r = storage.record(withID: record.id) else { return }
        r.values = values
        r.updatedAt = Date().timeIntervalSince1970
        storage.updateRecord(r)
        toastMessage = "已保存修改"
    }

    private func saveToAlbum(_ image: UIImage) {
        UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
        toastMessage = "已保存到系统相册"
    }

    private func moveToTrash() {
        storage.moveToTrash(record.id)
        toastMessage = "已移入回收站"
    }

    private func loadOriginalForEdit() {
        // 优先用干净原图，缺失则用水印图
        if let rel = record.originalPath, let url = storage.url(forRelativePath: rel),
           let img = UIImage(contentsOfFile: url.path) {
            editBaseImage = img
        } else if let img = storage.image(for: record) {
            editBaseImage = img
        }
        showEditWatermark = true
    }
}

extension Optional where Wrapped == String {
    var isNilOrEmpty: Bool {
        switch self {
        case .some(let v): return v.isEmpty
        case .none: return true
        }
    }
}