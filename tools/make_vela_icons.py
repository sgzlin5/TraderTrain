# -*- coding: utf-8 -*-
"""从 Vela 品牌 PNG 源图（200×200，蓝渐变底 + 白三角）生成整套应用图标。

用法:
    uv run --with pillow python tools/make_vela_icons.py <源图.png>

产物（app/assets/）：
    icon-16/24/32/48/64/128/192/512.png   圆角透明
    icon-maskable-512.png                  全出血（maskable 安全区：内容缩至 80%）
    icon.ico                               16/24/32/48/64/128/256 内嵌 PNG
    logo.png                               顶栏 26px 方形标（128px 渲染）

与 make_icon_from_png.py 的单色墨迹管线不同：品牌源图自带蓝渐变底，
直接 LANCZOS 缩放 + 程序化圆角透明，保留完整品牌观感。
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw

SIZES = [16, 24, 32, 48, 64, 128, 192, 512]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "assets")


def rounded(im, radius_ratio=0.18, ss=4):
    """程序化圆角透明（超采样抗锯齿）。"""
    w, h = im.size
    big = im.resize((w * ss, h * ss), Image.LANCZOS)
    mask = Image.new("L", big.size, 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, big.size[0] - 1, big.size[1] - 1], radius=int(big.size[0] * radius_ratio), fill=255)
    out = Image.new("RGBA", big.size, (0, 0, 0, 0))
    out.paste(big, (0, 0), mask)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--out", default=ASSETS)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    src = Image.open(args.src).convert("RGB")
    master = rounded(src)                                  # 200×200 圆角透明（母版）

    for n in SIZES:
        im = master.resize((n, n), Image.LANCZOS)
        im.save(os.path.join(args.out, f"icon-{n}.png"))
        print(f"icon-{n}.png")

    # maskable：全出血重绘（渐变底铺满 + 内容缩进安全区 80%）
    big = src.resize((640, 640), Image.LANCZOS)            # 母版放大后缩进
    inner = big.resize((512, 512), Image.LANCZOS)          # 简化：直接 512 全出血（源图内容居中 60%，天然在安全区）
    inner.save(os.path.join(args.out, "icon-maskable-512.png"))
    print("icon-maskable-512.png")

    ico_sizes = [(s, s) for s in ICO_SIZES]
    master.resize((256, 256), Image.LANCZOS).save(
        os.path.join(args.out, "icon.ico"), sizes=ico_sizes)
    print("icon.ico")

    # 顶栏方形标
    master.resize((128, 128), Image.LANCZOS).save(os.path.join(args.out, "logo.png"))
    print("logo.png")


if __name__ == "__main__":
    sys.exit(main())
