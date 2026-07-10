import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs'
import { promisify } from 'node:util'
import path from 'node:path'
import { ROOT } from './env.js'

const execFileP = promisify(execFile)

// GSAP se vendoriza UNA VEZ durante el onboarding (pnpm setup:doctor / setup:install)
// y se copia localmente a cada composición — el render de HyperFrames nunca toca
// la red. Ver PRD §4.4: por diseño, las skills de HyperFrames cargan su motor de
// animación desde CDNs públicos (jsdelivr/unpkg/cdnjs); vendorizar es lo que
// mantiene la promesa de "cero red externa salvo la API del LLM".
export const GSAP_VERSION = '3.14.2'
export const VENDOR_GSAP = path.join(ROOT, '.vendor', `gsap-${GSAP_VERSION}.min.js`)

// Nunca llamar a casa: sin check de skills contra GitHub, sin telemetría anónima.
const HF_ENV = { ...process.env, HYPERFRAMES_SKIP_SKILLS: '1', HYPERFRAMES_NO_TELEMETRY: '1' }

function run(args, cwd) {
  return execFileP('pnpm', ['exec', 'hyperframes', ...args], { cwd, env: HF_ENV, maxBuffer: 1024 * 1024 * 16 })
}

// Acceso al CLI para otros módulos (p. ej. `capture` en web-pipeline.js),
// siempre con las mismas garantías: sin telemetría ni check de skills.
export function runHyperframes(args, cwd = ROOT, opts = {}) {
  return execFileP('pnpm', ['exec', 'hyperframes', ...args], {
    cwd, env: HF_ENV, maxBuffer: 1024 * 1024 * 16, ...opts,
  })
}

