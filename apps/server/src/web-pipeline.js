import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
import path from 'node:path'
import { db } from './db.js'
import { ROOT } from './env.js'
import { generateWebComposition } from './llm.js'
import { hasHyperframesSupport, renderHyperframesWebVideo, runHyperframes } from './hyperframes.js'
import { log, setStatus, resetProgress } from './pipeline.js'

const execFileP = promisify(execFile)

// —— Website → video ——
// El mismo patrón que el pipeline de metraje, con la captura en lugar de la
// transcripción: `hyperframes capture` visita la URL con el navegador local
// (headless) y guarda screenshots, assets, texto visible y tokens de diseño en
// <videos_dir>/capture/. Nada del sitio se sube a ningún lado; al LLM solo
// viaja TEXTO (resumen + paleta), nunca las imágenes.

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'])

function captureDir(project) {
  return path.join(project.videos_dir, 'capture')
}

export function hasCaptureArtifacts(project) {
  return existsSync(path.join(captureDir(project), 'extracted', 'tokens.json'))
}

// Screenshots de scroll (excluye el contact-sheet, que es solo para humanos)
export function listScreenshots(project) {
  const dir = path.join(captureDir(project), 'screenshots')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .sort()
}

export function listSiteAssets(project) {
  const dir = path.join(captureDir(project), 'assets')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
    .sort()
}

// FR-W1: captura local del sitio. Sin costo de LLM — es solo el navegador local.
export async function runWebCapture(projectId) {
  const project = db.prepare('SELECT * FROM video_projects WHERE project_id = ?').get(projectId)
  resetProgress(projectId)
  setStatus(projectId, 'capturing')
  log(projectId, `Capturando ${project.source_url} con tu navegador local (headless) — nada se sube a ningún lado…`)
  try {
    const dir = captureDir(project)
    rmSync(dir, { recursive: true, force: true })
    const { stdout } = await runHyperframes(
      ['capture', project.source_url, '--json', '-o', dir],
      ROOT,
      { timeout: 300_000 },
    )
    const jsonStart = stdout.indexOf('{')
    if (jsonStart < 0) throw new Error('la captura no devolvió JSON')
    const meta = JSON.parse(stdout.slice(jsonStart))
    if (!meta.ok) throw new Error(meta.error ?? 'la captura falló')

    log(projectId, `Captura lista: "${meta.title}" — ${meta.screenshots} screenshot(s), ${meta.assets} asset(s) del sitio.`)
    for (const w of meta.warnings ?? []) log(projectId, `⚠ ${w}`)
    setStatus(projectId, 'captured')
  } catch (err) {
    setStatus(projectId, 'error', { error_message: `captura: ${err.message.slice(0, 300)}` })
    log(projectId, `Error capturando el sitio: ${err.message.slice(0, 300)}`)
  }
}

// Resumen del sitio para el LLM: SOLO texto (título, paleta, tipografía,
// encabezados, texto visible) + los NOMBRES de las imágenes disponibles.
export function buildSiteContext(project) {
  const dir = captureDir(project)
  const tokens = JSON.parse(readFileSync(path.join(dir, 'extracted', 'tokens.json'), 'utf8'))
  let visibleText = ''
  try {
    visibleText = readFileSync(path.join(dir, 'extracted', 'visible-text.txt'), 'utf8').slice(0, 6000)
  } catch {
    /* algunos sitios no producen texto extraíble */
  }

  const colors = (tokens.colorStats ?? [])
    .slice(0, 8)
    .map((c) => `${c.hex}${c.areaBg ? ' (fondo)' : c.textCount ? ' (texto)' : ''}`)
    .join(', ') || (tokens.colors ?? []).join(', ')
  const headings = (tokens.headings ?? [])
    .slice(0, 12)
    .map((h) => `  h${h.level}: ${h.text}`)
    .join('\n')
  const ctas = (tokens.ctas ?? []).slice(0, 8).map((c) => `  - ${c.text ?? c}`).join('\n')

  return `SITIO CAPTURADO: ${project.source_url}
- Título: ${tokens.title ?? project.source_filename}
- Descripción: ${tokens.description || '(sin meta description)'}
- Colores dominantes: ${colors || '(no detectados)'}
- Fuentes del sitio: ${(tokens.fonts ?? []).join(', ') || '(no detectadas — usa fuentes del sistema con carácter similar)'}
- Encabezados reales:
${headings || '  (ninguno)'}
- Llamadas a la acción del sitio:
${ctas || '  (ninguna detectada)'}

TEXTO VISIBLE DEL SITIO (extracto, úsalo como fuente de los textos del video):
${visibleText || '(sin texto extraíble)'}

CAPTURAS DE PANTALLA DEL SITIO (imágenes reales, en ./assets/): ${listScreenshots(project).join(', ') || '(ninguna)'}
IMÁGENES/LOGOS DEL SITIO (en ./assets/): ${listSiteAssets(project).join(', ') || '(ninguna)'}`
}

function currentCost(projectId) {
  return db.prepare('SELECT actual_cost_usd FROM video_projects WHERE project_id = ?').get(projectId)
    .actual_cost_usd
}

// El formato sale del brief (el planner lo deja por escrito); las revisiones
// heredan las dimensiones del render anterior para no cambiar de formato solos.
function pickDims(text) {
  return /(vertical|9\s*[:x]\s*16|reels?|tiktok|shorts|stories|historias)/i.test(text ?? '')
    ? { W: 1080, H: 1920 }
    : { W: 1920, H: 1080 }
}

async function probeDims(filePath) {
  const { stdout } = await execFileP('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', filePath,
  ])
  const [W, H] = stdout.trim().split(',').map(Number)
  return { W, H }
}

