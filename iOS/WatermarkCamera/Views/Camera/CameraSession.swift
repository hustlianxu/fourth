import AVFoundation
import UIKit
import SwiftUI

// MARK: - 相机会话管理（AVFoundation）

final class CameraSession: NSObject, ObservableObject {
    @Published var isAuthorized = false
    @Published var isRunning = false
    @Published var flashOn = false
    @Published var usingFrontCamera = false

    let session = AVCaptureSession()
    private let photoOutput = AVCapturePhotoOutput()
    private let sessionQueue = DispatchQueue(label: "com.watermark.camera.session")
    private var videoInput: AVCaptureDeviceInput?
    private var captureCompletion: ((Result<UIImage, Error>) -> Void)?

    /// 当前输入视频尺寸（用于预览区 aspect 换算）
    @Published private(set) var videoDimensions = CGSize(width: 1080, height: 1440)

    override init() {
        super.init()
        checkAuthorization()
    }

    private func checkAuthorization() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            DispatchQueue.main.async { self.isAuthorized = true }
            sessionQueue.async { [weak self] in self?.configureSession() }
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async { self?.isAuthorized = granted }
                if granted {
                    self?.sessionQueue.async { self?.configureSession() }
                }
            }
        default:
            DispatchQueue.main.async { self.isAuthorized = false }
        }
    }

    private func configureSession() {
        session.beginConfiguration()
        session.sessionPreset = .photo

        if let input = makeInput(devicePosition: .back) {
            videoInput = input
            session.addInput(input)
        }
        if session.canAddOutput(photoOutput) {
            photoOutput.maxPhotoQualityPrioritization = .quality
            session.addOutput(photoOutput)
        }
        if let input = videoInput {
            updateConnectionOrientation(input: input)
        }
        updateVideoDimensions()
        session.commitConfiguration()
    }

    private func makeInput(devicePosition: AVCaptureDevice.Position) -> AVCaptureDeviceInput? {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: devicePosition)
                ?? AVCaptureDevice.default(for: .video) else { return nil }
        return try? AVCaptureDeviceInput(device: device)
    }

    private func updateVideoDimensions() {
        guard let device = videoInput?.device,
              let desc = device.activeFormat.formatDescription else { return }
        let dims = CMVideoFormatDescriptionGetDimensions(desc)

        // 连接锁定为 portrait：传感器 format 为横向尺寸，需交换宽高得到竖屏显示宽高比，
        // 否则预览 aspect-fit 区域与实际竖版照片不匹配，水印位置会偏移
        // videoDimensions = CGSize(width: CGFloat(dims.height), height: CGFloat(dims.width))
        let size = CGSize(width: CGFloat(dims.width), height: CGFloat(dims.height))
        // @Published 必须在主线程更新（本方法在 sessionQueue 被调用）
        DispatchQueue.main.async { self.videoDimensions = size }
    }

    func start() {
        guard isAuthorized else { return }
        sessionQueue.async { [weak self] in
            guard let self = self, !self.session.isRunning else { return }
            self.session.startRunning()
            DispatchQueue.main.async { self.isRunning = true }
        }
    }

    func stop() {
        sessionQueue.async { [weak self] in
            guard let self = self, self.session.isRunning else { return }
            self.session.stopRunning()
            DispatchQueue.main.async { self.isRunning = false }
        }
    }

    func toggleFlash() -> Bool {
        flashOn.toggle()
        return flashOn
    }

    /// 切换前后摄像头
    func switchCamera() {
        sessionQueue.async { [weak self] in
            guard let self = self, let current = self.videoInput else { return }
            let newPosition: AVCaptureDevice.Position = current.device.position == .back ? .front : .back
            guard let input = self.makeInput(devicePosition: newPosition) else { return }
            self.session.beginConfiguration()
            self.session.removeInput(current)
            if self.session.canAddInput(input) {
                self.session.addInput(input)
                self.videoInput = input
            } else {
                self.session.addInput(current)
                self.videoInput = current
            }
            self.updateConnectionOrientation(input: self.videoInput!)
            self.updateVideoDimensions()
            self.session.commitConfiguration()
            DispatchQueue.main.async {
                self.usingFrontCamera = (newPosition == .front)
            }
        }
    }

    private func updateConnectionOrientation(input: AVCaptureDeviceInput) {
        for conn in session.outputs.flatMap({ $0.connections })
        where conn.inputPorts.contains(where: { $0.input == input }) {
            conn.videoOrientation = .portrait
            if input.device.position == .front {
                conn.automaticallyAdjustsVideoMirroring = false
                conn.isVideoMirrored = true
            } else {
                conn.automaticallyAdjustsVideoMirroring = true
            }
        }
    }

    // MARK: - 拍照

    func capturePhoto(completion: @escaping (Result<UIImage, Error>) -> Void) {
        guard isAuthorized else {
            completion(.failure(CameraError.notAuthorized))
            return
        }
        let settings = AVCapturePhotoSettings()
        settings.flashMode = flashOn ? .on : .off
        settings.photoQualityPrioritization = .quality
        captureCompletion = completion
        photoOutput.capturePhoto(with: settings, delegate: self)
    }
}

