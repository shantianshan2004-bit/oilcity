"""生成「油城往事」Launcher 图标。

设计取向：纸色底 + 墨色塔架剪影 + 一枚朱砂方印。
塔架是油田的符号，方印承接站点的档案气质；不用渐变、不用圆角拟物，
保持与站内水墨语言同一套手感。
"""
import math
import os

from PIL import Image, ImageDraw

OUT_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "android", "app", "src", "main", "res")

PAPER = (243, 240, 232, 255)   # #F3F0E8
INK = (23, 23, 21, 255)        # #171715
SEAL = (135, 61, 50, 255)      # #873D32

DENSITIES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def draw_icon(size):
    """在 4x 超采样画布上绘制，最后缩到目标尺寸取抗锯齿。"""
    ss = 4
    s = size * ss
    img = Image.new("RGBA", (s, s), PAPER)
    d = ImageDraw.Draw(img)

    cx = s / 2.0
    u = s / 100.0  # 以 100 为设计单位

    # ---- 塔架：两根外腿 + 交叉撑 ----
    top_y = 24 * u
    base_y = 78 * u
    half_top = 7 * u
    half_base = 26 * u
    lw = max(1, int(3.0 * u))

    def leg_x(y):
        ratio = (y - top_y) / (base_y - top_y)
        return half_top + (half_base - half_top) * ratio

    d.line([(cx - half_top, top_y), (cx - half_base, base_y)], fill=INK, width=lw)
    d.line([(cx + half_top, top_y), (cx + half_base, base_y)], fill=INK, width=lw)

    # 横撑
    rungs = 5
    for i in range(1, rungs + 1):
        y = top_y + (base_y - top_y) * i / (rungs + 1)
        hx = leg_x(y)
        d.line([(cx - hx, y), (cx + hx, y)], fill=INK, width=max(1, int(2.0 * u)))

    # 斜撑：交替方向，做出钢架节奏
    for i in range(rungs + 1):
        y0 = top_y + (base_y - top_y) * i / (rungs + 1)
        y1 = top_y + (base_y - top_y) * (i + 1) / (rungs + 1)
        h0 = leg_x(y0)
        h1 = leg_x(y1)
        if i % 2 == 0:
            d.line([(cx - h0, y0), (cx + h1, y1)], fill=INK, width=max(1, int(1.6 * u)))
        else:
            d.line([(cx + h0, y0), (cx - h1, y1)], fill=INK, width=max(1, int(1.6 * u)))

    # 顶架三角
    d.line([(cx, top_y - 9 * u), (cx - half_top, top_y)], fill=INK, width=lw)
    d.line([(cx, top_y - 9 * u), (cx + half_top, top_y)], fill=INK, width=lw)

    # ---- 地平线 ----
    d.line([(14 * u, base_y + 4 * u), (86 * u, base_y + 4 * u)],
           fill=INK, width=max(1, int(2.4 * u)))

    # ---- 朱砂方印（右下）----
    seal = 22 * u
    sx = 62 * u
    sy = 60 * u
    r = 3 * u
    d.rounded_rectangle([sx, sy, sx + seal, sy + seal], radius=r,
                        fill=SEAL)
    # 印面留白：一道竖、一道横，读作「城」的极简骨架
    bw = max(1, int(2.2 * u))
    d.rectangle([sx + seal * 0.46, sy + seal * 0.18,
                 sx + seal * 0.54, sy + seal * 0.82], fill=PAPER)
    d.rectangle([sx + seal * 0.18, sy + seal * 0.46,
                 sx + seal * 0.82, sy + seal * 0.54], fill=PAPER)

    return img.resize((size, size), Image.LANCZOS)


def main():
    made = []
    for folder, px in DENSITIES.items():
        out_dir = os.path.join(OUT_ROOT, folder)
        os.makedirs(out_dir, exist_ok=True)
        icon = draw_icon(px)
        path = os.path.join(out_dir, "ic_launcher.png")
        icon.save(path, "PNG", optimize=True)
        made.append(path)
        # 圆形图标（部分启动器会取用）
        round_path = os.path.join(out_dir, "ic_launcher_round.png")
        mask = Image.new("L", (px * 4, px * 4), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, px * 4 - 1, px * 4 - 1], fill=255)
        circular = draw_icon(px).convert("RGBA")
        circular.putalpha(mask.resize((px, px), Image.LANCZOS))
        circular.save(round_path, "PNG", optimize=True)
        made.append(round_path)

    # WebView 首屏用的占位图（避免白屏闪一下）
    drawable = os.path.join(OUT_ROOT, "drawable")
    os.makedirs(drawable, exist_ok=True)
    draw_icon(288).save(os.path.join(drawable, "splash_mark.png"), "PNG", optimize=True)

    for m in made:
        print("生成", os.path.relpath(m, os.path.dirname(OUT_ROOT)))


if __name__ == "__main__":
    main()
