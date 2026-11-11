# -*- coding: utf-8 -*-
"""从 Vela 单色符号（黑标 PNG）生成整套应用图标 —— 走「亚像素覆盖率」管线，任何尺寸都清晰。

用法:
    uv run --with pillow --with numpy python tools/make_vela_icons.py tools/vela-logo-src.png
    ... --palette light        # 白底黑标；默认深底白标（配 App 深色主题）
    ... --bg 0B1017 --ink FFFFFF

为什么不会糊：
  1) 源图先二值化并裁到符号边界框（不留源图自带的白边）；
  2) 每个目标尺寸都把掩膜放大到 8× 网格、以 0.5 阈值重新定边（边界落在亚像素位置），
     再按 8×8 块做**面积平均**得到每个像素的真实覆盖率 —— 边缘是按目标网格算出来的，
     不是「大图缩小」的软坡；
  3) 圆角也在 8× 上画；透明区 RGB 归零（个别渲染器会把非预乘残色看成白边）；
  4) icon.ico 手写容器，16/24/32/48/64/128/256 各嵌各自渲染的 PNG。
"""
import argparse
import os
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw

SIZES = [16, 24, 32, 48, 64, 128, 192, 512]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
SS = 8
ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "assets")


# ---------- 位图 → 亚像素覆盖率 ----------

def load_mask(path):
    """源图 → 二值符号掩膜（黑标）＋ 裁到墨迹边界框。"""
    a = np.asarray(Image.open(path).convert("L"))
    ink = a < 128
    ys, xs = np.where(ink)
    if len(xs) == 0:
        raise SystemExit("源图里没找到深色符号")
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    return ink[box[1]:box[3], box[0]:box[2]]


def supersampled_mask(mask, size_px, ss=SS):
    """掩膜 → size_px² 的浮点覆盖率（0..1）。

    做法：把二值掩膜逐次放大到 size_px*ss，在 8× 网格上以 0.5 阈值重新定边，
    再按 ss×ss 块求平均 —— 每个输出像素拿到的就是真实的面积覆盖率，边缘绝对干净。
    比「大图缩小」锐，也比折线追踪稳（不会因为简化误差把笔画改细）。
    """
    h, w = mask.shape
    img = Image.fromarray((mask * 255).astype(np.uint8), mode="L")
    big = size_px * ss
    up = img.resize((big, big), Image.LANCZOS)      # 平滑插值后再定阈值 = 亚像素级边界
    up = up.point(lambda v: 255 if v >= 128 else 0)
    small = up.resize((size_px, size_px), Image.BOX)  # ss×ss 面积平均 → 覆盖率
    return np.asarray(small, dtype=np.float32) / 255.0


def rounded_alpha(n, radius_ratio=0.18, ss=SS):
    big = n * ss
    m = Image.new("L", (big, big), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * radius_ratio), fill=255)
    return m.resize((n, n), Image.LANCZOS)