// MARK: - 拍照代理

extension CameraSession: AVCapturePhotoCaptureDelegate {
    func photoOutput(_ output: AVCapturePhotoOutput,
                     didFinishProcessingPhoto photo: AVCapturePhoto,
                     error: Error?) {
        let completion = captureCompletion
        captureCompletion = nil
        if let error = error {
            DispatchQueue.main.async { completion?(.failure(error)) }
            return
        }
        guard let data = photo.fileDataRepresentation(), let image = UIImage(data: data) else {
            DispatchQueue.main.async { completion?(.failure(CameraError.invalidPhotoData)) }
            return
        }
        DispatchQueue.main.async {
            let normalized = image.normalized()
            let result = self.usingFrontCamera ? normalized.mirrored() : normalized
            completion?(.success(result))
        }
    }
}

enum CameraError: LocalizedError {
    case notAuthorized
    case invalidPhotoData

    var errorDescription: String? {
        switch self {
        case .notAuthorized: return "未获得相机权限，请在系统设置中允许访问相机"
        case .invalidPhotoData: return "照片数据无效"
        }
    }
}

// MARK: - 相机预览视图（UIViewRepresentable）

struct CameraPreviewView: UIViewRepresentable {
    let session: AVCaptureSession
    /// 视频原始宽高比（用于计算 aspect-fit 区域）
    var videoAspect: CGSize
    /// 预览回调：最新的视频 aspect-fit 区域（容器坐标系）
    var onFitChange: ((CGRect) -> Void)?

    final class PreviewUIView: UIView {
        let layerRef = AVCaptureVideoPreviewLayer()
        var onChange: (() -> Void)?
        /// 当前视频宽高比（切换摄像头后由 updateUIView 刷新）
        var videoAspect: CGSize = CGSize(width: 4, height: 3) {
            didSet { recomputeFit() }
        }

        override init(frame: CGRect) {
            super.init(frame: frame)
            layerRef.videoGravity = .resizeAspect
            layer.addSublayer(layerRef)
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

        override func layoutSubviews() {
            super.layoutSubviews()
            layerRef.frame = bounds
            recomputeFit()
        }

        private func recomputeFit() {
            guard bounds.width > 0, bounds.height > 0 else { return }
            let aspect = videoAspect.width > 0 && videoAspect.height > 0 ? videoAspect : CGSize(width: 4, height: 3)
            onChange?(AVMakeRect(aspectRatio: aspect, insideRect: bounds))
        }
    }

    func makeUIView(context: Context) -> PreviewUIView {
        let view = PreviewUIView()
        view.layerRef.session = session
        view.videoAspect = videoAspect
        view.onChange = { [weak view] fit in
            onFitChange?(fit)
        }
        return view
    }

    func updateUIView(_ uiView: PreviewUIView, context: Context) {
        // videoDimensions 变化（如切换前后摄）时刷新 aspect-fit 区域
        if uiView.videoAspect != videoAspect {
            uiView.videoAspect = videoAspect
        }
    }
}