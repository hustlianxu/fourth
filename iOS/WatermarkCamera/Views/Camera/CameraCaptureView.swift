import SwiftUI
import AVFoundation

// MARK: - 相机拍照页（AVFoundation 预览 + 水印浮层 + 字段编辑）

struct CameraCaptureView: View {
    @EnvironmentObject var storage: StorageManager
    @Environment(\.dismiss) private var dismiss
    var folderId: String? = nil
    var onFinished: (() -> Void)? = nil

    @StateObject private var camera = CameraSession()
    @State private var template = BuiltinTemplates.template(withID: AppSettings.activeTemplateID) ?? BuiltinTemplates.handwrite
    @State private var values: [String: String] = [:]
    @State private var placement = OverlayPlacement()
    @State private var fitRect: CGRect = .zero
    @State private var showFields = false
    @State private var isCapturing = false
    @State private var isSaving = false
    @State private var showPhotoPicker = false
    @State private var pickedImage: UIImage?
    @State private var showEditSheet = false
    @State private var errorMessage: String?
    /// 闪光灯提示（拍照瞬间才生效，需显式告知用户）
    @State private var flashHint: String?

    /// 关闭相机页：调用方可能未传 onFinished（如 fullScreenCover 直接呈现），
    /// 必须用 dismiss 兜底，否则关闭按钮无响应
    private func closeCamera() {
        onFinished?()
        dismiss()
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color.black.ignoresSafeArea()

                // 相机预览
                CameraPreviewView(session: camera.session,
                                  videoAspect: camera.videoDimensions) { fit in
                    fitRect = fit
                }
                .onAppear { camera.start() }
                .onDisappear { camera.stop() }
                .ignoresSafeArea()

                // 水印浮层（限定在视频 aspect-fit 区域）
                if fitRect.width > 0 {
                    WatermarkOverlay(template: template,
                                     values: values,
                                     containerSize: fitRect.size,
                                     placement: $placement)
                        .frame(width: fitRect.width, height: fitRect.height)
                        .position(x: fitRect.midX, y: fitRect.midY)
                }

                // 顶部工具栏
                VStack {
                    HStack {
                        Button {
                            closeCamera()
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundColor(.white)
                                .padding(12)
                                .background(Circle().fill(Color.black.opacity(0.45)))
                        }
                        .accessibilityLabel("关闭")
                        Spacer()
                        Button {
                            camera.toggleFlash()
                            showFlashHint(camera.flashOn ? "闪光灯已开启（拍照瞬间生效）" : "闪光灯已关闭")
                        } label: {
                            Image(systemName: camera.flashOn ? "bolt.fill" : "bolt.slash")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundColor(.white)
                                .padding(12)
                                .background(Circle().fill(Color.black.opacity(0.45)))
                        }
                        .accessibilityLabel(camera.flashOn ? "关闭闪光灯" : "开启闪光灯")
                        Button {
                            camera.switchCamera()
                        } label: {
                            Image(systemName: "arrow.triangle.2.circlepath.camera")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundColor(.white)
                                .padding(12)
                                .background(Circle().fill(Color.black.opacity(0.45)))
                        }
                        .accessibilityLabel("切换摄像头")
                    }
                    .padding(.horizontal, 16)
                    Spacer()
                    // 闪光灯提示（拍照瞬间才生效，避免用户以为无效）
                    if let hint = flashHint {
                        Text(hint)
                            .font(.caption)
                            .foregroundColor(.white)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(Capsule().fill(Color.black.opacity(0.6)))
                            .transition(.opacity)
                            .padding(.top, 8)
                    }
                }
                .padding(.top, 4)

                // 底部控制区
                VStack(spacing: 0) {
                    // 字段面板（展开/收起均带柔和 spring + 位移+透明度组合过渡）
                    if showFields {
                        fieldsPanel
                            .transition(.asymmetric(
                                insertion: .move(edge: .bottom).combined(with: .opacity),
                                removal: .move(edge: .bottom).combined(with: .opacity)
                            ))
                    }

                    // 模板选择 + 提示
                    HStack {
                        templateMenu
                            .disabled(isSaving)
                        Spacer()
                        if placement.scale > 0 {
                            Text("拖动移动 · 双指缩放")
                                .font(.caption)
                                .foregroundColor(.white.opacity(0.9))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(Capsule().fill(Color.black.opacity(0.4)))
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 6)

                    HStack(spacing: 28) {
                        // 相册选图
                        Button {
                            showPhotoPicker = true
                        } label: {
                            VStack(spacing: 4) {
                                Image(systemName: "photo.on.rectangle")
                                    .font(.system(size: 24))
                                Text("相册")
                                    .font(.caption2)
                            }
                            .foregroundColor(.white)
                        }

                        // 快门
                        Button {
                            triggerCapture()
                        } label: {
                            ZStack {
                                Circle().strokeBorder(Color.white, lineWidth: 4)
                                    .frame(width: 74, height: 74)
                                Circle().fill(Color.white)
                                    .frame(width: 60, height: 60)
                                if isCapturing || isSaving {
                                    ProgressView()
                                        .tint(.black)
                                }
                            }
                        }
                        .disabled(isCapturing || isSaving)

                        // 展开字段（response/dampingFraction 让收起/展开都有回弹缓冲，不生硬）
                        Button {
                            withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) { showFields.toggle() }
                        } label: {
                            VStack(spacing: 4) {
                                Image(systemName: showFields ? "keyboard.chevron.compact.down" : "keyboard")
                                    .font(.system(size: 22))
                                Text("详情")
                                    .font(.caption2)
                            }
                            .foregroundColor(.white)
                        }
                    }
                    .padding(.horizontal, 30)
                    .padding(.bottom, 10)
                }
                .frame(maxHeight: .infinity, alignment: .bottom)
            }
        }
        .sheet(isPresented: $showPhotoPicker) {
            PhotoLibraryPicker { image in
                pickedImage = image
            }
            .ignoresSafeArea()
        }
        .onChange(of: pickedImage) { img in
            // loadObject 异步回调可能晚于 sheet onDismiss，必须用 onChange 驱动编辑页
            guard let img = img else { return }
            pickedImage = nil
            editSheetImage = img
            showEditSheet = true
        }
        .sheet(isPresented: $showEditSheet) {
            if let img = editSheetImage {
                PhotoEditorView(image: img) {
                    showEditSheet = false
                }
                .environmentObject(storage)
            }
        }
        .alert("提示", isPresented: .constant(errorMessage != nil)) {
            Button("好") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
        .onAppear {
            if values.isEmpty {
                values = BuiltinTemplates.defaultValues(for: template)
            }
        }
        .onChange(of: fitRect) { fit in
            // 预览尺寸首次就绪时，按模板预设位置初始化浮层（而非默认居中）
            guard !didInitPlacement, fit.width > 0, fit.height > 0 else { return }
            didInitPlacement = true
            placement = OverlayMapper.defaultPlacement(for: template, canvasPoints: fit.size)
        }
        .overlay {
            if camera.isAuthorized == false {
                VStack(spacing: 12) {
                    Image(systemName: "camera.fill")
                        .font(.largeTitle)
                    Text("未获得相机权限")
                    Text("请前往 设置 → 隐私 → 相机 开启权限后重新进入")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Button("重新加载") { /* 由系统弹窗引导 */ }
                        .buttonStyle(.bordered)
                }
                .foregroundColor(.white)
            }
        }
    }

    // MARK: - 字段面板

    private var fieldsPanel: some View {
        ScrollView {
            TemplateFieldsEditor(template: template, values: $values, compact: true)
                .padding(16)
        }
        .frame(maxHeight: 240)
        .background(
            UnevenRoundedRectangle(cornerRadii: .init(topLeading: 18, topTrailing: 18))
                .fill(Color(.systemBackground).opacity(0.96))
                .ignoresSafeArea(edges: .bottom)
        )
    }

    // MARK: - 模板菜单

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
            HStack(spacing: 6) {
                Text(template.name)
                    .font(.subheadline.weight(.medium))
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2)
            }
            .foregroundColor(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Capsule().fill(Color.black.opacity(0.4)))
        }
    }

    private func switchTemplate(_ tpl: WatermarkTemplate) {
        template = tpl
        values = BuiltinTemplates.defaultValues(for: tpl)
        placement = OverlayMapper.defaultPlacement(for: tpl, canvasPoints: fitRect.size)
        AppSettings.activeTemplateID = tpl.id
    }

    // MARK: - 拍照

    /// 闪光灯状态提示：1.6 秒后自动消失
    private func showFlashHint(_ text: String) {
        withAnimation(.easeOut(duration: 0.15)) { flashHint = text }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { [self] in
            if flashHint == text {
                withAnimation(.easeIn(duration: 0.2)) { flashHint = nil }
            }
        }
    }

    private func triggerCapture() {
        guard !isCapturing, !isSaving else { return }
        isCapturing = true
        camera.capturePhoto { result in
            switch result {
            case .success(let image):
                Task { @MainActor in
                    isCapturing = false
                    isSaving = true
                    let canvas = CGSize(width: fitRect.width, height: fitRect.height)
                    _ = PhotoSaver.save(image: image,
                                        template: template,
                                        values: values,
                                        placement: placement,
                                        canvasPoints: canvas,
                                        folderId: folderId,
                                        storage: storage,
                                        autoSaveAlbum: AppSettings.autoSaveAlbum)
                    isSaving = false
                    closeCamera()
                }
            case .failure(let error):
                Task { @MainActor in
                    isCapturing = false
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    // MARK: - 相册选图编辑

    @State private var editSheetImage: UIImage?
    @State private var didInitPlacement = false
}