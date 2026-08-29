import SwiftUI

// MARK: - 水印浮层放置状态（拖动 + 缩放）

struct OverlayPlacement: Codable, Hashable {
    /// 归一化中心偏移：屏幕中心为 (0,0)，数值为相对容器宽/高的比例
    var dx: CGFloat = 0
    var dy: CGFloat = 0
    /// 缩放系数（相对模板原始尺寸）
    var scale: CGFloat = 1

    init(dx: CGFloat = 0, dy: CGFloat = 0, scale: CGFloat = 1) {
        self.dx = dx
        self.dy = dy
        self.scale = scale
    }
}

// MARK: - 可拖动 / 可缩放的水印浮层
//
// 浮层内渲染的是「透明背景水印块」图片；拖动与缩放手势更新 placement，
// 最终由 OverlayMapper 换算成 WatermarkRenderer.render 所需的像素坐标。

struct WatermarkOverlay: View {
    let template: WatermarkTemplate
    let values: [String: String]
    let containerSize: CGSize
    @Binding var placement: OverlayPlacement
    /// true 时不响应手势（纯展示，如相册缩略预览）
    var interactive: Bool = true
    /// 点按水印块的回调（编辑器中用于直接在图片上编辑水印内容）
    var onTap: (() -> Void)? = nil

    @GestureState private var dragOffset: CGSize = .zero
    @GestureState private var pinchScale: CGFloat = 1

    private var blockSizePts: CGSize? {
        WatermarkRenderer.blockSize(template: template, values: values,
                                    canvasWidth: containerSize.width, scale: placement.scale)
    }

    var body: some View {
        let size = blockSizePts ?? CGSize(width: containerSize.width * template.widthRatio,
                                          height: 80)
        let centerX = containerSize.width / 2 + (placement.dx + (dragOffset.width / max(containerSize.width, 1))) * containerSize.width
        let centerY = containerSize.height / 2 + (placement.dy + (dragOffset.height / max(containerSize.height, 1))) * containerSize.height

        ZStack(alignment: .topLeading) {
            if let img = WatermarkRenderer.blockPreview(template: template, values: values,
                                                        canvasWidth: containerSize.width,
                                                        scale: placement.scale * pinchScale,
                                                        opacity: nil) {
                Image(uiImage: img)
                    .resizable()
                    .interpolation(.high)
                    .frame(width: size.width, height: size.height)
                    .position(x: centerX, y: centerY)
                    .shadow(color: .black.opacity(0.25), radius: 3, x: 0, y: 1)
                    .overlay(
                        RoundedRectangle(cornerRadius: 4)
                            .strokeBorder(Color.white.opacity(0.55), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                            .frame(width: size.width, height: size.height)
                            .position(x: centerX, y: centerY)
                    )
                    .onTapGesture { onTap?() }
            }
        }
        .contentShape(Rectangle())
        .gesture(interactive ? dragGesture : nil)
        .simultaneousGesture(interactive ? magnifyGesture : nil)
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 8)
            .updating($dragOffset) { value, state, _ in
                state = value.translation
            }
            .onEnded { value in
                let w = max(containerSize.width, 1)
                let h = max(containerSize.height, 1)
                let blockW = blockSizePts?.width ?? (containerSize.width * template.widthRatio)
                let blockH = blockSizePts?.height ?? 80
                // 限制块不超出容器
                var ndx = placement.dx + value.translation.width / w
                var ndy = placement.dy + value.translation.height / h
                let maxDx = max(0.12, 0.5 - blockW / (2 * w))
                let maxDy = max(0.12, 0.5 - blockH / (2 * h))
                ndx = min(max(ndx, -maxDx), maxDx)
                ndy = min(max(ndy, -maxDy), maxDy)
                placement.dx = ndx
                placement.dy = ndy
            }
    }

    private var magnifyGesture: some Gesture {
        MagnificationGesture()
            .updating($pinchScale) { value, state, _ in
                state = value
            }
            .onEnded { value in
                let newScale = min(max(placement.scale * value, 0.4), 3.0)
                placement.scale = newScale
            }
    }
}

// MARK: - 浮层坐标 → 渲染参数换算

enum OverlayMapper {
    /// 把浮层放置换算为最终渲染所需的 (customX, customY, customScale)
    /// - Parameters:
    ///   - canvasPoints: 预览画布显示尺寸（pts，即图像显示区域）
    ///   - imagePixels:  最终图片像素尺寸
    ///   - pointsToPixels: 画布(pts) 到图片(px) 的横向/纵向缩放
    static func renderParams(template: WatermarkTemplate,
                             values: [String: String],
                             placement: OverlayPlacement,
                             canvasPoints: CGSize,
                             imagePixels: CGSize) -> (customX: CGFloat, customY: CGFloat, scale: CGFloat)? {
        guard let size = WatermarkRenderer.blockSize(template: template, values: values,
                                                     canvasWidth: canvasPoints.width,
                                                     scale: placement.scale),
              canvasPoints.width > 0, canvasPoints.height > 0 else { return nil }
        let sx = imagePixels.width / canvasPoints.width
        let sy = imagePixels.height / canvasPoints.height
        let centerX = canvasPoints.width / 2 + placement.dx * canvasPoints.width
        let centerY = canvasPoints.height / 2 + placement.dy * canvasPoints.height
        let customX = (centerX - size.width / 2) * sx
        let customY = (centerY - size.height / 2) * sy
        return (customX, customY, placement.scale)
    }

    /// 依据模板预设位置计算初始放置（bottom-center / top-left ... 等 9 宫格）
    static func defaultPlacement(for template: WatermarkTemplate,
                                 canvasPoints: CGSize) -> OverlayPlacement {
        let blockW = canvasPoints.width * CGFloat(template.widthRatio)
        let blockH = WatermarkRenderer.estimateBlockHeight(template: template,
                                                           values: [:],
                                                           canvasWidth: canvasPoints.width) ?? 80
        let marginFraction: CGFloat = 0.04
        var dx: CGFloat = 0
        var dy: CGFloat = 0
        let pos = template.position

        if pos.contains("left") {
            dx = -(0.5 - blockW / (2 * canvasPoints.width) - marginFraction)
        } else if pos.contains("right") {
            dx = 0.5 - blockW / (2 * canvasPoints.width) - marginFraction
        } else {
            dx = 0
        }

        // dy 向下为正：top 取负、bottom 取正
        if pos.contains("top") {
            dy = -(0.5 - blockH / (2 * canvasPoints.height) - marginFraction)
        } else if pos.contains("bottom") {
            dy = 0.5 - blockH / (2 * canvasPoints.height) - marginFraction
        } else {
            dy = 0
        }

        return OverlayPlacement(dx: dx, dy: dy, scale: 1)
    }
}