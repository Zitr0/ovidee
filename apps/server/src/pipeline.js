import { spawn, execFile } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { promisify } from 'node:util'
import path from 'node:path'
import { db } from './db.js'
import { ROOT } from './env.js'
import { generateEdl, generateMotionComposition } from './llm.js'
import { hasHyperframesSupport, renderHyperframesTitle, renderHyperframesMotion } from './hyperframes.js'

const ENGINE_DIR = path.join(ROOT, 'engine')
const VENDOR_HELPERS = path.join(ROOT, 'vendor', 'video-use', 'helpers')

// Log de progreso en memoria por proyecto (la UI lo consulta por polling)
const progress = new Map()

export function getProgress(projectId) {
  return progress.get(projectId) ?? []
}

export function resetProgress(projectId) {
  progress.set(projectId, [])
}

// Compartidos con web-pipeline.js (mismo log de progreso y misma tabla)
export function log(projectId, message) {
  const list = progress.get(projectId) ?? []
  list.push({ at: new Date().toISOString(), message })
  progress.set(projectId, list)
}

export function setStatus(projectId, status, extra = {}) {
  const sets = ['execution_status = ?']
  const values = [status]
  for (const [k, v] of Object.entries(extra)) {
    sets.push(`${k} = ?`)
    values.push(v)
  }
  values.push(projectId)
  db.prepare(`UPDATE video_projects SET ${sets.join(', ')} WHERE project_id = ?`).run(...values)
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: process.env })
    let stderr = ''
    child.stderr.on('data', (d) => (stderr += d))
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}: ${stderr.slice(-400)}`)),
    )
    child.on('error', reject)
  })
}

const uv = (args) => run('uv', ['run', '--directory', ENGINE_DIR, 'python', ...args], ENGINE_DIR)
const execFileP = promisify(execFile)

// Los builds mínimos de FFmpeg (p. ej. Homebrew core 8.x) vienen sin libass:
// sin él no se pueden quemar subtítulos. Se detecta una vez por proceso.
let _hasLibass = null
export async function hasSubtitleSupport() {
  if (_hasLibass === null) {
    try {
      const { stdout } = await execFileP('ffmpeg', ['-hide_banner', '-filters'])
      _hasLibass = /\bsubtitles\b/.test(stdout)
    } catch {
      _hasLibass = false
    }
  }
  return _hasLibass
}

function getAssets(projectId) {
  return db.prepare('SELECT * FROM project_assets WHERE project_id = ? ORDER BY created_at').all(projectId)
}

// Dimensiones del render final: render.py escala el lado largo a 1920
async function baseDimensions(sourcePath) {
  const { stdout } = await execFileP('ffprobe', [
    '-v', 'quiet', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', sourcePath,
  ])
  const [w, h] = stdout.trim().split(',').map(Number)
  const even = (n) => 2 * Math.round(n / 2)
  return h > w ? { W: even((1920 * w) / h), H: 1920 } : { W: 1920, H: even((1920 * h) / w) }
}

// Convierte una imagen del usuario en un clip de overlay que render.py compone en (0,0):
// - fullscreen: MP4 opaco del tamaño del frame (cutaway tipo B-roll, el audio sigue debajo)
// - corner: MOV con alfa (codec png), imagen al 25% del ancho en la esquina inferior derecha
async function buildOverlayClip({ assetPath, placement, duration, dims, outPath }) {
  const { W, H } = dims
  if (placement === 'corner') {
    await execFileP('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', `color=c=black@0.0:s=${W}x${H}:r=24:d=${duration},format=rgba`,
      '-loop', '1', '-t', String(duration), '-i', assetPath,
      '-filter_complex',
      `[1:v]scale=${Math.round(W * 0.25)}:-1[img];[0:v][img]overlay=W-w-48:H-h-48,format=rgba`,
      '-c:v', 'png', '-t', String(duration), outPath,
    ])
  } else {
    await execFileP('ffmpeg', [
      '-y',
      '-loop', '1', '-t', String(duration), '-i', assetPath,
      '-vf',
      `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`,
      '-r', '24', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', outPath,
    ])
  }
}

// —— Transiciones y efectos: pre-corte (precut) ——
// render.py concatena sin re-encode, así que las transiciones no pueden vivir ahí.
// Cuando el EDL pide transiciones o efectos, el servidor extrae cada rango como
// segmento uniforme (misma escala/fps/audio que render.py), aplica el efecto de
// cámara simulada por segmento, y une todo con xfade/acrossfade en un solo
// "precut.mp4". render.py recibe entonces un EDL de un único rango sobre el
// precut y sigue haciendo lo suyo (grade, overlays, loudnorm) sin enterarse.

const XFADE_TRANSITIONS = {
  crossfade: 'fade',
  dissolve: 'dissolve',
  fade_black: 'fadeblack',
  fade_white: 'fadewhite',
  wipe_left: 'wipeleft',
  wipe_right: 'wiperight',
  slide_up: 'slideup',
  slide_down: 'slidedown',
  circle_open: 'circleopen',
}

// Igual que render.py: fuentes HLG/PQ (iPhone) se tone-mapean a SDR Rec.709
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67'])
const TONEMAP_CHAIN =
  'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,' +
  'tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p'

async function isHdrSource(sourcePath) {
  try {
    const { stdout } = await execFileP('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=color_transfer',
      '-of', 'default=noprint_wrappers=1:nokey=1', sourcePath,
    ])
    return HDR_TRANSFERS.has(stdout.trim())
  } catch {
    return false
  }
}

async function probeDuration(filePath) {
  const { stdout } = await execFileP('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath,
  ])
  return parseFloat(stdout.trim())
}

// Zoom suave centrado (punch-in/out hasta 12%). Se escala a 2x antes de zoompan
// para precisión subpixel — sin eso el zoom "tiembla" a pasos de píxel entero.
function zoomChain(effect, duration, W, H) {
  const frames = Math.max(1, Math.round(duration * 24))
  const target = 1.12
  const rate = ((target - 1) / frames).toFixed(6)
  const z =
    effect === 'zoom_in'
      ? `min(1+${rate}*on,${target})`
      : `max(${target}-${rate}*on,1)`
  return (
    `scale=${W * 2}:${H * 2},` +
    `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=24`
  )
}

// Extrae los rangos como segmentos uniformes y los une (xfade o concat).
// Devuelve la ruta del precut. Los tiempos de captions/overlays se compensan
// con transitionOverlap en el llamador.
export async function buildPrecut({ ranges, sourcePath, transitions, dims, workDir, onLog }) {
  const { W, H } = dims
  mkdirSync(workDir, { recursive: true })
  const hdr = await isHdrSource(sourcePath)

  const segPaths = []
  for (const [i, r] of ranges.entries()) {
    const duration = r.end - r.start
    const vfParts = []
    if (hdr) vfParts.push(TONEMAP_CHAIN)
    if (r.effect === 'zoom_in' || r.effect === 'zoom_out') {
      vfParts.push(zoomChain(r.effect, duration, W, H))
    } else {
      vfParts.push(`scale=${W}:${H}`)
    }
    vfParts.push('setsar=1')
    const segPath = path.join(workDir, `seg_${String(i).padStart(2, '0')}.mp4`)
    onLog?.(`  · segmento ${i + 1}/${ranges.length}${r.effect && r.effect !== 'none' ? ` (${r.effect})` : ''}`)
    await execFileP('ffmpeg', [
      '-y', '-ss', r.start.toFixed(3), '-i', sourcePath, '-t', duration.toFixed(3),
      '-vf', vfParts.join(','),
      '-r', '24', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-movflags', '+faststart', segPath,
    ], { maxBuffer: 1024 * 1024 * 16 })
    segPaths.push(segPath)
  }

  const precutPath = path.join(workDir, 'precut.mp4')
  const xfade = XFADE_TRANSITIONS[transitions?.type]

  if (!xfade || segPaths.length < 2) {
    // Sin transiciones: concat sin re-encode (los segmentos ya son uniformes)
    const listPath = path.join(workDir, 'concat.txt')
    writeFileSync(listPath, segPaths.map((p) => `file '${p}'\n`).join(''))
    await execFileP('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
      '-c', 'copy', '-movflags', '+faststart', precutPath,
    ])
    return { precutPath, overlap: 0 }
  }

  // Duración real de cada segmento (ffprobe) para offsets exactos del xfade
  const durations = []
  for (const p of segPaths) durations.push(await probeDuration(p))
  const minDur = Math.min(...durations)
  const t = Math.min(Math.max(0.2, transitions.duration || 0.5), 1.0, minDur / 2)

  const inputs = segPaths.flatMap((p) => ['-i', p])
  const parts = []
  let vPrev = '[0:v]'
  let aPrev = '[0:a]'
  let elapsed = durations[0]
  for (let i = 1; i < segPaths.length; i++) {
    const offset = (elapsed - t).toFixed(3)
    const vOut = i === segPaths.length - 1 ? '[vout]' : `[v${i}]`
    const aOut = i === segPaths.length - 1 ? '[aout]' : `[a${i}]`
    parts.push(`${vPrev}[${i}:v]xfade=transition=${xfade}:duration=${t}:offset=${offset}${vOut}`)
    parts.push(`${aPrev}[${i}:a]acrossfade=d=${t}${aOut}`)
    vPrev = vOut
    aPrev = aOut
    elapsed += durations[i] - t
  }

  onLog?.(`  · uniendo ${segPaths.length} segmentos con "${transitions.type}" (${t}s)…`)
  await execFileP('ffmpeg', [
    '-y', ...inputs,
    '-filter_complex', parts.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-r', '24', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart', precutPath,
  ], { maxBuffer: 1024 * 1024 * 16 })
  return { precutPath, overlap: t }
}

async function transcribeAndPack(project) {
  const editDir = path.join(project.videos_dir, 'edit')
  const source = path.join(project.videos_dir, project.source_filename)

  log(project.project_id, 'Transcribiendo localmente con Whisper (tu audio no sale de tu máquina)…')
  const t0 = Date.now()
  await uv(['helpers/transcribe.py', source, '--edit-dir', editDir])
  const elapsed = (Date.now() - t0) / 1000
  db.prepare('UPDATE video_projects SET transcription_seconds_elapsed = transcription_seconds_elapsed + ? WHERE project_id = ?')
    .run(elapsed, project.project_id)

  log(project.project_id, 'Empaquetando transcript…')
  await uv([path.join(VENDOR_HELPERS, 'pack_transcripts.py'), '--edit-dir', editDir])
  return readFileSync(path.join(editDir, 'takes_packed.md'), 'utf8')
}

async function renderVersion(project, edl, versionNumber, feedback, cost, modelId) {
  const editDir = path.join(project.videos_dir, 'edit')
  const sourceStem = path.parse(project.source_filename).name
  const sourcePath = path.join(project.videos_dir, project.source_filename)

  const dims = await baseDimensions(sourcePath)
  const clipsDir = path.join(editDir, 'asset_clips', `v${versionNumber}`)

  // Transiciones/efectos requieren el pre-corte; sin ellos, render.py corta directo
  const wantsTransitions =
    edl.transitions?.type && edl.transitions.type !== 'none' && edl.ranges.length > 1
  const wantsEffects = edl.ranges.some((r) => r.effect && r.effect !== 'none')
  let precut = null
  if (wantsTransitions || wantsEffects) {
    log(
      project.project_id,
      wantsTransitions
        ? `Aplicando transiciones "${edl.transitions.type}"${wantsEffects ? ' y efectos de cámara' : ''}…`
        : 'Aplicando efectos de cámara (zoom)…',
    )
    precut = await buildPrecut({
      ranges: edl.ranges,
      sourcePath,
      transitions: wantsTransitions ? edl.transitions : null,
      dims,
      workDir: path.join(clipsDir, 'precut'),
      onLog: (m) => log(project.project_id, m),
    })
  }

  // Con transiciones el video real dura (n-1)×overlap menos que la suma de rangos
  const totalDuration =
    edl.total_duration_s - (precut ? (edl.ranges.length - 1) * precut.overlap : 0)

  // Overlays: convierte los assets de imagen elegidos por el LLM en clips componibles
  const assets = getAssets(project.project_id)
  const overlayEntries = []
  const requested = (edl.overlays ?? []).filter((o) =>
    assets.some((a) => a.filename === o.asset),
  )
  if (requested.length > 0) {
    log(project.project_id, `Preparando ${requested.length} overlay(s) de imagen…`)
    mkdirSync(clipsDir, { recursive: true })
    for (const [i, o] of requested.entries()) {
      const start = Math.min(Math.max(0, o.start_in_output), Math.max(0, totalDuration - 1.5))
      const duration = Math.max(1.5, Math.min(o.duration, totalDuration - start))
      const ext = o.placement === 'corner' ? 'mov' : 'mp4'
      const clipPath = path.join(clipsDir, `overlay_${i}.${ext}`)
      await buildOverlayClip({
        assetPath: path.join(project.videos_dir, 'assets', o.asset),
        placement: o.placement,
        duration,
        dims,
        outPath: clipPath,
      })
      overlayEntries.push({ file: clipPath, start_in_output: start, duration })
    }
  }

  // Títulos animados: HyperFrames (tipografía cinética real vía HTML/CSS/GSAP,
  // con GSAP vendorizado localmente — cero red externa) como motor primario;
  // si no está disponible o falla CUALQUIER paso, respaldo automático a
  // title_card.py (PIL: fade-in + desplazamiento). Nunca rompe el render.
  const titles = (edl.titles ?? []).filter((t) => t.text?.trim())
  if (titles.length > 0) {
    log(project.project_id, `Generando ${titles.length} título(s) animado(s)…`)
    mkdirSync(clipsDir, { recursive: true })
    const useHyperframes = await hasHyperframesSupport()
    for (const [i, t] of titles.entries()) {
      const start = Math.min(Math.max(0, t.start_in_output), Math.max(0, totalDuration - 1))
      const duration = Math.max(1.5, Math.min(t.duration, totalDuration - start))
      const clipPath = path.join(clipsDir, `title_${i}.mov`)
      const position = t.position === 'lower_third' ? 'lower_third' : 'center'
      const color = t.color || '#FFFFFF'

      let usedHyperframes = false
      if (useHyperframes) {
        try {
          await renderHyperframesTitle({
            text: t.text.trim(), color, duration, position,
            width: dims.W, height: dims.H,
            slotDir: path.join(clipsDir, `hf_title_${i}`),
            outPath: clipPath,
          })
          usedHyperframes = true
        } catch (err) {
          log(project.project_id, `⚠ HyperFrames falló en el título ${i + 1} (${err.message.slice(0, 140)}); usando título simple.`)
        }
      }
      if (!usedHyperframes) {
        await uv([
          'helpers/title_card.py', '--text', t.text.trim(), '--out', clipPath,
          '--width', String(dims.W), '--height', String(dims.H),
          '--duration', String(duration), '--color', color, '--position', position,
        ])
      }
      overlayEntries.push({ file: clipPath, start_in_output: start, duration })
    }
  }

  // Motion graphics por descripción libre: bucle agéntico HyperFrames
  // (LLM genera la composición → lint → autocorrección → render .mov con alfa).
  // Cada escena que falle se omite con aviso — nunca rompe el render.
  const motions = (edl.motion_graphics ?? []).filter((m) => m.description?.trim())
  if (motions.length > 0) {
    if (await hasHyperframesSupport()) {
      log(project.project_id, `Generando ${motions.length} motion graphic(s) por descripción…`)
      mkdirSync(clipsDir, { recursive: true })
      for (const [i, m] of motions.entries()) {
        const start = Math.min(Math.max(0, m.start_in_output), Math.max(0, totalDuration - 2))
        const duration = Math.max(2, Math.min(m.duration, totalDuration - start))
        const assetNames = (m.assets ?? []).filter((name) =>
          assets.some((a) => a.filename === name),
        )
        try {
          const clipPath = path.join(clipsDir, `motion_${i}.mov`)
          await renderHyperframesMotion({
            generate: (previousHtml, lintFeedback) =>
              generateMotionComposition({
                modelId, projectId: project.project_id,
                description: m.description, width: dims.W, height: dims.H, duration,
                assets: assetNames, previousHtml, lintFeedback,
              }),
            width: dims.W, height: dims.H,
            slotDir: path.join(clipsDir, `hf_motion_${i}`),
            outPath: clipPath,
            assetPaths: assetNames.map((name) => path.join(project.videos_dir, 'assets', name)),
            onAttempt: (attempt) => {
              if (attempt > 1) log(project.project_id, `  · motion graphic ${i + 1}: corrigiendo composición (intento ${attempt})…`)
            },
          })
          overlayEntries.push({ file: clipPath, start_in_output: start, duration })
        } catch (err) {
          log(project.project_id, `⚠ Motion graphic ${i + 1} omitido (${err.message.slice(0, 140)}). El resto del render continúa.`)
        }
      }
    } else {
      log(project.project_id, '⚠ HyperFrames no está instalado: los motion graphics se omiten. Instálalo desde el checklist de instalación.')
    }
  }

  // El LLM devuelve solo el plan; el servidor arma el EDL de render completo
  // (Hard Rule: paths absolutos). Con precut, el render ve un único rango ya
  // cortado/transicionado; el plan original se conserva aparte para el chat
  // de iteración y para los captions (que necesitan los rangos originales).
  const fullEdl = precut
    ? {
        version: 1,
        sources: { precut: precut.precutPath },
        ranges: [{ source: 'precut', start: 0, end: totalDuration, beat: 'FULL', reason: 'transiciones y efectos pre-aplicados' }],
        grade: edl.grade,
        overlays: overlayEntries,
        total_duration_s: totalDuration,
      }
    : {
        version: 1,
        sources: { [sourceStem]: sourcePath },
        ranges: edl.ranges.map((r) => ({ ...r, source: sourceStem })),
        grade: edl.grade,
        overlays: overlayEntries,
        total_duration_s: totalDuration,
      }

  // edl_vN.json = plan del LLM (rangos originales, títulos, captions, transiciones):
  // es lo que se le muestra al LLM en el chat y lo que usan los captions.
  // render_vN.json = EDL ejecutable que consume render.py.
  const planEdl = { ...edl, ranges: edl.ranges.map((r) => ({ ...r, source: sourceStem })) }
  const edlPath = path.join(editDir, `edl_v${versionNumber}.json`)
  const renderEdlPath = path.join(editDir, `render_v${versionNumber}.json`)
  const outputPath = path.join(editDir, `final_v${versionNumber}.mp4`)
  writeFileSync(edlPath, JSON.stringify(planEdl, null, 2))
  writeFileSync(renderEdlPath, JSON.stringify(fullEdl, null, 2))

  // Captions propios (parámetros libres: chunk_size, highlight_mode, color,
  // position) — se queman DESPUÉS de los overlays (Hard Rule 1) con libass
  let captions = edl.captions?.enabled ? edl.captions : null
  if (captions && !(await hasSubtitleSupport())) {
    captions = null
    log(project.project_id, '⚠ Tu FFmpeg no incluye libass (captions). En macOS: brew install ffmpeg-full. Renderizando sin captions.')
  }

  log(project.project_id, `Renderizando versión ${versionNumber} (ffmpeg)…`)
  await uv([path.join(VENDOR_HELPERS, 'render.py'), renderEdlPath, '-o', outputPath, '--no-subtitles'])
  if (!existsSync(outputPath)) throw new Error('el render no produjo salida')

  if (captions) {
    log(project.project_id, `Quemando captions (${captions.highlight_mode}, ${captions.position}, ${captions.chunk_size} palabras)…`)
    const assPath = path.join(editDir, `captions_v${versionNumber}.ass`)
    await uv([
      'helpers/captions.py', '--edl', edlPath, '--edit-dir', editDir, '--out', assPath,
      '--transition-overlap', String(precut?.overlap ?? 0),
      '--highlight-mode', captions.highlight_mode || 'none',
      '--color', captions.color || '#FFFFFF',
      '--position', captions.position || 'bottom',
      '--chunk-size', String(captions.chunk_size || 3),
      '--width', String(dims.W), '--height', String(dims.H),
    ])
    const captioned = path.join(editDir, `final_v${versionNumber}.captioned.mp4`)
    await execFileP('ffmpeg', [
      '-y', '-i', outputPath, '-vf', `ass=${assPath}`,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'copy', '-movflags', '+faststart', captioned,
    ])
    await execFileP('mv', [captioned, outputPath])
  }
  db.prepare(`
    INSERT INTO video_versions (version_id, project_id, version_number, edl_path, output_path, feedback, cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), project.project_id, versionNumber, edlPath, outputPath, feedback ?? null, cost)
  return outputPath
}

