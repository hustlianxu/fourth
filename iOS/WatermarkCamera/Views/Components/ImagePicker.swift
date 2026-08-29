import SwiftUI
import PhotosUI

// MARK: - 系统相册选择器（PHPicker，无需授权即可选择图片）

struct PhotoLibraryPicker: UIViewControllerRepresentable {
    /// 原图回调（已统一为正向方向）
    let onPicked: (UIImage) -> Void

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var config = PHPickerConfiguration()
        config.filter = .images
        config.selectionLimit = 1
        let vc = PHPickerViewController(configuration: config)
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ uiViewController: PHPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        private let parent: PhotoLibraryPicker

        init(_ parent: PhotoLibraryPicker) { self.parent = parent }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            picker.dismiss(animated: true)
            guard let result = results.first,
                  result.itemProvider.canLoadObject(ofClass: UIImage.self) else { return }
            result.itemProvider.loadObject(ofClass: UIImage.self) { [weak self] object, _ in
                DispatchQueue.main.async {
                    guard let self = self, let image = object as? UIImage else { return }
                    self.parent.onPicked(image.normalized())
                }
            }
        }
    }
}

extension UIImage {
    /// 统一方向：消除 EXIF 旋转，返回正向位图
    func normalized(maxPixel: CGFloat = 4096) -> UIImage {
        var w = size.width
        var h = size.height
        let long = max(w, h)
        if long > maxPixel {
            let s = maxPixel / long
            w = (w * s).rounded()
            h = (h * s).rounded()
        }
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 1
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: w, height: h), format: fmt)
        return renderer.image { ctx in
            // 先按 EXIF 方向绘制为正向位图
            draw(in: CGRect(x: 0, y: 0, width: w, height: h))
            _ = ctx
        }
    }

    /// 水平镜像（前置摄像头自拍方向修正）
    func mirrored() -> UIImage {
        let size = CGSize(width: self.size.width, height: self.size.height)
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 1
        let renderer = UIGraphicsImageRenderer(size: size, format: fmt)
        return renderer.image { ctx in
            ctx.cgContext.translateBy(x: size.width, y: 0)
            ctx.cgContext.scaleBy(x: -1, y: 1)
            draw(in: CGRect(origin: .zero, size: size))
        }
    }
}