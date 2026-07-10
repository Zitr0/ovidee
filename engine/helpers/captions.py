"""Genera captions .ass desde el EDL + transcripts (word-level), configurable.

Parámetros reales (nada de "estilos fijos"):
  --highlight-mode current_word | cumulative | none
      current_word: resalta ÚNICAMENTE la palabra exacta que se dice en ese instante
                     (el resto del chunk queda en blanco) — no acumula resaltado.
      cumulative:   relleno progresivo estilo karaoke clásico (libass \\kf) — las
                     palabras ya dichas quedan coloreadas ("sing-along").
      none:         todo el chunk del mismo color, sin resaltado.
  --chunk-size N     palabras objetivo visibles a la vez (1-4).
  --color '#RRGGBB'  color del resaltado (o del texto si highlight-mode=none).
  --position top|middle|bottom  siempre centrado horizontalmente.

El número de palabras por línea SIEMPRE se recorta para que el texto quepa en el
ancho del frame — se mide con la misma fuente que usará libass (PIL), no se asume
un conteo fijo de palabras. Esto evita que el texto se salga de la pantalla.

Cumple la Hard Rule 5 (offsets del timeline de salida) y se quema DESPUÉS de los
overlays (Hard Rule 1) en un paso posterior del pipeline.

Uso:
    python helpers/captions.py --edl edit/edl_v1.json --edit-dir edit \
        --out edit/captions_v1.ass --highlight-mode current_word --color '#22C55E' \
        --position bottom --chunk-size 3 --width 1920 --height 1080
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from title_card import load_font  # mismas fuentes que usa el título animado

ALIGNMENT = {"top": 8, "middle": 5, "bottom": 2}


def hex_to_ass(color: str, alpha: str = "00") -> str:
    """'#RRGGBB' → '&HAABBGGRR' (ASS usa BGR)."""
    c = color.lstrip("#")
    if len(c) != 6:
        c = "FFFFFF"
    r, g, b = c[0:2], c[2:4], c[4:6]
    return f"&H{alpha}{b}{g}{r}".upper()


def fmt_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def words_in_range(transcript: dict, start: float, end: float) -> list[dict]:
    out = []
    for w in transcript.get("words", []):
        if w.get("type") != "word":
            continue
        if w["start"] >= start - 0.05 and w["end"] <= end + 0.05:
            out.append(w)
    return out


def collect_output_words(edl: dict, edit_dir: Path, transition_overlap: float = 0.0) -> list[dict]:
    """Palabras con tiempos re-mapeados al timeline de salida (Hard Rule 5).

    `transition_overlap`: con transiciones xfade entre cortes, cada segmento
    empieza `overlap` segundos antes (los cortes se solapan), así que el offset
    acumulado se reduce en esa cantidad por frontera para que los captions no
    deriven ~overlap segundos por corte.
    """
    cache: dict[str, dict] = {}
    result = []
    offset = 0.0
    for r in edl["ranges"]:
        stem = r["source"]
        if stem not in cache:
            cache[stem] = json.loads((edit_dir / "transcripts" / f"{stem}.json").read_text())
        seg_dur = r["end"] - r["start"]
        for w in words_in_range(cache[stem], r["start"], r["end"]):
            out_start = max(0.0, w["start"] - r["start"]) + offset
            out_end = min(seg_dur, w["end"] - r["start"]) + offset
            if out_end > out_start:
                result.append({"text": w["text"].strip(), "start": out_start, "end": out_end})
        offset += max(0.0, seg_dur - transition_overlap)
    return result


def text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> int:
    box = draw.textbbox((0, 0), text, font=font, stroke_width=3)
    return box[2] - box[0]


def group_lines(
    words: list[dict],
    chunk_size: int,
    max_width_px: int,
    font: ImageFont.FreeTypeFont,
    max_gap: float = 0.6,
) -> list[list[dict]]:
    """Agrupa palabras respetando: tamaño objetivo, gaps de silencio, y — sobre
    todo — que el texto (en MAYÚSCULAS, con el mismo ancho que renderizará
    libass) nunca exceda el ancho del frame. El ancho manda sobre chunk_size.
    """
    draw = ImageDraw.Draw(Image.new("RGB", (1, 1)))

    lines: list[list[dict]] = []
    i = 0
    n = len(words)
    while i < n:
        line = [words[i]]
        j = i + 1
        while j < n and len(line) < chunk_size:
            if words[j]["start"] - words[j - 1]["end"] > max_gap:
                break
            candidate_text = " ".join(w["text"].upper() for w in line + [words[j]])
            if text_width(draw, candidate_text, font) > max_width_px:
                break
            line.append(words[j])
            j += 1
        lines.append(line)
        i = j
    return lines


def cap_line_end(lines: list[list[dict]], li: int, tail_pad: float = 0.12) -> float:
    """Fin de la línea `li`, sin solaparse nunca con el inicio de la siguiente
    (si no, libass apila ambas líneas en pantalla durante el solape)."""
    end = lines[li][-1]["end"] + tail_pad
    if li + 1 < len(lines):
        end = min(end, lines[li + 1][0]["start"] - 0.02)
    return max(end, lines[li][0]["start"] + 0.05)


def events_current_word(lines: list[list[dict]], color: str) -> list[tuple[float, float, str]]:
    """Un evento POR PALABRA: solo la palabra que se dice en ese instante se
    resalta; las demás del chunk quedan neutras. Sin acumulación."""
    highlight = hex_to_ass(color)
    white = "&H00FFFFFF"
    events = []
    for li, line in enumerate(lines):
        n = len(line)
        for wi, w in enumerate(line):
            start = w["start"]
            if wi + 1 < n:
                end = line[wi + 1]["start"]
            else:
                end = cap_line_end(lines, li)
            end = max(end, start + 0.05)
            text = " ".join(
                f"{{\\c{highlight if wj == wi else white}}}{w2['text'].upper()}"
                for wj, w2 in enumerate(line)
            )
            events.append((start, end, text))
    return events


def events_cumulative(lines: list[list[dict]]) -> list[tuple[float, float, str]]:
    """Relleno progresivo \\kf estilo karaoke clásico — color fijo definido en
    el Style (PrimaryColour); las palabras dichas quedan coloreadas."""
    events = []
    for li, line in enumerate(lines):
        line_start = line[0]["start"]
        line_end = cap_line_end(lines, li)
        parts = []
        cursor = line_start
        for w in line:
            dur_cs = max(1, round((w["end"] - cursor) * 100))
            parts.append(f"{{\\kf{dur_cs}}}{w['text'].upper()}")
            cursor = w["end"]
        events.append((line_start, line_end, " ".join(parts)))
    return events


def events_none(lines: list[list[dict]]) -> list[tuple[float, float, str]]:
    events = []
    for li, line in enumerate(lines):
        text = " ".join(w["text"].upper() for w in line)
        events.append((line[0]["start"], cap_line_end(lines, li), text))
    return events


def build_ass(words, highlight_mode, color, position, chunk_size, width, height) -> str:
    is_portrait = height > width
    font_size = int(height * (0.045 if is_portrait else 0.055))
    alignment = ALIGNMENT.get(position, 2)
    if position == "top":
        margin_v = int(height * (0.10 if is_portrait else 0.06))
    elif position == "middle":
        margin_v = 0
    else:
        margin_v = int(height * (0.18 if is_portrait else 0.09))

    white = "&H00FFFFFF"
    outline = "&H00000000"
    highlight = hex_to_ass(color)

    if highlight_mode == "cumulative":
        primary, secondary = highlight, white
    elif highlight_mode == "none" and color:
        primary, secondary = highlight, white
    else:
        primary, secondary = white, white

    style_line = (
        f"Style: Default,Helvetica,{font_size},{primary},{secondary},{outline},&H80000000,"
        f"-1,0,0,0,100,100,0,0,1,3,1,{alignment},60,60,{margin_v},1"
    )

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
{style_line}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    # Margen de seguridad del 88% del ancho: el stroke/outline del render real
    # añade unos px extra que PIL no modela igual que libass.
    max_width_px = int(width * 0.88)
    font = load_font(font_size)
    lines = group_lines(words, chunk_size, max_width_px, font)

    if highlight_mode == "current_word":
        raw_events = events_current_word(lines, color)
    elif highlight_mode == "cumulative":
        raw_events = events_cumulative(lines)
    else:
        raw_events = events_none(lines)

    events = [
        f"Dialogue: 0,{fmt_time(start)},{fmt_time(end)},Default,,0,0,0,,{text}"
        for start, end, text in raw_events
    ]
    return header + "\n".join(events) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--edl", type=Path, required=True)
    ap.add_argument("--edit-dir", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--highlight-mode", choices=["current_word", "cumulative", "none"], default="none")
    ap.add_argument("--color", default="#FFFFFF")
    ap.add_argument("--position", choices=["top", "middle", "bottom"], default="bottom")
    ap.add_argument("--chunk-size", type=int, default=3)
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument(
        "--transition-overlap", type=float, default=0.0,
        help="Segundos de solape entre cortes (duración del xfade) para compensar offsets",
    )
    args = ap.parse_args()

    edl = json.loads(args.edl.read_text())
    words = collect_output_words(edl, args.edit_dir, transition_overlap=args.transition_overlap)
    if not words:
        sys.exit("no hay palabras en el timeline de salida")

    chunk_size = max(1, min(4, args.chunk_size))
    args.out.write_text(
        build_ass(words, args.highlight_mode, args.color, args.position, chunk_size, args.width, args.height)
    )
    print(f"captions ({args.highlight_mode}, {args.position}) → {args.out.name} ({len(words)} palabras)")


if __name__ == "__main__":
    main()
