import SwiftUI

// MARK: - 图片水印编辑器（相册选图 / 已有记录重新编辑水印）

struct PhotoEditorView: View {
    @EnvironmentObject var storage: StorageManager
    /// 基础图（干净原图）；编辑已有记录时传入其原图
    let image: UIImage
    var folderId: String? = nil
    /// 编辑已有记录时的记录 id（nil 表示从相册新图新建）
    var recordID: String? = nil
    var onFinish: (() -> Void)? = nil

    @State private var template: WatermarkTemplate
    @State private var values: [String: String]
    @State private var placement = OverlayPlacement()
    @State private var containerSize: CGSize = .zero
    @State private var showFields = true
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var didInitPlacement = false

    init(image: UIImage,
         folderId: String? = nil,
         recordID: String? = nil,
         initialValues: [String: String]? = nil,
         onFinish: (() -> Void)? = nil) {
        self.image = image
        self.folderId = folderId
        self.recordID = recordID
        self.onFinish = onFinish
        let tpl = BuiltinTemplates.template(withID: AppSettings.activeTemplateID) ?? BuiltinTemplates.handwrite
        _template = State(initialValue: tpl)
        _values = State(initialValue: initialValues ?? BuiltinTemplates.defaultValues(for: tpl))
    }

    var body: some View {
        NavigationStack {
            GeometryReader { geo in
                ZStack {
                    Color(.systemGroupedBackground).ignoresSafeArea()

                    // 图片（aspect-fit）+ 水印浮层
                    let fit = fitRect(in: geo.size)
                    if fit.size.width > 0 {
                        Image(uiImage: image)
                            .resizable()
                            .interpolation(.high)
                            .scaledToFit()
                            .frame(width: fit.size.width, height: fit.size.height)
                            .clipped()

                        WatermarkOverlay(template: template,
                                         values: values,
                                         containerSize: fit.size,
                                         placement: $placement)
                            .frame(width: fit.size.width, height: fit.size.height)
                            .position(x: fit.midX, y: fit.midY)
                    }

                    // 底部字段面板
                    VStack {
                        Spacer()
                        VStack(spacing: 0) {
                            if showFields {
                                ScrollView {
                                    TemplateFieldsEditor(template: template, values: $values, compact: true)
                                        .padding(16)
                                }
                                .frame(maxHeight: 260)
                                .background(
                                    UnevenRoundedRectangle(cornerRadii: .init(topLeading: 18, topTrailing: 18))
                                        .fill(Color(.systemBackground))
                                )
                            }
                            HStack(spacing: 24) {
                                Button {
                                    withAnimation(.spring(duration: 0.3)) { showFields.toggle() }
                                } label: {
                                    VStack(spacing: 4) {
                                        Image(systemName: showFields ? "keyboard.chevron.compact.down" : "keyboard")
                                            .font(.system(size: 22))
                                        Text("详情")
                                            .font(.caption2)
                                    }
                                    .frame(maxWidth: .infinity)
                                }

                                templateMenu
                                    .frame(maxWidth: .infinity)

                                Button {
                                    placement = OverlayMapper.defaultPlacement(for: template, canvasPoints: fit.size)
                                } label: {
                                    VStack(spacing: 4) {
                                        Image(systemName: "arrow.counterclockwise")
                                            .font(.system(size: 22))
                                        Text("归位")
                                            .font(.caption2)
                                    }
                                    .frame(maxWidth: .infinity)
                                }
                            }
                            .padding(.vertical, 10)
                        }
                        .background(Color(.systemBackground))
                    }
                }
                .onAppear {
                    containerSize = geo.size
                    initPlacementIfNeeded()
                }
                .onChange(of: geo.size) { newSize in
                    containerSize = newSize
                    initPlacementIfNeeded()
                }
            }
            .overlay(alignment: .top) {
                Text("拖动移动 · 双指缩放水印")
                    .font(.caption)
                    .foregroundColor(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(Color.black.opacity(0.45)))
                    .padding(.top, 4)
            }
            .navigationTitle(recordID == nil ? "编辑水印" : "重新编辑")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { onFinish?() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") { save() }
                        .fontWeight(.semibold)
                        .disabled(isSaving)
                }
            }
            .alert("提示", isPresented: .constant(errorMessage != nil)) {
                Button("好") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    // MARK: - 布局

    /// 预览尺寸首次就绪时，按模板预设位置初始化浮层（而非默认居中）
    private func initPlacementIfNeeded() {
        guard !didInitPlacement, containerSize.width > 0, containerSize.height > 0 else { return }
        didInitPlacement = true
        placement = OverlayMapper.defaultPlacement(for: template, canvasPoints: fitRect(in: containerSize).size)
    }

    private func fitRect(in size: CGSize) -> CGRect {
        guard image.size.width > 0, image.size.height > 0, size.width > 0, size.height > 0 else { return .zero }
        let s = min(size.width / image.size.width, size.height / image.size.height)
        let w = image.size.width * s
        let h = image.size.height * s
        let rect = CGRect(x: (size.width - w) / 2, y: (size.height - h) / 2.4, width: w, height: h)
        return rect
    }

    private var templateMenu: some View {
        Menu {
            ForEach(BuiltinTemplates.all, id: \.id) { tpl in
                Button {
                    switchTemplate(tpl)
                } label: {
                    if tpl.id == template.id {
                        Label(tpl.name, systemImage: "checkmark")
                    } else {
                        Text(tpl.name)
                    }
                }
            }
            Divider()
            ForEach(storage.customTemplates, id: \.id) { tpl in
                Button {
                    switchTemplate(tpl)
                } label: {
                    Text(tpl.name)
                }
            }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: "doc.text.image")
                    .font(.system(size: 22))
                Text("模板")
                    .font(.caption2)
            }
        }
    }

    private func switchTemplate(_ tpl: WatermarkTemplate) {
        template = tpl
        values = BuiltinTemplates.defaultValues(for: tpl)
        placement = OverlayMapper.defaultPlacement(for: tpl, canvasPoints: fitRect(in: containerSize).size)
        AppSettings.activeTemplateID = tpl.id
    }

    // MARK: - 保存

    private func save() {
        guard !isSaving else { return }
        isSaving = true
        let canvas = fitRect(in: containerSize).size
        if let recordID = recordID {
            _ = PhotoSaver.update(recordID: recordID,
                                  image: image,
                                  template: template,
                                  values: values,
                                  placement: placement,
                                  canvasPoints: canvas,
                                  storage: storage,
                                  autoSaveAlbum: AppSettings.autoSaveEditAlbum)
        } else {
            _ = PhotoSaver.save(image: image,
                                template: template,
                                values: values,
                                placement: placement,
                                canvasPoints: canvas,
                                folderId: folderId,
                                storage: storage,
                                autoSaveAlbum: AppSettings.autoSaveAlbum)
        }
        isSaving = false
        onFinish?()
    }
}