def render(mask, n, bg, ink, rounded=True, content_scale=0.76):
    """符号掩膜 → n×n 图标（圆角/全出血、指定底色与符号色）。"""
    h, w = mask.shape
    side = int(round(n * content_scale))
    scale = side / max(w, h)
    tw, th = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    cov_small = supersampled_mask(mask, int(round(max(tw, th) * 1.0)))
    cov_img = Image.fromarray((cov_small * 255).astype(np.uint8), mode="L").resize((tw, th), Image.LANCZOS)

    bg_rgb = Image.new("RGB", (n, n), bg).convert("RGB")
    ink_layer = Image.new("RGB", (tw, th), ink)
    bg_rgb.paste(ink_layer, ((n - tw) // 2, (n - th) // 2), cov_img)
    if not rounded:
        return bg_rgb
    out = bg_rgb.convert("RGBA")
    out.putalpha(rounded_alpha(n))
    arr = np.asarray(out).copy()
    arr[arr[..., 3] == 0, :3] = 0
    return Image.fromarray(arr, mode="RGBA")


def _trace(mask, start):
    """Moore 邻域边界跟踪（返回像素中心闭合折线）。"""
    h, w = mask.shape
    dirs = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]
    cx, cy = start
    back = 4
    pts = [(cx, cy)]
    for _ in range(8 * w * h):
        for k in range(8):
            nd = (back + 1 + k) % 8
            nx, ny = cx + dirs[nd][0], cy + dirs[nd][1]
            if 0 <= nx < w and 0 <= ny < h and mask[ny, nx]:
                cx, cy, back = nx, ny, (nd + 4) % 8
                pts.append((cx, cy))
                break
        else:
            break
        if (cx, cy) == start and len(pts) > 2:
            break
    return pts


def _rdp(points, eps=0.6):
    if len(points) < 4:
        return list(points)
    pts = np.asarray(points, dtype=np.float64)
    keep = np.zeros(len(pts), dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = pts[i], pts[j]
        ab = b - a
        n = float(np.hypot(*ab))
        seg = pts[i + 1:j]
        if n < 1e-9:
            dist = np.hypot(seg[:, 0] - a[0], seg[:, 1] - a[1])
        else:
            dist = np.abs(np.cross(np.broadcast_to(ab, (len(seg), 2)), seg - a)) / n
        k = int(np.argmax(dist))
        if dist[k] > eps:
            keep[i + 1 + k] = True
            stack.extend([(i, i + 1 + k), (i + 1 + k, j)])
    return [tuple(p) for p in pts[keep]]


def _components(mask):
    h, w = mask.shape
    lab = np.zeros((h, w), dtype=np.int32)
    cur = 0
    for y in range(h):
        for x in range(w):
            if not mask[y, x] or lab[y, x]:
                continue
            cur += 1
            stack = [(x, y)]
            lab[y, x] = cur
            while stack:
                cx, cy = stack.pop()
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = cur
                        stack.append((nx, ny))
    return lab, cur


def emit_svg(path, mask, bg, ink, content_scale=0.76, vb=1000):
    """把符号矢量成 SVG（浏览器按目标 DPI 栅格化 → 任务栏/多屏缩放都不糊）。"""
    h, w = mask.shape
    lab, n = _components(mask)
    side = vb * content_scale
    scale = side / max(w, h)
    ox = (vb - w * scale) / 2.0
    oy = (vb - h * scale) / 2.0
    subs = []
    for l in range(1, n + 1):
        comp = lab == l
        if comp.sum() < 12:
            continue
        ys, xs = np.where(comp)
        start = (int(xs[np.argmin(ys * w + xs)]), int(ys.min()))
        poly = _rdp(_trace(comp, start), 0.9)
        d = "M" + " L".join("%.1f %.1f" % (ox + px * scale, oy + py * scale) for px, py in poly) + " Z"
        subs.append(d)
    r = vb * 0.18
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d">'
           '<rect width="%d" height="%d" rx="%.0f" fill="%s"/>'
           '<path fill="%s" fill-rule="evenodd" d="%s"/></svg>'
           % (vb, vb, vb, vb, vb, vb, r, bg, ink, " ".join(subs)))
    with open(path, "w", encoding="utf-8") as f:
        f.write(svg + "\n")
    return len(subs)


def write_ico(path, png_paths):
    items = []
    for p in png_paths:
        with open(p, "rb") as f:
            data = f.read()
        items.append((Image.open(p).size[0], data))
    items.sort(key=lambda x: x[0])
    count = len(items)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    entries, blobs = b"", b""
    for n, data in items:
        b = 0 if n >= 256 else n
        entries += struct.pack("<BBBBHHII", b, b, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    with open(path, "wb") as f:
        f.write(header + entries + blobs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?", default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "vela-logo-src.png"))
    ap.add_argument("--out", default=ASSETS)
    ap.add_argument("--palette", default="dark", choices=["dark", "light"])
    ap.add_argument("--bg", default=None, help="自定义底色（十六进制），覆盖 palette")
    ap.add_argument("--ink", default=None, help="自定义符号色（十六进制），覆盖 palette")
    args = ap.parse_args()

    palette = {"dark": ("#0B1017", "#FFFFFF"), "light": ("#FFFFFF", "#000000")}[args.palette]
    bg = args.bg or palette[0]
    ink = args.ink or palette[1]

    mask = load_mask(args.src)
    src_size = Image.open(args.src).size
    print(f"源图 {src_size[0]}×{src_size[1]} → 符号掩膜 {mask.shape[1]}×{mask.shape[0]}，底色 {bg}，符号色 {ink}")

    os.makedirs(args.out, exist_ok=True)
    made = {}
    for n in SIZES:
        p = os.path.join(args.out, f"icon-{n}.png")
        render(mask, n, bg, ink).save(p, optimize=True)
        made[n] = p
        print(f"icon-{n}.png")

    # maskable：全出血，内容缩到 80% 安全区
    render(mask, 512, bg, ink, rounded=False, content_scale=0.68).save(
        os.path.join(args.out, "icon-maskable-512.png"), optimize=True)
    print("icon-maskable-512.png")

    tmp = []
    for n in ICO_SIZES:
        if n in made:
            tmp.append(made[n])
        else:
            p = os.path.join(args.out, f".icon-{n}.png")
            render(mask, n, bg, ink).save(p, optimize=True)
            tmp.append(p)
            made[n] = p
    write_ico(os.path.join(args.out, "icon.ico"), tmp)
    print("icon.ico")

    n_paths = emit_svg(os.path.join(args.out, "icon.svg"), mask, bg, ink)
    print(f"icon.svg（{n_paths} 条轮廓）")

    # 顶栏标只有 26px，符号给大一点（0.84）更好认
    render(mask, 128, bg, ink, content_scale=0.84).save(os.path.join(args.out, "logo.png"), optimize=True)
    print("logo.png")

    for n in ICO_SIZES:
        p = made.get(n, "")
        if os.path.basename(p).startswith(".icon-"):
            os.remove(p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
