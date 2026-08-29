#!/usr/bin/env python3
# 纯 Python 生成 App 图标（1024x1024 PNG，无第三方依赖）
# 主题：暗色取景器 + 白色相机 + 底部半透明水印块（黄/白文字条）

import struct
import zlib
import os

SIZE = 1024


def chunk(tag, data):
    c = struct.pack(">I", len(data)) + tag + data
    return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path, pixels):
    """pixels: bytearray 长度 SIZE*SIZE*4 (RGBA)"""
    raw = bytearray()
    stride = SIZE * 4
    for y in range(SIZE):
        raw.append(0)  # filter: none
        start = y * stride
        raw += pixels[start:start + stride]
    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


def lerp(a, b, t):
    return int(round(a + (b - a) * t))


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


def main():
    pixels = bytearray(SIZE * SIZE * 4)

    # 背景：纵向渐变（取景器深灰蓝）
    top = (0x20, 0x2A, 0x36)
    bottom = (0x11, 0x15, 0x1C)

    # 相机主体（白色圆角矩形）
    cam_x0, cam_y0, cam_x1, cam_y1 = 306, 392, 718, 700
    cam_r = 64
    # 取景窗（深色圆角矩形，相机内部）
    view_x0, view_y0, view_x1, view_y1 = 342, 430, 682, 662
    view_r = 40
    # 镜头
    lens_cx, lens_cy, lens_r = 512, 546, 118
    lens_inner_r = 74
    # 顶部小凸起
    nub_x0, nub_y0, nub_x1, nub_y1 = 452, 364, 572, 398
    nub_r = 16

    # 底部水印块
    wm_x0, wm_y0, wm_x1, wm_y1 = 272, 764, 752, 920
    wm_r = 30
    wm_alpha = 0.72

    # 水印文字条
    bars = [
        (0.78, 0.34, 145),  # 宽黄色
        (0.98, 0.52, 96),   # 白
        (0.62, 0.70, 96),   # 白（短）
        (0.46, 0.84, 96),   # 黄（短）
    ]

    for y in range(SIZE):
        t = y / (SIZE - 1)
        bgr = lerp(top[0], bottom[0], t)
        bgg = lerp(top[1], bottom[1], t)
        bgb = lerp(top[2], bottom[2], t)
        for x in range(SIZE):
            r, g, b = bgr, bgg, bgb
            a = 255

            # 相机主体
            if in_rrect(x, y, cam_x0, cam_y0, cam_x1, cam_y1, cam_r):
                r, g, b = 0xFA, 0xFB, 0xFC
            # 凸起
            if in_rrect(x, y, nub_x0, nub_y0, nub_x1, nub_y1, nub_r):
                r, g, b = 0xEE, 0xF0, 0xF2
            # 取景窗（画在主体之上）
            if in_rrect(x, y, view_x0, view_y0, view_x1, view_y1, view_r):
                r, g, b = bgr, bgg, bgb
            # 镜头外环
            if in_circle(x, y, lens_cx, lens_cy, lens_r):
                r, g, b = 0x33, 0x3A, 0x44
            # 镜头内芯（取景窗同色 + 光圈环）
            if in_circle(x, y, lens_cx, lens_cy, lens_inner_r):
                r, g, b = bgr, bgg, bgb
            if in_circle(x, y, lens_cx, lens_cy, lens_inner_r) and \
               in_circle(x, y, lens_cx, lens_cy, lens_inner_r - 18):
                if (x + y) % 40 < 2:
                    pass  # 简化：细环留空

            # 底部水印块（半透明黑，合成）
            if in_rrect(x, y, wm_x0, wm_y0, wm_x1, wm_y1, wm_r):
                wr, wg, wb = 0x10, 0x12, 0x16
                r = lerp(r, wr, wm_alpha)
                g = lerp(g, wg, wm_alpha)
                b = lerp(b, wb, wm_alpha)

            # 水印文字条（黄/白）
            if wm_y0 < y < wm_y1:
                rx = (x - wm_x0) / (wm_x1 - wm_x0)
                ry = (y - wm_y0) / (wm_y1 - wm_y0)
                for (frac, h, use_yellow) in bars:
                    y_center = wm_y0 + (wm_y1 - wm_y0) * frac
                    if abs(y - y_center) < h / 2 and rx < (frac + 0.03):
                        r, g, b = (0xFF, 0xE5, 0x8F) if use_yellow else (0xFF, 0xFF, 0xFF)
                        break

            idx = (y * SIZE + x) * 4
            pixels[idx] = r
            pixels[idx + 1] = g
            pixels[idx + 2] = b
            pixels[idx + 3] = a

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "..", "WatermarkCamera", "Assets.xcassets",
                       "AppIcon.appiconset", "icon-1024.png")
    out = os.path.normpath(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    write_png(out, pixels)
    print("written:", out, os.path.getsize(out), "bytes")


if __name__ == "__main__":
    main()