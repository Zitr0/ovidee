#!/usr/bin/env node
// setup:doctor — verifica los prerrequisitos obligatorios (PRD FR0).
// Termina con una verificación real (render de 1s + ffprobe), no solo
// chequeos de existencia.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = []

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function check(name, mandatory, fn, hint) {
  try {
    const detail = fn()
    results.push({ name, ok: true, detail, mandatory })
  } catch {
    results.push({ name, ok: false, detail: hint, mandatory })
  }
}

check('Node.js ≥ 22', true, () => {
  const major = Number(process.versions.node.split('.')[0])
  if (major < 22) throw new Error()
  return `v${process.versions.node}`
}, 'instala Node 22+ (nvm install 22)')

check('pnpm ≥ 10', true, () => {
  const v = run('pnpm', ['--version'])
  if (Number(v.split('.')[0]) < 10) throw new Error()
  return `v${v}`
}, 'corepack enable pnpm')

check('FFmpeg', true, () => run('ffmpeg', ['-version']).split('\n')[0].split(' ').slice(0, 3).join(' '),
  'brew install ffmpeg  (macOS) / apt-get install -y ffmpeg (Debian)')

check('FFprobe', true, () => run('ffprobe', ['-version']).split('\n')[0].split(' ').slice(0, 3).join(' '),
  'se instala junto con ffmpeg')

check('uv (Python)', true, () => run('uv', ['--version']),
  'brew install uv / curl -LsSf https://astral.sh/uv/install.sh | sh')

check('Motor Python (engine/.venv)', true, () => {
  if (!existsSync(path.join(ROOT, 'engine', '.venv'))) throw new Error()
  return 'sincronizado'
}, 'cd engine && uv sync')

check('Submódulo video-use', true, () => {
  if (!existsSync(path.join(ROOT, 'vendor', 'video-use', 'SKILL.md'))) throw new Error()
  return 'vendor/video-use'
}, 'git submodule update --init --recursive')

check('Remotion CLI', true, () => {
  const bin = path.join(ROOT, 'node_modules', '.bin', 'remotion')
  if (!existsSync(bin)) throw new Error()
  return run(bin, ['versions']).split('\n')[0] || 'instalado'
}, 'pnpm install --frozen-lockfile')

check('Chromium de Remotion', true, () => {
  const dir = path.join(ROOT, 'node_modules', '.remotion')
  const alt = path.join(homedir(), '.remotion')
  if (!existsSync(dir) && !existsSync(alt)) throw new Error()
  return 'headless browser presente'
}, 'pnpm setup:browser  (descarga explícita, nunca postinstall)')

check('Modelo Whisper local', true, () => {
  const hub = path.join(homedir(), '.cache', 'huggingface', 'hub')
  if (!existsSync(hub)) throw new Error()
  const models = readdirSync(hub).filter((d) => /faster-whisper/i.test(d))
  if (models.length === 0) throw new Error()
  return models.join(', ').slice(0, 60)
}, 'pnpm setup:models')

check('GSAP vendorizado (títulos HyperFrames)', false, () => {
  if (!existsSync(path.join(ROOT, '.vendor', 'gsap-3.14.2.min.js'))) throw new Error()
  return 'presente — los títulos usan tipografía cinética'
}, 'opcional — instálalo con un clic desde el onboarding de la app, o los títulos usan un fade simple')

check('.env con API key del LLM', false, () => {
  if (!existsSync(path.join(ROOT, '.env'))) throw new Error()
  return 'presente'
}, 'cp .env.example .env y agrega tu API key (única API necesaria)')

// —— Verificación real: render de 1s vía ffmpeg + ffprobe del resultado ——
check('Render de prueba (1s, real)', true, () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'ove-doctor-'))
  try {
    const out = path.join(tmp, 'test.mp4')
    run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x180:rate=24',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-shortest',
      '-pix_fmt', 'yuv420p', out])
    const dur = run('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration',
      '-of', 'csv=p=0', out])
    if (Math.abs(Number(dur) - 1) > 0.2) throw new Error()
    return `ok (${Number(dur).toFixed(2)}s)`
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}, 'el pipeline ffmpeg no produce salida válida — revisa la instalación')

// —— Reporte ——
let failed = 0
console.log('\nOvidee — doctor\n')
for (const r of results) {
  const icon = r.ok ? '✅' : r.mandatory ? '❌' : '⚠️ '
  if (!r.ok && r.mandatory) failed++
  console.log(`${icon} ${r.name.padEnd(32)} ${r.detail ?? ''}`)
}
console.log()
if (failed > 0) {
  console.error(`${failed} requisito(s) obligatorio(s) faltante(s). El pipeline no puede arrancar.`)
  process.exit(1)
}
console.log('Todo listo. Ejecuta `pnpm dev` y abre http://127.0.0.1:3000')
