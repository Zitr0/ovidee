<div align="center">

# 🎬 Ovidee — Documentation

<sub>🏠 [Home](./README.md) · 🇪🇸 [Español](./README.es.md) · **🇬🇧 English**</sub>

</div>

Create and edit videos by chatting with an AI, **without your material ever leaving your
machine**. Open source (MIT), local-first, and **the only API you need is your LLM's**.

## 📚 Contents

1. [What it can do](#-what-it-can-do)
2. [Install in 3 steps](#-install-in-3-steps)
3. [Security & privacy](#-security--privacy)
4. [Project structure](#-project-structure)
5. [Support the project](#-support-the-project)
6. [License notes](#%EF%B8%8F-license-notes)

## ✨ What it can do

Two ways to start:

- **🎬 Drop your footage** — Ovidee transcribes it locally (Whisper), proposes the edit
  with the AI model you choose, and renders with FFmpeg:
  - Editorial cuts on word boundaries, silence and false-start removal.
  - **Transitions** between cuts (crossfade, dissolve, fades, wipes, slides) and smooth per-range **zooms**.
  - Fully parameterized **karaoke captions** (per-word highlight, color, position, chunk size).
  - **Kinetic titles** (HTML/CSS/GSAP via HyperFrames, with automatic fallback).
  - **Free-form motion graphics**: diagrams, animated data charts, callouts, scenes with
    your transparent PNGs integrated — generated, validated, and rendered with alpha.
- **🌐 Paste a URL** — Ovidee captures the site with your local browser (screenshots, text,
  color palette), chats with you about what you want to achieve, and **generates a video of
  the site** (tour, social clip, product showcase) using its own material and visual identity.

In both cases: you approve the cost before spending a cent, then request changes via chat
to generate new versions (v2, v3…), each with its cost visible.

<sub>[Contents](#-contents) · [Next: Install ›](#-install-in-3-steps)</sub>

## 🚀 Install in 3 steps

You only need 4 base tools. If you already have them, skip to step 3.

### Step 1 — Node.js 22+ and pnpm

```bash
# macOS (with Homebrew: https://brew.sh)
brew install node
corepack enable pnpm

# Windows (with winget) / Linux: install Node 22+ from https://nodejs.org, then:
# corepack enable pnpm
```

### Step 2 — Python 3.10+ and uv

```bash
# macOS
brew install python uv

# Windows / Linux: https://docs.astral.sh/uv/getting-started/installation/
# (uv can install Python for you: `uv python install 3.12`)
```

### Step 3 — Download and start Ovidee

```bash
git clone --recursive https://github.com/Zitr0/ovidee.git
cd ovidee
pnpm install
pnpm dev
```

Open **http://127.0.0.1:3000** and the app guides you through the rest:

1. **Paste your API key** — the app tells you where to get one for your provider
   (Anthropic, OpenAI, Gemini, or DeepSeek). It's the only credential in the whole system.
2. **Review the install checklist** — the app detects what's missing (FFmpeg, Remotion,
   HyperFrames, Whisper model…) and shows you **the exact command and download size** for
   each item. One click on "Install" runs it for you, with a live log.
3. **Drop your video or paste a URL** — calculate the cost, pick the model, approve,
   and receive your `final.mp4`. Request changes via chat to generate version 2, 3…

<sub>[‹ What it can do](#-what-it-can-do) · [Contents](#-contents) · [Next: Security ›](#-security--privacy)</sub>

## 🔒 Security & privacy

- **Your video and audio never leave your machine.** Transcription is local Whisper;
  only text travels to the LLM you choose.
- **URL-based videos are local too:** your (headless) browser visits the URL you choose
  and saves screenshots, text, and palette to your disk — that visit is the feature's only
  network egress. Only text travels to the LLM; the captures are never uploaded.
- Everything runs on `127.0.0.1` (loopback): nothing is exposed to your network.
- Hardened supply chain: **pnpm** with third-party scripts blocked by default
  (`onlyBuiltDependencies`), `minimumReleaseAge: 4320` (rejects packages published less
  than 3 days ago), and lockfiles (`pnpm-lock.yaml`, `engine/uv.lock`) as the single
  source of truth. Nothing installs without your explicit on-screen approval.
- Zero telemetry. See [`PRD.md`](./PRD.md) for the full threat model (in Spanish).

<sub>[‹ Install](#-install-in-3-steps) · [Contents](#-contents) · [Next: Structure ›](#-project-structure)</sub>

## 🗂 Project structure

```
apps/web/        Next.js frontend (onboarding, editor, chat, dashboard) — 127.0.0.1:3000
apps/server/     Fastify orchestrator + SQLite — 127.0.0.1:3001
engine/          Python engine: local Whisper transcription, Scribe-compatible
vendor/video-use Submodule: editing skill (12 Hard Rules, ffmpeg helpers)
scripts/         doctor CLI (equivalent to the in-app checklist)
db/              SQLite schema (projects, versions, API calls, pricing)
THIRD_PARTY_NOTICES.md  License inventory of the installed tools
```

Video projects live in `outputs/video1`, `video2`… and their artifacts
(transcripts, EDL, captures, renders) in `outputs/videoN/edit/` (git-ignored).

<sub>[‹ Security](#-security--privacy) · [Contents](#-contents) · [Next: Support ›](#-support-the-project)</sub>

## ☕ Support the project

Ovidee is free and open source — using it costs nothing. If you find it useful, you can
voluntarily support its development:

[![Buy Me a Coffee](https://img.shields.io/badge/☕_Buy_Me_a_Coffee-support_the_project-FFDD00)](https://buymeacoffee.com/supportprojects)
[![MercadoPago](https://img.shields.io/badge/💛_MercadoPago-Colombia-00B1EA)](https://link.mercadopago.com.co/buymeacoffeecolombia)

Donations never unlock features: all of Ovidee is and will remain free.

<sub>[‹ Structure](#-project-structure) · [Contents](#-contents) · [Next: Licenses ›](#%EF%B8%8F-license-notes)</sub>

## ⚖️ License notes

**Ovidee's code is MIT** — you can use, modify, and redistribute it freely. The tools
Ovidee installs on your machine to unlock its full scope are installed **exactly as each
author publishes them** (the same commands you'd use from the terminal), are not
redistributed with this repository, and each keeps its own license:

- **HyperFrames** (motion-graphics engine: kinetic titles, diagrams, animated charts,
  free-form scenes, website capture) is **Apache 2.0** — fully open source.
- **GSAP** (the animation runtime for those compositions) is **free for all uses,
  including commercial**, but its license is not MIT; that's why it's downloaded once
  from its official distribution during onboarding and kept as a local copy — renders
  never load it from a CDN.
- **Remotion** is *source-available*: free for individuals and teams of up to 3 people;
  larger organizations require a [company license](https://www.remotion.dev/license).
  That obligation is between each user/organization and Remotion — Ovidee does not
  redistribute it.
- **FFmpeg** (LGPL/GPL depending on the build) and **Whisper/faster-whisper** (MIT)
  complete the stack.

The full inventory — who installs what, and which obligations apply — lives in
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md). None of this changes the privacy
promise: transcription is local Whisper, and your audio and video never leave your machine.

---

<div align="center">
<sub>[‹ Support the project](#-support-the-project) · [Contents](#-contents) · 🏠 [Home](./README.md) · 🇪🇸 [Español](./README.es.md)</sub>
</div>
