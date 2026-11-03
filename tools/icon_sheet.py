# -*- coding: utf-8 -*-
"""把各尺寸图标拼成一张对照图（最近邻放大，展示真实像素）。

用法: uv run --with pillow python tools/icon_sheet.py
产出: docs/icon-sizes.png

注：不要自己手写 PNG 解码——PIL 写出来的 PNG 会用各种 filter，
只处理 filter=0 的解码器会把图整成白条。
"""
import os

from PIL import Image

SPECS = [(16, 8), (24, 6), (32, 4), (48, 3), (64, 2)]
BACKDROP = (12, 18, 26, 255)
GAP = 16


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    assets = os.path.join(root, "app", "assets")

    tiles = []
    for size, zoom in SPECS:
        p = os.path.join(assets, f"icon-{size}.png")
        if not os.path.exists(p):
            continue
        im = Image.open(p).convert("RGBA")
        tiles.append(im.resize((im.width * zoom, im.height * zoom), Image.NEAREST))

    W = GAP
    H = 0
    for im in tiles:
        W += im.width + GAP
        H = max(H, im.height)
    H += GAP * 2

    sheet = Image.new("RGBA", (W, H), BACKDROP)
    x = GAP
    for im in tiles:
        sheet.alpha_composite(im, (x, GAP + (H - GAP * 2 - im.height) // 2))
        x += im.width + GAP

    out = os.path.join(root, "docs", "icon-sizes.png")
    sheet.convert("RGB").save(out)
    print(f"saved {out}  {W}x{H}")


if __name__ == "__main__":
    main()