async function probeDuration(filePath) {
  const { stdout } = await execFileP('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath,
  ])
  return parseFloat(stdout.trim())
}

// Genera la composición (bucle agéntico lint/autocorrección) y renderiza vN.
async function composeAndRender(project, modelId, { brief, feedback, previousHtml, dims, versionNumber }) {
  const projectId = project.project_id
  const editDir = path.join(project.videos_dir, 'edit')
  mkdirSync(editDir, { recursive: true })

  // Assets hacia el slot: capturas + imágenes del sitio + imágenes del usuario
  const shots = listScreenshots(project).map((f) => path.join(captureDir(project), 'screenshots', f))
  const siteAssets = listSiteAssets(project).map((f) => path.join(captureDir(project), 'assets', f))
  const userAssets = db
    .prepare('SELECT filename FROM project_assets WHERE project_id = ? ORDER BY created_at')
    .all(projectId)
    .map((a) => path.join(project.videos_dir, 'assets', a.filename))
    .filter((p) => existsSync(p))
  const assetPaths = [...shots, ...siteAssets, ...userAssets]
  const assetNames = assetPaths.map((p) => path.basename(p))

  const siteContext = buildSiteContext(project)
  const costBefore = currentCost(projectId)
  const slotDir = path.join(editDir, `web_v${versionNumber}`)
  const outPath = path.join(editDir, `final_v${versionNumber}.mp4`)

  log(projectId, 'El modelo está diseñando la composición del video…')
  let strategy = null
  const result = await renderHyperframesWebVideo({
    generate: async (prevAttempt, lintFeedback) => {
      const res = await generateWebComposition({
        modelId,
        projectId,
        brief,
        siteContext,
        width: dims.W,
        height: dims.H,
        assets: assetNames,
        previousHtml: prevAttempt ?? previousHtml,
        feedback,
        lintFeedback,
      })
      strategy = res.strategy ?? strategy
      return res.html
    },
    width: dims.W,
    height: dims.H,
    slotDir,
    outPath,
    assetPaths,
    onAttempt: (attempt) => {
      if (attempt === 1) setStatus(projectId, 'rendering', { strategy_text: strategy })
      else log(projectId, `Corrigiendo la composición según el lint (intento ${attempt})…`)
    },
  })

  const duration = await probeDuration(result.outPath)
  db.prepare(`
    INSERT INTO video_versions (version_id, project_id, version_number, edl_path, output_path, feedback, cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), projectId, versionNumber,
    path.join(slotDir, 'index.html'), // la composición HTML es el "EDL" de un video web
    result.outPath, feedback ?? null, currentCost(projectId) - costBefore,
  )
  db.prepare('UPDATE video_projects SET video_duration_seconds = ?, strategy_text = ? WHERE project_id = ?')
    .run(duration, strategy, projectId)
  return result.outPath
}

// FR-W2: pipeline completo tras la aprobación (equivalente web de runPipeline)
export async function runWebPipeline(projectId, modelId, instructions) {
  const project = db.prepare('SELECT * FROM video_projects WHERE project_id = ?').get(projectId)
  resetProgress(projectId)
  try {
    if (!(await hasHyperframesSupport()))
      throw new Error('HyperFrames no está instalado — instálalo desde el checklist de instalación')
    if (!hasCaptureArtifacts(project)) throw new Error('no hay captura del sitio — vuelve a crear el proyecto')

    setStatus(projectId, 'editing', { model_id: modelId })
    const dims = pickDims(instructions)
    log(projectId, `Formato: ${dims.W}×${dims.H}.`)
    // El brief se persiste para que las revisiones (vN+1) conserven el objetivo
    mkdirSync(path.join(project.videos_dir, 'edit'), { recursive: true })
    writeFileSync(path.join(project.videos_dir, 'edit', 'brief.txt'), instructions ?? '')
    await composeAndRender(project, modelId, {
      brief: instructions,
      feedback: null,
      previousHtml: null,
      dims,
      versionNumber: 1,
    })
    setStatus(projectId, 'done')
    log(projectId, 'Listo: versión 1 renderizada.')
  } catch (err) {
    setStatus(projectId, 'error', { error_message: err.message.slice(0, 300) })
    log(projectId, `Error: ${err.message.slice(0, 300)}`)
  }
}

// FR-W3: nueva versión desde el feedback del chat (equivalente web de runNewVersion)
export async function runWebNewVersion(projectId, feedback) {
  const project = db.prepare('SELECT * FROM video_projects WHERE project_id = ?').get(projectId)
  const lastVersion = db
    .prepare('SELECT * FROM video_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1')
    .get(projectId)
  if (!lastVersion) throw new Error('no hay versión previa')

  resetProgress(projectId)
  try {
    setStatus(projectId, 'editing')
    const previousHtml = readFileSync(lastVersion.edl_path, 'utf8')
    const dims = await probeDims(lastVersion.output_path)
    let brief = null
    try {
      brief = readFileSync(path.join(project.videos_dir, 'edit', 'brief.txt'), 'utf8') || null
    } catch {
      /* proyectos sin brief guardado: la composición anterior lleva el contexto */
    }
    log(projectId, 'Revisando la composición según tu feedback…')
    await composeAndRender(project, project.model_id, {
      brief,
      feedback,
      previousHtml,
      dims,
      versionNumber: lastVersion.version_number + 1,
    })
    setStatus(projectId, 'done')
    log(projectId, `Versión ${lastVersion.version_number + 1} lista.`)
  } catch (err) {
    setStatus(projectId, 'error', { error_message: err.message.slice(0, 300) })
    log(projectId, `Error: ${err.message.slice(0, 300)}`)
  }
}
