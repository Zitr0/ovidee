"""Batch-transcribe every video in a directory with local Whisper.

Local replacement for vendor/video-use's transcribe_batch.py: no API key,
sequential transcription (the model saturates CPU/GPU on its own — parallel
model instances only add memory pressure). Cached per-file.

Usage:
    python helpers/transcribe_batch.py <videos_dir>
    python helpers/transcribe_batch.py <videos_dir> --num-speakers 2
    python helpers/transcribe_batch.py <videos_dir> --edit-dir /custom/edit
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from transcribe import DEFAULT_MODEL, transcribe_one

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".m4v"}


def find_videos(videos_dir: Path) -> list[Path]:
    return sorted(
        p for p in videos_dir.iterdir()
        if p.is_file() and p.suffix.lower() in VIDEO_EXTS
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="Batch-transcribe a directory with local Whisper")
    ap.add_argument("videos_dir", type=Path)
    ap.add_argument("--edit-dir", type=Path, default=None)
    ap.add_argument("--language", type=str, default=None)
    ap.add_argument("--num-speakers", type=int, default=None)
    ap.add_argument("--model", type=str, default=DEFAULT_MODEL)
    args = ap.parse_args()

    videos_dir = args.videos_dir.resolve()
    if not videos_dir.is_dir():
        sys.exit(f"not a directory: {videos_dir}")

    videos = find_videos(videos_dir)
    if not videos:
        sys.exit(f"no videos found in {videos_dir}")

    edit_dir = (args.edit_dir or (videos_dir / "edit")).resolve()
    print(f"{len(videos)} video(s) → {edit_dir / 'transcripts'}")

    t0 = time.time()
    for i, video in enumerate(videos, 1):
        print(f"[{i}/{len(videos)}] {video.name}")
        transcribe_one(
            video=video,
            edit_dir=edit_dir,
            language=args.language,
            num_speakers=args.num_speakers,
            model_name=args.model,
        )
    print(f"done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
