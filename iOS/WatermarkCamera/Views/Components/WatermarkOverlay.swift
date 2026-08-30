import SwiftUI

// MARK: - 水印浮层放置状态（拖动 + 缩放）

struct OverlayPlacement: Codable, Hashable {
    /// 归一化中心偏移：屏幕中心为 (0,0)，数值为相对容器宽/高的比例
    var dx: CGFloat = 0
    var dy: CGFloat = 0
    /// 等比缩放系数（双指缩放，字体与整块一起等比缩放）
    var scale: CGFloat = 1
    /// 水平方向独立缩放（左右边缘拖动：仅改变块宽，文字重排）
    var scaleX: CGFloat = 1
    /// 垂直方向独立缩放（上下边缘拖动：字号/行距变大变小）
    var scaleY: CGFloat = 1

    init(dx: CGFloat = 0, dy: CGFloat = 0, scale: CGFloat = 1,
         scaleX: CGFloat = 1, scaleY: CGFloat = 1) {
        self.dx = dx
        self.dy = dy
        self.scale = scale
        self.scaleX = scaleX
        self.scaleY = scaleY
    }

    // 兼容旧数据：新增字段缺失时取默认值（decodeIfPresent）
    enum CodingKeys: String, CodingKey {
        case dx, dy, scale, scaleX, scaleY
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        dx = try c.decodeIfPresent(CGFloat.self, forKey: .dx) ?? 0
        dy = try c.decodeIfPresent(CGFloat.self, forKey: .dy) ?? 0
        scale = try c.decodeIfPresent(CGFloat.self, forKey: .scale) ?? 1
        scaleX = try c.decodeIfPresent(CGFloat.self, forKey: .scaleX) ?? 1
        scaleY = try c.decodeIfPresent(CGFloat.self, forKey: .scaleY) ?? 1
    }
}

// MARK: - 可拖动 / 可缩放的水印浮层
//
// 交互模型：
//   - 单指在块内拖动 → 移动水印位置
//   - 双指 → 等比缩放（字体 + 块一起）
//   - 单指拖动左右边缘手柄 → 仅水平缩放（文字重排）
//   - 单指拖动上下边缘手柄 → 仅垂直缩放（字号/行距变化）
//   - 点按水印块 → onTap（编辑器中打开内容编辑）
//
// 浮层内渲染的是「透明背景水印块」图片；手势更新 placement，
// 最终由 OverlayMapper 换算成 WatermarkRenderer.render 所需的像素坐标。

struct WatermarkOverlay: View {
    let template: WatermarkTemplate
    let values: [String: String]
    let containerSize: CGSize
    @Binding var placement: OverlayPlacement
    /// true 时显示手势与边缘手柄（编辑场景）；false 纯展示（详情实时预览）
    var interactive: Bool = true
    /// 点按水印块的回调（编辑器中用于直接在图片上编辑水印内容）
    var onTap: (() -> Void)? = nil

    @GestureState private var dragOffset: CGSize = .zero
    @GestureState private var pinchScale: CGFloat = 1
    /// 边缘手柄拖动起始基准（手势开始时的 scale 与块尺寸）
    @State private var handleStart: (scaleX: CGFloat, scaleY: CGFloat, w: CGFloat, h: CGFloat)?

    private var blockSizePts: CGSize? {
        WatermarkRenderer.blockSize(template: template, values: values,
                                    canvasWidth: containerSize.width, scale: placement.scale,
                                    scaleX: placement.scaleX, scaleY: placement.scaleY)
    }

    var body: some View {
        // 双指捏合进行中：frame 尺寸必须与渲染尺寸同步用 effectiveScale，
        // 否则图片内容放大而 frame 不变，会出现裁剪/错位
        let effectiveScale = placement.scale * pinchScale
        let size = WatermarkRenderer.blockSize(template: template, values: values,
                                               canvasWidth: containerSize.width,
                                               scale: effectiveScale,
                                               scaleX: placement.scaleX,
                                               scaleY: placement.scaleY)
            ?? CGSize(width: containerSize.width * template.widthRatio, height: 80)
        let centerX = containerSize.width / 2 + (placement.dx + (dragOffset.width / max(containerSize.width, 1))) * containerSize.width
        let centerY = containerSize.height / 2 + (placement.dy + (dragOffset.height / max(containerSize.height, 1))) * containerSize.height

        ZStack(alignment: .topLeading) {
            if let img = WatermarkRenderer.blockPreview(template: template, values: values,
                                                        canvasWidth: containerSize.width,
                                                        scale: effectiveScale,
                                                        scaleX: placement.scaleX,
                                                        scaleY: placement.scaleY,
                                                        opacity: nil) {
                // 水印块本体：单指拖动移动、双指等比缩放、点按进入内容编辑
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
                    .contentShape(Rectangle().inset(by: -12))
                    .onTapGesture { onTap?() }
                    .gesture(interactive ? moveGesture : nil)
                    .simultaneousGesture(interactive ? magnifyGesture : nil)

                if interactive {
                    // 四个边缘手柄：左右 = 水平缩放，上下 = 垂直缩放
                    edgeHandle(.left, size: size, center: CGPoint(x: centerX, y: centerY))
                    edgeHandle(.right, size: size, center: CGPoint(x: centerX, y: centerY))
                    edgeHandle(.top, size: size, center: CGPoint(x: centerX, y: centerY))
                    edgeHandle(.bottom, size: size, center: CGPoint(x: centerX, y: centerY))
                }
            }
        }
    }