let _cached = null
export async function hasHyperframesSupport() {
  if (_cached !== null) return _cached
  if (!existsSync(VENDOR_GSAP)) {
    _cached = false
    return false
  }
  try {
    await run(['--help'], ROOT)
    _cached = true
  } catch {
    _cached = false
  }
  return _cached
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Tipografía cinética: las palabras entran con stagger + easing cúbico, un
// acento de color se dibuja después, y el grupo se desvanece antes del corte.
// Fondo transparente (compuesto sobre el video, no un slate opaco) — igual
// semántica que title_card.py, pero con un motor de animación HTML/CSS real.
function buildTitleComposition({ text, color, duration, position, width, height }) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const wordCount = Math.max(1, words.length)
  const wordsHtml = words.map((w) => `<span class="word">${escapeHtml(w)}</span>`).join(' ')
  const isLower = position === 'lower_third'
  const fontSize = Math.round(height * (isLower ? 0.05 : 0.075))
  const paddingBottom = isLower ? Math.round(height * 0.12) : 0
  const accentWidth = Math.min(Math.round(width * 0.18), 400)
  const stagger = 0.09

  const entranceEnd = 0.15 + wordCount * stagger + 0.55
  const accentStart = Math.min(entranceEnd + 0.05, Math.max(0.3, duration - 0.9))
  const fadeOutStart = Math.min(Math.max(accentStart + 0.6, duration - 0.5), Math.max(duration - 0.3, 0.2))

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>Ovidee Title</title>
    <script src="./vendor/gsap.min.js"></script>
    <style>
      html, body { margin: 0; background: transparent; }
      #root { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; font-family: 'Helvetica Neue', Arial, sans-serif; }
      .clip { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: ${isLower ? 'flex-end' : 'center'}; padding-bottom: ${paddingBottom}px; }
      #headline { margin: 0; font-size: ${fontSize}px; font-weight: 800; color: ${color}; text-align: center; text-shadow: 0 2px 24px rgba(0,0,0,0.45); letter-spacing: -0.01em; }
      #headline .word { display: inline-block; margin: 0 0.14em; }
      #accent { width: 0px; height: ${Math.max(4, Math.round(height * 0.006))}px; background: ${color}; margin-top: ${Math.round(height * 0.02)}px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="title" data-start="0" data-width="${width}" data-height="${height}" data-duration="${duration}">
      <section id="scene" class="clip" data-start="0" data-duration="${duration}" data-track-index="1">
        <h1 id="headline">${wordsHtml}</h1>
        <div id="accent"></div>
      </section>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.from("#headline .word", { y: 40, opacity: 0, duration: 0.55, ease: "power3.out", stagger: ${stagger} }, 0.15);
      tl.fromTo("#accent", { width: 0 }, { width: ${accentWidth}, duration: 0.5, ease: "power2.out" }, ${accentStart});
      tl.to(["#headline", "#accent"], { opacity: 0, duration: 0.35, ease: "power1.in" }, ${fadeOutStart});
      window.__timelines["title"] = tl;
    </script>
  </body>
</html>
`
}

// Prepara un slot HyperFrames limpio con el runtime GSAP local ya copiado
async function initSlot({ slotDir, width, height }) {
  rmSync(slotDir, { recursive: true, force: true })
  mkdirSync(slotDir, { recursive: true })
  await run(
    ['init', slotDir, '--non-interactive', '--example', 'blank', '--resolution', height > width ? 'portrait' : 'landscape'],
    ROOT,
  )
  const vendorDir = path.join(slotDir, 'vendor')
  mkdirSync(vendorDir, { recursive: true })
  copyFileSync(VENDOR_GSAP, path.join(vendorDir, 'gsap.min.js'))
}

// Salvaguarda: si una composición generada referencia GSAP/three/anime desde un
// CDN (las skills upstream lo hacen por diseño), se reescribe a la copia local.
// Cualquier otra URL http(s) hace fallar la composición aquí mismo, antes del
// render — mejor un error claro que una llamada de red silenciosa.
function enforceLocalRuntime(html) {
  const rewritten = html.replace(
    /https?:\/\/[^"'\s]*\/gsap[^"'\s]*\.js/gi,
    './vendor/gsap.min.js',
  )
  // Los namespaces XML (xmlns="http://www.w3.org/…") son identificadores, no requests
  const external = (rewritten.match(/https?:\/\/[^"'\s>)]+/gi) ?? []).filter(
    (u) => !/^https?:\/\/www\.w3\.org\//i.test(u),
  )
  if (external.length > 0) {
    throw new Error(`la composición referencia URLs externas: ${external.slice(0, 3).join(', ')}`)
  }
  return rewritten
}

async function renderSlot({ slotDir, outPath, format = 'mov' }) {
  await run(['lint', '--json'], slotDir)
  await run(['render', '--format', format, '--fps', '24', '--quality', 'standard', '--output', outPath], slotDir)
  if (!existsSync(outPath)) throw new Error('HyperFrames no produjo salida')
  return outPath
}

// Renderiza un título como clip .mov con alfa (ProRes 4444 — verificado: webm
// no preservó transparencia en esta versión de HyperFrames, mov sí). Lanza si
// cualquier paso falla; el llamador debe hacer fallback a title_card.py (PIL).
export async function renderHyperframesTitle({ text, color, duration, position, width, height, slotDir, outPath }) {
  await initSlot({ slotDir, width, height })
  const html = buildTitleComposition({ text, color, duration, position, width, height })
  writeFileSync(path.join(slotDir, 'index.html'), html)
  return renderSlot({ slotDir, outPath })
}

// Bucle agéntico generar → lint → autocorregir → render, común a motion
// graphics (mov con alfa) y videos web completos (mp4 opaco).
// `generate(previousHtml, lintFeedback)` es el llamador al LLM (inyectado
// para que este módulo no conozca la API). Lanza si tras `maxAttempts` la
// composición sigue sin pasar el lint; el llamador decide el fallback.
async function agenticRender({ generate, width, height, slotDir, outPath, format, assetPaths = [], maxAttempts = 3, onAttempt }) {
  await initSlot({ slotDir, width, height })

  if (assetPaths.length > 0) {
    const assetsDir = path.join(slotDir, 'assets')
    mkdirSync(assetsDir, { recursive: true })
    for (const p of assetPaths) copyFileSync(p, path.join(assetsDir, path.basename(p)))
  }

  let html = null
  let lintFeedback = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onAttempt?.(attempt, lintFeedback)
    // Un error de API del LLM sí propaga (no tiene sentido reintentar con él como
    // "feedback"); los errores de URL externa o de lint/render se realimentan.
    const candidate = await generate(html, lintFeedback)
    html = candidate
    try {
      writeFileSync(path.join(slotDir, 'index.html'), enforceLocalRuntime(candidate))
      const rendered = await renderSlot({ slotDir, outPath, format })
      return { outPath: rendered, html: candidate }
    } catch (err) {
      // stdout de `lint --json` viaja en el error de execFile; se recorta para el LLM
      lintFeedback = `${err.stdout ?? ''}\n${err.stderr ?? ''}\n${err.message}`.trim().slice(0, 4000)
    }
  }
  throw new Error(`la composición no pasó lint/render tras ${maxAttempts} intentos: ${lintFeedback?.slice(0, 300)}`)
}

// Motion graphics por descripción libre → .mov ProRes 4444 con alfa (overlay)
export async function renderHyperframesMotion(opts) {
  const { outPath } = await agenticRender({ ...opts, format: 'mov' })
  return outPath
}

// Video web completo (escenas opacas desde una captura de sitio) → .mp4
export function renderHyperframesWebVideo(opts) {
  return agenticRender({ ...opts, format: 'mp4' })
}
