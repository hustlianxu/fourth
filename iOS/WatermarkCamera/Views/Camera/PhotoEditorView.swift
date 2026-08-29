import SwiftUI

// MARK: - 图片水印编辑器（相册选图 / 已有记录重新编辑水印）
//
// 交互模型：
//   - 图片始终完整显示（aspect-fit 独占上方区域，不被任何面板遮挡）
//   - 拖动/双指缩放可直接调整图片上的水印
//   - 点按图片上的水印（或底部「内容」按钮）弹出覆盖在图片上的浮动编辑面板，
//     输入时水印实时重绘，即「直接在图片上修改水印」

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
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var didInitPlacement = false
    /// 覆盖在图片上的浮动编辑面板
    @State private var showOnImageEditor = false

    init(image: UIImage,
         folderId: String? = nil,
         recordID: String? = nil,
         initialValues: [String: String]? = nil,
         initialTemplateID: String? = nil,
         initialPlacement: OverlayPlacement? = nil,
         onFinish: (() -> Void)? = nil) {
        self.image = image
        self.folderId = folderId
        self.recordID = recordID
        self.onFinish = onFinish
        // 编辑已有记录：用记录里存的模板（保证与拍摄时一致）；新图：用激活模板
        let tpl = BuiltinTemplates.template(withID: initialTemplateID ?? AppSettings.activeTemplateID)
            ?? BuiltinTemplates.handwrite
        _template = State(initialValue: tpl)
        _values = State(initialValue: initialValues ?? BuiltinTemplates.defaultValues(for: tpl))
        if let p = initialPlacement {
            _placement = State(initialValue: p)
            _didInitPlacement = State(initialValue: true)
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // ===== 图片区域：独立占满剩余空间，图片始终完整可见 =====
                GeometryReader { geo in
                    ZStack {
                        Color(.systemGroupedBackground)

                        let fit = fitRect(in: geo.size)
                        if fit.size.width > 0 {
                            Image(uiImage: image)
                                .resizable()
                                .interpolation(.high)
                                .scaledToFit()
                                .frame(width: fit.size.width, height: fit.size.height)
                                .clipped()

                            // 点按图片空白处收起浮动编辑面板（置于水印层之下，不拦截水印点按）
                            Color.clear
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    if showOnImageEditor {
                                        withAnimation(.spring(duration: 0.25)) { showOnImageEditor = false }
                                    }
                                }

                            // 水印浮层：拖动移动、双指缩放、点按进入内容编辑
                            WatermarkOverlay(template: template,
                                             values: values,
                                             containerSize: fit.size,
                                             placement: $placement,
                                             onTap: { withAnimation(.spring(duration: 0.25)) { showOnImageEditor = true } })
                                .frame(width: fit.size.width, height: fit.size.height)
                                .position(x: fit.midX, y: fit.midY)
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

                // ===== 浮动编辑面板：紧贴图片下方（图片保持完整显示），输入实时重绘水印 =====
                if showOnImageEditor {
                    onImageEditor
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                // ===== 底部工具栏 =====
                HStack(spacing: 24) {
                    templateMenu
                        .frame(maxWidth: .infinity)

                    Button {
                        placement = OverlayMapper.defaultPlacement(for: template,
                                                                   canvasPoints: fitRect(in: containerSize).size)
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: "arrow.counterclockwise")
                                .font(.system(size: 22))
                            Text("归位")
                                .font(.caption2)
                        }
                        .frame(maxWidth: .infinity)
                    }

                    Button {
                        withAnimation(.spring(duration: 0.25)) { showOnImageEditor.toggle() }
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: showOnImageEditor ? "keyboard.chevron.compact.down" : "square.and.pencil")
                                .font(.system(size: 22))
                            Text("内容")
                                .font(.caption2)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .padding(.vertical, 10)
                .background(Color(.systemBackground))
            }
            .overlay(alignment: .top) {
                Text("拖动移动 · 双指缩放 · 点按水印编辑内容")
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

    // MARK: - 覆盖在图片上的浮动编辑面板

    /// 直接在图片上修改水印内容：点按图片上的水印弹出，输入实时反映到图片水印
    private var onImageEditor: some View {
        VStack(spacing: 0) {
            HStack {
                Text("水印内容")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Spacer()
                Button {
                    withAnimation(.spring(duration: 0.25)) { showOnImageEditor = false }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundColor(.secondary)
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 10)

            ScrollView {
                TemplateFieldsEditor(template: template, values: $values, compact: true)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
            }
            .frame(maxHeight: 200)
        }
        .background(
            UnevenRoundedRectangle(cornerRadii: .init(topLeading: 16, topTrailing: 16))
                .fill(Color(.systemBackground).opacity(0.96))
        )
    }

    // MARK: - 布局

    /// 预览尺寸首次就绪时，按模板预设位置初始化浮层（而非默认居中）
    private func initPlacementIfNeeded() {
        guard !didInitPlacement, containerSize.width > 0, containerSize.height > 0 else { return }
        didInitPlacement = true
        placement = OverlayMapper.defaultPlacement(for: template, canvasPoints: fitRect(in: containerSize).size)
    }

    /// 图片完整显示于给定区域内（aspect-fit 居中，无偏移、无遮挡）
    private func fitRect(in size: CGSize) -> CGRect {
        guard image.size.width > 0, image.size.height > 0, size.width > 0, size.height > 0 else { return .zero }
        let s = min(size.width / image.size.width, size.height / image.size.height)
        let w = image.size.width * s
        let h = image.size.height * s
        return CGRect(x: (size.width - w) / 2, y: (size.height - h) / 2, width: w, height: h)
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
