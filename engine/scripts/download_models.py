"""Descarga única de los modelos locales de transcripción (PRD FR0).

Descarga el modelo Whisper (faster-whisper/CTranslate2) al caché de Hugging
Face con verificación de integridad (los archivos LFS se validan por hash).
Nunca corre como postinstall: es un paso explícito (`pnpm setup:models`).

Uso:
    python scripts/download_models.py            # modelo de OVIDEE_WHISPER_MODEL o large-v3
    python scripts/download_models.py --model medium
"""

from __future__ import annotations

import argparse
import os
import sys
import time


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.environ.get("OVIDEE_WHISPER_MODEL", "large-v3"))
    args = ap.parse_args()

    from faster_whisper import download_model

    print(f"descargando modelo Whisper '{args.model}' (una sola vez, con verificación de hash)…")
    t0 = time.time()
    path = download_model(args.model)
    print(f"listo en {time.time() - t0:.0f}s → {path}")

    print(
        "\nnota: la diarización de hablantes es opcional. Para activarla:\n"
        "  uv sync --extra diarization\n"
        "  (pyannote/speaker-diarization-3.1 requiere aceptar términos en Hugging Face\n"
        "   y un token HF solo para la descarga inicial — nunca en runtime)"
    )


if __name__ == "__main__":
    sys.exit(main())
