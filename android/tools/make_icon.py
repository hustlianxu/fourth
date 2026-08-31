#!/usr/bin/env python3
# 生成 Android 自适应应用图标（与 iOS make_icon.py 同款视觉）：
# 暗色渐变取景器 + 白色相机 + 底部半透明水印块（黄/白文字条）
#
# 产出：
#   res/drawable/ic_launcher_background.xml        渐变背景（图层）
#   res/mipmap-anydpi-v26/ic_launcher.xml          自适应图标定义
#   res/mipmap-*/ic_launcher_foreground.png        前景图层（内容居安全区）
#   res/mipmap-*/ic_launcher.png                   兼容用整图（渐变烘焙）

import struct
import zlib
import os

# 设计坐标系（与 iOS 脚本一致，1024 画布）
D = 1024
TOP = (0x20, 0x2A, 0x36)
BOTTOM = (0x11, 0x15, 0x1C)

CAM = (306, 392, 718, 700, 64)      # 相机主体（白色圆角矩形）
NUB = (452, 364, 572, 398, 16)      # 顶部凸起
VIEW = (342, 430, 682, 662, 40)     # 取景窗（透出背景）
LENS_C, LENS_R = (512, 546), 118    # 镜头外环
LENS_IN_R = 74                      # 镜头内芯（透出背景）
WM = (272, 764, 752, 920, 30)       # 水印块（半透明黑）
WM_ALPHA = 0.72

# 文字条：(y 比例, 宽度比例, 半高 px, 是否黄色)
BARS = [
    (0.28, 0.74, 24, True),
    (0.56, 0.94, 16, False),
    (0.82, 0.58, 16, False),
]

# 设计内容包围盒（用于前景安全区缩放）
CONTENT = (272, 364, 752, 920)
CONTENT_CX = (CONTENT[0] + CONTENT[2]) / 2
CONTENT_CY = (CONTENT[1] + CONTENT[3]) / 2
CONTENT_H = CONTENT[3] - CONTENT[1]

DENSITIES = {  # dpi: (整图尺寸, 前景尺寸)
    "mdpi": (48, 108),
    "hdpi": (72, 162),
    "xhdpi": (96, 216),
    "xxhdpi": (144, 324),
    "xxxhdpi": (192, 432),
}

RES = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    "..", "app", "src", "main", "res"))


def chunk(tag, data):
    c = struct.pack(">I", len(data)) + tag + data
    return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path, size, pixels):
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)
        start = y * stride
        raw += pixels[start:start + stride]
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


def lerp(a, b, t):
    return a + (b - a) * t


def in_rrect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= r * r


def in_circle(x, y, cx, cy, r):
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= r * r


def sample(u, v, foreground):
    """返回设计坐标 (u,v) 处的 RGBA；foreground=True 时背景透明（交给背景图层）"""
    t = v / (D - 1)
    bgr, bgg, bgb = (lerp(TOP[i], BOTTOM[i], t) for i in range(3))

    if foreground:
        r = g = b = a = 0
    else:
        r, g, b, a = int(bgr), int(bgg), int(bgb), 255

    # 相机主体 / 凸起
    if in_rrect(u, v, *NUB):
        r, g, b, a = 0xEE, 0xF0, 0xF2, 255
    if in_rrect(u, v, *CAM):
        r, g, b, a = 0xFA, 0xFB, 0xFC, 255
    # 取景窗（透出背景）
    if in_rrect(u, v, *VIEW):
        if foreground:
            r = g = b = a = 0
        else:
            r, g, b, a = int(bgr), int(bgg), int(bgb), 255
    # 镜头外环 / 内芯
    if in_circle(u, v, LENS_C[0], LENS_C[1], LENS_R):
        r, g, b, a = 0x33, 0x3A, 0x44, 255
    if in_circle(u, v, LENS_C[0], LENS_C[1], LENS_IN_R):
        if foreground:
            r = g = b = a = 0
        else:
            r, g, b, a = int(bgr), int(bgg), int(bgb), 255

    # 水印块（半透明黑，前景层用 alpha 合成）
    if in_rrect(u, v, *WM):
        wr, wg, wb = 0x10, 0x12, 0x16
        if a == 0:
            r, g, b, a = wr, wg, wb, int(WM_ALPHA * 255)
        else:
            r = int(lerp(r, wr, WM_ALPHA))
            g = int(lerp(g, wg, WM_ALPHA))
            b = int(lerp(b, wb, WM_ALPHA))

    # 文字条（黄/白）
    if WM[1] < v < WM[3]:
        rx = (u - WM[0]) / (WM[2] - WM[0])
        for (yf, wf, hh, yellow) in BARS:
            yc = WM[1] + (WM[3] - WM[1]) * yf
            if abs(v - yc) < hh and rx < wf:
                if yellow:
                    r, g, b, a = 0xFF, 0xE5, 0x8F, 255
                else:
                    r, g, b, a = 0xFF, 0xFF, 0xFF, 255
                break

    return r, g, b, a


def render(size, foreground):
    """foreground=True：内容缩放进 66% 安全区、背景透明；False：整图烘焙渐变"""
    if foreground:
        # 内容高度占画布 62%（安全区 66% 内留边）
        k = 0.62 * size / CONTENT_H
        cu, cv = CONTENT_CX, CONTENT_CY
    else:
        k = size / D
        cu, cv = D / 2, D / 2

    pixels = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            u = cu + (x + 0.5 - size / 2) / k
            v = cv + (y + 0.5 - size / 2) / k
            r, g, b, a = sample(u, v, foreground)
            idx = (y * size + x) * 4
            pixels[idx] = r
            pixels[idx + 1] = g
            pixels[idx + 2] = b
            pixels[idx + 3] = a
    return pixels


def main():
    # 渐变背景图层
    os.makedirs(os.path.join(RES, "drawable"), exist_ok=True)
    with open(os.path.join(RES, "drawable", "ic_launcher_background.xml"), "w") as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n'
                '<shape xmlns:android="http://schemas.android.com/apk/res/android"\n'
                '    android:shape="rectangle">\n'
                '    <gradient\n'
                '        android:angle="90"\n'
                '        android:startColor="#202A36"\n'
                '        android:endColor="#11151C" />\n'
                '</shape>\n')

    # 自适应图标定义（minSdk 26）
    d26 = os.path.join(RES, "mipmap-anydpi-v26")
    os.makedirs(d26, exist_ok=True)
    with open(os.path.join(d26, "ic_launcher.xml"), "w") as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n'
                '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                '    <background android:drawable="@drawable/ic_launcher_background" />\n'
                '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
                '</adaptive-icon>\n')

    for dpi, (full, fg) in DENSITIES.items():
        out_dir = os.path.join(RES, f"mipmap-{dpi}")
        os.makedirs(out_dir, exist_ok=True)
        write_png(os.path.join(out_dir, "ic_launcher.png"), full, render(full, False))
        write_png(os.path.join(out_dir, "ic_launcher_foreground.png"), fg, render(fg, True))
        print(f"mipmap-{dpi}: ic_launcher {full}px, foreground {fg}px")

    print("done:", RES)


if __name__ == "__main__":
    main()
