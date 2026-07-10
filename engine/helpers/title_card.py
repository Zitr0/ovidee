"""Título animado como overlay transparente (motion graphics básico).

Renderiza frames RGBA con PIL (fade-in con easing cúbico + leve desplazamiento
vertical, hold, fade-out) y los ensambla en un .mov con alfa (codec png) que
render.py compone sobre el video. Mismo enfoque PIL del video-use original.

Uso:
    python helpers/title_card.py --text "MI TÍTULO" --out overlay.mov \
        --width 1920 --height 1080 --duration 3 --color '#FFFFFF' --position center
"""

from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FPS = 24
FONT_CANDIDATES = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def ease_out_cubic(t: float) -> float:
    return 1 - (1 - t) ** 3


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            try:
                return ImageFont.truetype(candidate, size, index=1 if candidate.endswith(".ttc") else 0)
            except OSError:
                try:
                    return ImageFont.truetype(candidate, size)
                except OSError:
                    continue
    return ImageFont.load_default(size)


def hex_to_rgb(color: str) -> tuple[int, int, int]:
    c = color.lstrip("#")
    if len(c) != 6:
        c = "FFFFFF"
    return tuple(int(c[i : i + 2], 16) for i in (0, 2, 4))


def render_frames(text, width, height, duration, color, position, frames_dir):
    n_frames = max(1, round(duration * FPS))
    fade_in = min(0.5, duration / 3)
    fade_out = min(0.4, duration / 3)
    rgb = hex_to_rgb(color)

    font_size = int(height * (0.075 if position == "center" else 0.05))
    font = load_font(font_size)

    # Centrado sobre el ancho del string COMPLETO (regla de video-use: evita deslizamientos)
    probe = Image.new("RGBA", (width, height))
    box = ImageDraw.Draw(probe).textbbox((0, 0), text, font=font, stroke_width=3)
    text_w, text_h = box[2] - box[0], box[3] - box[1]
    x = (width - text_w) // 2
    base_y = (height - text_h) // 2 if position == "center" else int(height * 0.78)

    rise = int(height * 0.03)
    for i in range(n_frames):
        t = i / FPS
        if t < fade_in:
            k = ease_out_cubic(t / fade_in)
        elif t > duration - fade_out:
            k = max(0.0, (duration - t) / fade_out)
        else:
            k = 1.0
        alpha = int(255 * k)
        y = base_y + int(rise * (1 - ease_out_cubic(min(1.0, t / fade_in if fade_in else 1))))

        frame = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(frame)
        draw.text(
            (x, y), text, font=font,
            fill=(*rgb, alpha), stroke_width=3, stroke_fill=(0, 0, 0, alpha),
        )
        frame.save(frames_dir / f"frame_{i:04d}.png")
    return n_frames


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--duration", type=float, default=3.0)
    ap.add_argument("--color", default="#FFFFFF")
    ap.add_argument("--position", choices=["center", "lower_third"], default="center")
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        frames_dir = Path(tmp)
        render_frames(args.text, args.width, args.height, args.duration, args.color, args.position, frames_dir)
        subprocess.run(
            ["ffmpeg", "-y", "-framerate", str(FPS), "-i", str(frames_dir / "frame_%04d.png"),
             "-c:v", "png", str(args.out)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    print(f"título animado → {args.out.name} ({args.duration}s)")


if __name__ == "__main__":
    main()
