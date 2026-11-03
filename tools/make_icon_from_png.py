# -*- coding: utf-8 -*-
"""把一张 Logo PNG 转成整套图标（PNG 多尺寸 + 多尺寸 ICO）。

用法:
    uv run --with pillow --with numpy python tools/make_icon_from_png.py <源图.png> [--ink 858585] [--pad 0.06]

做法:
  1. 用亮度算覆盖率（抗锯齿保留），颜色按覆盖率在原色和白色之间插值；
  2. 裁到墨迹外框并留 --pad 边距，圆环会尽量占满图标；
  3. 小尺寸（<=32）先做形态学“加粗”（MaxFilter），否则线缩到 1px 以下会消失；
  4. 生成 16/24/32/48/64/128/192/512 + maskable + icon.ico（7 个尺寸内嵌 PNG）。

换 Logo 只需重跑本脚本，再双击 make-shortcut.bat 刷新快捷方式图标。
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

SIZES = [16, 24, 32, 48, 64, 128, 192, 512]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
SS = 4          # 超采样倍数


def load_coverage(path, white_lum=232.0, ink_lum=60.0):
    """返回 (coverage 0..1, 原始 RGBA)

    覆盖率 = 亮度覆盖率 × alpha。带透明通道的源图（圆角透明、剪贴素材）
    如果不乘 alpha，透明但 RGB 偏暗的像素会被当成墨迹，四角直接变成黑块。
    """
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    lum = a[:, :, :3].mean(axis=2)
    cov = (white_lum - lum) / max(1.0, white_lum - ink_lum)
    cov = np.clip(cov, 0.0, 1.0) * (a[:, :, 3] / 255.0)
    return cov, a


def crop_box(cov, pad_ratio):
    ys, xs = np.where(cov > 0.25)
    if len(xs) == 0:
        raise SystemExit("源图里没找到墨迹（整张都接近白色？）")
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    w, h = x1 - x0, y1 - y0
    side = max(w, h)
    pad = int(round(side * pad_ratio))
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    half = side / 2.0 + pad
    return cx, cy, half


def render(cov, rgb, cx, cy, half, size, ink, dilate=0, dark=False):
    """把覆盖率图按 (cx,cy,half) 映射到 size×size，返回 RGBA PIL 图"""
    n = size * SS
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) + 0.5
    sx = (xx - n / 2.0) / (n / (2.0 * half)) + cx
    sy = (yy - n / 2.0) / (n / (2.0 * half)) + cy
    h, w = cov.shape
    ix = np.clip(sx.astype(np.int32), 0, w - 1)
    iy = np.clip(sy.astype(np.int32), 0, h - 1)
    m = cov[iy, ix]

    img = Image.fromarray((m * 255).astype(np.uint8), mode="L")
    if dilate:
        img = img.filter(ImageFilter.MaxFilter(dilate))
    img = img.resize((size, size), Image.LANCZOS)
    m2 = np.asarray(img).astype(np.float32) / 255.0

    out = np.empty((size, size, 4), dtype=np.uint8)
    ink_arr = np.array(ink, dtype=np.float32)

    if dark:
        # 深色圆角底 + 浅色线条：任务栏里更醒目，也和程序皮肤一致
        r = size * 0.22
        yy2, xx2 = np.mgrid[0:size, 0:size].astype(np.float32) + 0.5
        cxr = np.clip(xx2, r, size - r)
        cyr = np.clip(yy2, r, size - r)
        d = np.sqrt((xx2 - cxr) ** 2 + (yy2 - cyr) ** 2) - r
        alpha = np.clip(0.5 - d, 0.0, 1.0)
        bg_arr = np.array((0x0a, 0x12, 0x1c), dtype=np.float32)
    else:
        alpha = np.ones((size, size), dtype=np.float32)
        bg_arr = np.array((255.0, 255.0, 255.0), dtype=np.float32)

    for k in range(3):
        out[:, :, k] = np.clip(bg_arr[k] * (1 - m2) + ink_arr[k] * m2, 0, 255).astype(np.uint8)
    out[:, :, 3] = (alpha * 255).astype(np.uint8)
    return Image.fromarray(out, mode="RGBA")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--ink", default="6b6b6b", help="线条颜色 hex，小图标要深一点才看得清")
    ap.add_argument("--pad", type=float, default=0.07, help="外框留白比例")
    ap.add_argument("--dark", action="store_true", help="深色圆角底 + 浅色线条（另一种观感）")
    args = ap.parse_args()

    ink = tuple(int(args.ink[i:i + 2], 16) for i in (0, 2, 4))
    cov, rgb = load_coverage(args.src)
    cx, cy, half = crop_box(cov, args.pad)

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    assets = os.path.join(root, "app", "assets")
    docs = os.path.join(root, "docs")
    os.makedirs(assets, exist_ok=True)
    os.makedirs(docs, exist_ok=True)

    imgs = {}
    for size in SIZES:
        # 小尺寸加粗（MaxFilter 只接受奇数 >=3）+ 加深，否则线细到看不见
        if args.dark:                      # 深底 → 小尺寸也要用亮线，否则糊成一团黑
            dilate = 3 if size <= 32 else 0
            ink_s = ink
        else:                              # 白底 → 小尺寸线条压深一点，别发灰
            ink_s = tuple(max(0, int(v * 0.82)) for v in ink) if size <= 32 else ink
            dilate = 3 if size <= 32 else 0
        im = render(cov, rgb, cx, cy, half, size, ink_s, dilate, dark=args.dark)
        im.save(os.path.join(assets, f"icon-{size}.png"))
        imgs[size] = im
        print(f"icon-{size}.png")

    # maskable：四周多留 14% 安全区
    cx2, cy2, half2 = crop_box(cov, 0.16)
    render(cov, rgb, cx2, cy2, half2, 512, ink, dark=args.dark).save(os.path.join(assets, "icon-maskable-512.png"))
    print("icon-maskable-512.png")

    # ICO：256 单独渲染一份
    imgs[256] = render(cov, rgb, cx, cy, half, 256, ink, dark=args.dark)
    base = imgs[256]
    base.save(os.path.join(assets, "icon.ico"), format="ICO",
              sizes=[(s, s) for s in ICO_SIZES])
    print("icon.ico", os.path.getsize(os.path.join(assets, "icon.ico")), "B")

    render(cov, rgb, cx, cy, half, 256, ink, dark=args.dark).save(os.path.join(docs, "icon-preview.png"))
    print("docs/icon-preview.png")


if __name__ == "__main__":
    main()
