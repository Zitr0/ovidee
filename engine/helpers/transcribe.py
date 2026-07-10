"""Transcribe a video with local Whisper (faster-whisper). No external APIs.

Drop-in replacement for vendor/video-use's helpers/transcribe.py (ElevenLabs
Scribe): emits the same JSON shape so pack_transcripts.py, timeline_view.py
and render.py --build-subtitles work unmodified:

    {
      "language_code": "es",
      "text": "...",
      "words": [
        {"text": "Hola", "start": 0.52, "end": 0.81, "type": "word", "speaker_id": "speaker_0"},
        {"start": 0.81, "end": 1.62, "type": "spacing"},
        ...
      ]
    }

Verbatim-oriented decoding (PRD §4.5): word_timestamps=True, no phrase/SRT
mode, condition_on_previous_text=False, filler-primed initial prompt.
Silence gaps are carried by explicit "spacing" entries, same as Scribe.

Cached: if the output file already exists, transcription is skipped.

Usage:
    python helpers/transcribe.py <video_path>
    python helpers/transcribe.py <video_path> --edit-dir /custom/edit
    python helpers/transcribe.py <video_path> --language es
    python helpers/transcribe.py <video_path> --model large-v3
    python helpers/transcribe.py <video_path> --num-speakers 2   # requiere extra [diarization]
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

DEFAULT_MODEL = os.environ.get("OVIDEE_WHISPER_MODEL", "large-v3")

# Prompt que empuja al decoder hacia transcripción literal con fillers.
VERBATIM_PROMPT = (
    "Umm, eh, este... o sea, pues... uh, hmm. "
    "Transcripción literal palabra por palabra, incluyendo muletillas y falsos comienzos."
)

# Gap mínimo entre palabras para emitir una entrada "spacing" (segundos).
SPACING_MIN_GAP = 0.05

_model_cache: dict[str, object] = {}


def get_model(name: str):
    """Load a faster-whisper model once per process."""
    if name not in _model_cache:
        from faster_whisper import WhisperModel

        # int8 en CPU (Apple Silicon incluido); float16 si hay CUDA disponible.
        try:
            model = WhisperModel(name, device="cuda", compute_type="float16")
        except Exception:
            model = WhisperModel(name, device="cpu", compute_type="int8")
        _model_cache[name] = model
    return _model_cache[name]


def extract_audio(video_path: Path, dest: Path) -> None:
    cmd = [
        "ffmpeg", "-y", "-i", str(video_path),
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
        str(dest),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def diarize(audio_path: Path, num_speakers: int) -> list[tuple[float, float, str]]:
    """Local speaker diarization via pyannote. Returns (start, end, speaker) turns.

    Optional: requires `uv sync --extra diarization` and a one-time model
    download during setup. Falls back to a single speaker when unavailable.
    """
    try:
        from pyannote.audio import Pipeline
    except ImportError:
        print("  aviso: pyannote no instalado; se asume un solo hablante (speaker_0)", file=sys.stderr)
        return []
    pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1")
    annotation = pipeline(str(audio_path), num_speakers=num_speakers)
    turns = []
    for segment, _, label in annotation.itertracks(yield_label=True):
        turns.append((segment.start, segment.end, label))
    return sorted(turns)


def speaker_at(turns: list[tuple[float, float, str]], t: float) -> str:
    # Formato de Scribe: "speaker_N". pyannote etiqueta "SPEAKER_00" → "speaker_0".
    for start, end, label in turns:
        if start <= t <= end:
            return f"speaker_{int(label.split('_')[-1] or 0)}"
    return "speaker_0"


def transcribe_audio(
    audio_path: Path,
    language: str | None,
    num_speakers: int | None,
    model_name: str,
) -> dict:
    model = get_model(model_name)
    segments, info = model.transcribe(
        str(audio_path),
        language=language,
        word_timestamps=True,
        condition_on_previous_text=False,
        initial_prompt=VERBATIM_PROMPT,
        vad_filter=True,  # evita alucinaciones en silencios largos; los timestamps se re-alinean
    )

    turns = diarize(audio_path, num_speakers) if num_speakers and num_speakers > 1 else []

    words: list[dict] = []
    prev_end: float | None = None
    for segment in segments:
        for w in segment.words or []:
            if prev_end is not None and w.start - prev_end >= SPACING_MIN_GAP:
                words.append({
                    "start": round(prev_end, 3),
                    "end": round(w.start, 3),
                    "type": "spacing",
                })
            words.append({
                "text": w.word.strip(),
                "start": round(w.start, 3),
                "end": round(w.end, 3),
                "type": "word",
                "speaker_id": speaker_at(turns, w.start) if turns else "speaker_0",
                "logprob": round(w.probability, 4),
            })
            prev_end = w.end

    return {
        "language_code": info.language,
        "language_probability": round(info.language_probability, 4),
        "text": " ".join(w["text"] for w in words if w["type"] == "word"),
        "words": words,
        "transcription_info": {
            "engine": "faster-whisper",
            "model": model_name,
            "duration": round(info.duration, 3),
        },
    }


def transcribe_one(
    video: Path,
    edit_dir: Path,
    language: str | None = None,
    num_speakers: int | None = None,
    model_name: str = DEFAULT_MODEL,
    verbose: bool = True,
) -> Path:
    """Transcribe a single video. Returns path to transcript JSON.

    Cached: returns existing path immediately if the transcript already exists.
    """
    transcripts_dir = edit_dir / "transcripts"
    transcripts_dir.mkdir(parents=True, exist_ok=True)
    out_path = transcripts_dir / f"{video.stem}.json"

    if out_path.exists():
        if verbose:
            print(f"cached: {out_path.name}")
        return out_path

    if verbose:
        print(f"  extracting audio from {video.name}", flush=True)

    t0 = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        audio = Path(tmp) / f"{video.stem}.wav"
        extract_audio(video, audio)
        if verbose:
            print(f"  transcribing locally with {model_name}", flush=True)
        payload = transcribe_audio(audio, language, num_speakers, model_name)

    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    dt = time.time() - t0

    if verbose:
        kb = out_path.stat().st_size / 1024
        n_words = sum(1 for w in payload["words"] if w["type"] == "word")
        print(f"  saved: {out_path.name} ({kb:.1f} KB) in {dt:.1f}s — {n_words} words")

    return out_path


def main() -> None:
    ap = argparse.ArgumentParser(description="Transcribe a video with local Whisper")
    ap.add_argument("video", type=Path, help="Path to video file")
    ap.add_argument("--edit-dir", type=Path, default=None,
                    help="Edit output directory (default: <video_parent>/edit)")
    ap.add_argument("--language", type=str, default=None,
                    help="Optional ISO language code (e.g., 'es'). Omit to auto-detect.")
    ap.add_argument("--num-speakers", type=int, default=None,
                    help="Speaker count when known; >1 activates local diarization.")
    ap.add_argument("--model", type=str, default=DEFAULT_MODEL,
                    help=f"Whisper model size (default: {DEFAULT_MODEL})")
    args = ap.parse_args()

    video = args.video.resolve()
    if not video.exists():
        sys.exit(f"video not found: {video}")

    edit_dir = (args.edit_dir or (video.parent / "edit")).resolve()
    transcribe_one(
        video=video,
        edit_dir=edit_dir,
        language=args.language,
        num_speakers=args.num_speakers,
        model_name=args.model,
    )


if __name__ == "__main__":
    main()
