# -*- coding: utf-8 -*-
"""生成 TraderTrain 的图标（无第三方依赖：zlib + struct 手写 PNG / ICO）。

用法:
    python tools/make_icon.py

产出:
    app/assets/icon-16.png  icon-24.png  icon-32.png  icon-48.png  icon-64.png
    app/assets/icon-128.png icon-192.png icon-512.png icon-maskable-512.png
    app/assets/icon.ico      （多尺寸：16/24/32/48/64/128/256 全内嵌 PNG）
    docs/icon-preview.png    （给文档/预览看的 512 大图）

换风格只改 PALETTE 和 SHAPES。
"""
import os
import struct
import zlib

# ---------------------------------------------------------------- 调色板
BG_TOP = (0x0a, 0x12, 0x1c)      # 卡片底色（上）
BG_BOT = (0x04, 0x08, 0x0e)      # 卡片底色（下）
UP = (0x5f, 0xe3, 0xc0)          # 涨（青绿）
DOWN = (0xff, 0x6f, 0x85)        # 跌（玫红）
EDGE = (0x9c, 0xd8, 0xea)        # 发丝边框

# 形状用 0..1 的相对坐标描述，渲染时按目标尺寸放大
# ('candle', 中心x, 实体上沿y, 实体下沿y, 实体半宽, 影线上沿y, 影线下沿y, 颜色)
SHAPES = [
    ('candle', 0.335, 0.315, 0.615, 0.082, 0.205, 0.725, UP),
    ('candle', 0.665, 0.415, 0.745, 0.082, 0.295, 0.845, DOWN),
]


def write_png(path, w, h, data):
    """data: bytearray RGBA，长度 w*h*4"""
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw.extend(data[y * stride:(y + 1) * stride])

    def chunk(tag, body):
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    blob = (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(blob)
    return len(blob)


def rounded_mask(x, y, size, pad, radius):
    """返回 0..1 的圆角矩形覆盖率（1=完全在内）"""
    r = radius
    cx = min(max(x, pad + r), size - pad - r)
    cy = min(max(y, pad + r), size - pad - r)
    d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 - r
    if d <= -1.0:
        return 1.0
    if d >= 1.0:
        return 0.0
    return 0.5 - d / 2.0


def render(size, maskable=False, ss=3):
    """画一张 size×size 的 RGBA（ss 倍超采样后缩回，边缘干净）

    小尺寸（<=24px）走简化版：去掉影线、实体加宽，否则缩到 16px 影线会消失、
    实体也只剩几个像素，看起来像随机色块。
    """
    tiny = size <= 24
    n = size * ss
    pad = n * (0.15 if maskable else 0.045)          # maskable 留安全区
    radius = n * (0.20 if maskable else 0.215)
    big = bytearray(n * n * 4)

    for y in range(n):
        t = y / max(1, n - 1)
        base = tuple(int(BG_TOP[i] * (1 - t) + BG_BOT[i] * t) for i in range(3))
        for x in range(n):
            a_card = rounded_mask(x + 0.5, y + 0.5, n, pad, radius)
            if a_card <= 0:
                continue
            col = base
            # 图标边缘一圈很淡的亮线，缩到 16px 也能看出轮廓
            d_edge = abs(rounded_mask(x + 0.5, y + 0.5, n, pad, radius) - 1.0)
            if d_edge < 0.02:
                col = tuple(int(col[i] * 0.55 + EDGE[i] * 0.45) for i in range(3))
            # 蜡烛
            for sh in SHAPES:
                if sh[0] != 'candle':
                    continue
                _, cx, y0, y1, hw, w0, w1, c = sh
                px = x + 0.5
                py = y + 0.5
                if tiny:
                    # 简化：影线去掉，实体放宽、上下各留一点空隙
                    in_body = abs(px - cx * n) <= hw * 1.35 * n and (y0 - 0.02) * n <= py <= (y1 + 0.02) * n
                    in_wick = False
                else:
                    in_body = abs(px - cx * n) <= hw * n and y0 * n <= py <= y1 * n
                    in_wick = abs(px - cx * n) <= max(1.0, n * 0.012) and w0 * n <= py <= w1 * n
                if in_body or in_wick:
                    col = c
            o = (y * n + x) * 4
            big[o:o + 4] = bytes((col[0], col[1], col[2], int(round(255 * a_card))))

    # 盒式降采样
    out = bytearray(size * size * 4)
    inv = 1.0 / (ss * ss)
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0.0
            for dy in range(ss):
                row = ((y * ss + dy) * n + x * ss) * 4
                for dx in range(ss):
                    o = row + dx * 4
                    a += big[o + 3]
                    r += big[o] * big[o + 3]
                    g += big[o + 1] * big[o + 3]
                    b += big[o + 2] * big[o + 3]
            o = (y * size + x) * 4
            if a <= 0:
                out[o:o + 4] = b"\x00\x00\x00\x00"
            else:
                out[o] = min(255, int(r / a))
                out[o + 1] = min(255, int(g / a))
                out[o + 2] = min(255, int(b / a))
                out[o + 3] = min(255, int(a * inv))
    return out


def build_ico(path, images):
    """images: [(size, png_bytes)]，宽度 >=256 时 width/height 字段填 0"""
    head = struct.pack("<HHH", 0, 1, len(images))
    entries = b""
    body = b""
    offset = 6 + 16 * len(images)
    for size, png in images:
        b = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", b, b, 0, 0, 1, 32, len(png), offset)
        body += png
        offset += len(png)
    blob = head + entries + body
    with open(path, "wb") as f:
        f.write(blob)
    return len(blob)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    assets = os.path.join(root, "app", "assets")
    docs = os.path.join(root, "docs")
    os.makedirs(assets, exist_ok=True)
    os.makedirs(docs, exist_ok=True)

    sizes = [16, 24, 32, 48, 64, 128, 192, 512]
    made = {}
    for s in sizes:
        px = render(s, maskable=False, ss=4 if s <= 64 else 3)
        p = os.path.join(assets, f"icon-{s}.png")
        made[s] = (p, write_png(p, s, s, px))
        print(f"icon-{s}.png  {s}x{s}  {made[s][1]} B")

    m = render(512, maskable=True, ss=3)
    write_png(os.path.join(assets, "icon-maskable-512.png"), 512, 512, m)
    print("icon-maskable-512.png  512x512")

    # ico：多尺寸内嵌 PNG（Windows 会挑最接近的，任务栏/资源管理器/alt-tab 都清楚）
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    pngs = []
    for s in ico_sizes:
        if s in made:
            pngs.append((s, open(made[s][0], "rb").read()))
        else:  # 256
            px = render(256, ss=3)
            tmp = os.path.join(assets, "_icon256.png")
            write_png(tmp, 256, 256, px)
            pngs.append((256, open(tmp, "rb").read()))
            os.remove(tmp)
    n = build_ico(os.path.join(assets, "icon.ico"), pngs)
    print(f"icon.ico  {len(ico_sizes)} sizes  {n} B")

    # 给文档的预览图（大图 + 浅底，方便看轮廓）
    preview = render(256, ss=3)
    write_png(os.path.join(docs, "icon-preview.png"), 256, 256, preview)
    print("docs/icon-preview.png  256x256")


if __name__ == "__main__":
    main()