    private enum Edge { case left, right, top, bottom }

    /// 边缘中点手柄（圆点 + 拖动手势）
    private func edgeHandle(_ edge: Edge, size: CGSize, center: CGPoint) -> some View {
        let pos: CGPoint
        switch edge {
        case .left: pos = CGPoint(x: center.x - size.width / 2, y: center.y)
        case .right: pos = CGPoint(x: center.x + size.width / 2, y: center.y)
        case .top: pos = CGPoint(x: center.x, y: center.y - size.height / 2)
        case .bottom: pos = CGPoint(x: center.x, y: center.y + size.height / 2)
        }

        let icon: String
        switch edge {
        case .left, .right: icon = "chevron.left.and.right"
        case .top, .bottom: icon = "chevron.up.and.down"
        }

        return Circle()
            .fill(Color.white)
            .overlay(Circle().strokeBorder(Color.accentColor, lineWidth: 2))
            .frame(width: 24, height: 24)
            .overlay(
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(Color.accentColor)
            )
            .contentShape(Circle().inset(by: -10))
            .position(pos)
            .gesture(
                DragGesture(minimumDistance: 1)
                    .onChanged { v in
                        // 记录手势起点基准；按拖动量换算方向缩放
                        if handleStart == nil, let s = blockSizePts {
                            handleStart = (placement.scaleX, placement.scaleY,
                                           s.width, s.height)
                        }
                        guard let st = handleStart, st.w > 1, st.h > 1 else { return }
                        let clamped: (CGFloat) -> CGFloat = { min(max($0, 0.3), 4.0) }
                        switch edge {
                        case .left, .right:
                            // 左手柄向左拖 = 变宽；右手柄向右拖 = 变宽
                            let d = edge == .right ? v.translation.width : -v.translation.width
                            placement.scaleX = clamped(st.scaleX * (st.w + d) / st.w)
                        case .top, .bottom:
                            let d = edge == .bottom ? v.translation.height : -v.translation.height
                            placement.scaleY = clamped(st.scaleY * (st.h + d) / st.h)
                        }
                    }
                    .onEnded { _ in handleStart = nil }
            )
    }

    private var moveGesture: some Gesture {
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
    /// 把浮层放置换算为最终渲染所需的 (customX, customY, scale, scaleX, scaleY)
    /// - Parameters:
    ///   - canvasPoints: 预览画布显示尺寸（pts，即图像显示区域）
    ///   - imagePixels:  最终图片像素尺寸
    static func renderParams(template: WatermarkTemplate,
                             values: [String: String],
                             placement: OverlayPlacement,
                             canvasPoints: CGSize,
                             imagePixels: CGSize) -> (customX: CGFloat, customY: CGFloat,
                                                      scale: CGFloat, scaleX: CGFloat, scaleY: CGFloat)? {
        guard let size = WatermarkRenderer.blockSize(template: template, values: values,
                                                     canvasWidth: canvasPoints.width,
                                                     scale: placement.scale,
                                                     scaleX: placement.scaleX,
                                                     scaleY: placement.scaleY),
              canvasPoints.width > 0, canvasPoints.height > 0 else { return nil }
        let sx = imagePixels.width / canvasPoints.width
        let sy = imagePixels.height / canvasPoints.height
        let centerX = canvasPoints.width / 2 + placement.dx * canvasPoints.width
        let centerY = canvasPoints.height / 2 + placement.dy * canvasPoints.height
        let customX = (centerX - size.width / 2) * sx
        let customY = (centerY - size.height / 2) * sy
        return (customX, customY, placement.scale, placement.scaleX, placement.scaleY)
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