// FR6/FR5: pipeline completo tras la aprobación del usuario
export async function runPipeline(projectId, modelId, instructions) {
  const project = db.prepare('SELECT * FROM video_projects WHERE project_id = ?').get(projectId)
  progress.set(projectId, [])
  try {
    setStatus(projectId, 'transcribing', { model_id: modelId })
    const packed = await transcribeAndPack(project)

    setStatus(projectId, 'editing')
    log(projectId, 'El modelo está proponiendo la estrategia de edición…')
    const costBefore = currentCost(projectId)
    const edl = await generateEdl({
      modelId,
      projectId,
      packedTranscript: packed,
      assets: getAssets(projectId),
      instructions,
    })
    log(projectId, `Estrategia: ${edl.strategy}`)

    setStatus(projectId, 'rendering', { strategy_text: edl.strategy })
    await renderVersion(project, edl, 1, instructions, currentCost(projectId) - costBefore, modelId)

    setStatus(projectId, 'done')
    log(projectId, 'Listo: versión 1 renderizada.')
  } catch (err) {
    setStatus(projectId, 'error', { error_message: err.message })
    log(projectId, `Error: ${err.message}`)
  }
}

// FR7: nueva versión a partir del feedback aprobado en el chat
export async function runNewVersion(projectId, feedback) {
  const project = db.prepare('SELECT * FROM video_projects WHERE project_id = ?').get(projectId)
  const lastVersion = db
    .prepare('SELECT * FROM video_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1')
    .get(projectId)
  if (!lastVersion) throw new Error('no hay versión previa')

  const editDir = path.join(project.videos_dir, 'edit')
  const packed = readFileSync(path.join(editDir, 'takes_packed.md'), 'utf8')
  const previousEdl = JSON.parse(readFileSync(lastVersion.edl_path, 'utf8'))

  setStatus(projectId, 'editing')
  try {
    log(projectId, `Generando EDL revisado según tu feedback…`)
    const costBefore = currentCost(projectId)
    const edl = await generateEdl({
      modelId: project.model_id,
      projectId,
      packedTranscript: packed,
      assets: getAssets(projectId),
      previousEdl,
      feedback,
    })
    setStatus(projectId, 'rendering', { strategy_text: edl.strategy })
    await renderVersion(project, edl, lastVersion.version_number + 1, feedback, currentCost(projectId) - costBefore, project.model_id)
    setStatus(projectId, 'done')
    log(projectId, `Versión ${lastVersion.version_number + 1} lista.`)
  } catch (err) {
    setStatus(projectId, 'error', { error_message: err.message })
    log(projectId, `Error: ${err.message}`)
  }
}

function currentCost(projectId) {
  return db.prepare('SELECT actual_cost_usd FROM video_projects WHERE project_id = ?').get(projectId)
    .actual_cost_usd
}
