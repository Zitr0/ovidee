import { randomBytes, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { pipeline as streamPipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import websocket from '@fastify/websocket'

import { loadEnv, saveApiKey, detectProvider, PROVIDERS, ROOT } from './env.js'
import { db } from './db.js'
import { getChecks, startInstall, getInstallStatus } from './setup.js'
import { seedModels, listModels, getModel, estimateCost, estimateWebCost } from './models.js'
import { runPipeline, runNewVersion, getProgress } from './pipeline.js'
import {
  runWebCapture, runWebPipeline, runWebNewVersion,
  buildSiteContext, hasCaptureArtifacts, listScreenshots,
} from './web-pipeline.js'
import { chatAboutEdit, planEdit, chatAboutWebVideo, planWebVideo } from './llm.js'

loadEnv()
seedModels()

const execFileP = promisify(execFile)
const PORT = Number(process.env.OVIDEE_SERVER_PORT ?? 3001)
const HOST = '127.0.0.1' // NFR: solo loopback
const SESSION_TOKEN = randomBytes(32).toString('hex')
// Los proyectos viven dentro del repo, en outputs/video1, video2… (gitignored)
const PROJECTS_ROOT = path.join(ROOT, 'outputs')

function nextProjectDir() {
  let n = db.prepare('SELECT COUNT(*) AS c FROM video_projects').get().c + 1
  while (existsSync(path.join(PROJECTS_ROOT, `video${n}`))) n++
  return path.join(PROJECTS_ROOT, `video${n}`)
}

// Historial de chat por proyecto (en memoria; se reinicia con el servidor)
const chatHistory = new Map()
// Chat de planeación PRE-render (antes de aprobar), separado del chat post-render
const planHistory = new Map()

const app = Fastify({ logger: { level: 'info' }, bodyLimit: 10 * 1024 * 1024 })
await app.register(cors, {
  origin: ['http://127.0.0.1:3000', 'http://localhost:3000'],
  // el default del plugin es GET,HEAD,POST — sin DELETE el preflight falla ("Failed to fetch")
  methods: ['GET', 'HEAD', 'POST', 'DELETE'],
})
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 * 1024 } }) // videos hasta 10 GB
await app.register(websocket)

// —— Salud y sesión ——
app.get('/api/health', async () => ({ status: 'ok', loopbackOnly: true }))
app.get('/api/session', async () => ({ token: SESSION_TOKEN }))

// —— Onboarding (FR0 + FR2) ——
app.get('/api/setup/state', async () => {
  const provider = detectProvider()
  const checks = await getChecks()
  return {
    hasApiKey: Boolean(provider),
    provider: provider ? { provider: provider.provider, name: provider.name, maskedKey: provider.maskedKey } : null,
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({
      id, name: p.name, keyUrl: p.keyUrl, supported: p.supported,
    })),
    checks: checks.map(({ execArgs, ...c }) => c), // nunca exponer los argv internos
    allInstalled: checks.every((c) => c.installed || c.optional),
  }
})

app.post('/api/setup/apikey', async (req, reply) => {
  const { provider, key } = req.body ?? {}
  if (!PROVIDERS[provider]) return reply.code(400).send({ error: 'proveedor inválido' })
  if (!PROVIDERS[provider].supported)
    return reply.code(400).send({ error: 'este proveedor llega pronto — por ahora usa Anthropic' })
  try {
    return saveApiKey(provider, key ?? '')
  } catch (err) {
    return reply.code(400).send({ error: err.message })
  }
})

app.post('/api/setup/install', async (req, reply) => {
  try {
    return await startInstall(req.body?.ids ?? [])
  } catch (err) {
    return reply.code(409).send({ error: err.message })
  }
})

app.get('/api/setup/install/status', async () => getInstallStatus())

// —— Modelos (FR4 + panel de configuración) ——
app.get('/api/models', async () => listModels())

// —— Proyectos (FR6) —— paginados de a 5, sin los eliminados
const PAGE_SIZE = 5

app.get('/api/projects', async (req) => {
  const page = Math.max(1, Number(req.query.page ?? 1))
  const { total } = db
    .prepare('SELECT COUNT(*) AS total FROM video_projects WHERE deleted_at IS NULL')
    .get()
  const projects = db
    .prepare('SELECT * FROM video_projects WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(PAGE_SIZE, (page - 1) * PAGE_SIZE)
  return { projects, total, page, pageSize: PAGE_SIZE }
})

// Soft delete: conserva el registro y sus api_calls (historial de costos del
// dashboard); borra los archivos del workspace para liberar disco.
app.delete('/api/projects/:id', async (req, reply) => {
  const project = db.prepare('SELECT * FROM video_projects WHERE project_id = ?').get(req.params.id)
  if (!project || project.deleted_at) return reply.code(404).send({ error: 'proyecto no encontrado' })
  if (['capturing', 'transcribing', 'editing', 'rendering'].includes(project.execution_status))
    return reply.code(409).send({ error: 'espera a que termine el pipeline antes de eliminar' })

  // Seguridad: solo borrar directorios dentro de outputs/
  const resolved = path.resolve(project.videos_dir)
  if (resolved.startsWith(PROJECTS_ROOT + path.sep)) {
    await rm(resolved, { recursive: true, force: true })
  }
  db.prepare(`UPDATE video_projects SET deleted_at = CURRENT_TIMESTAMP WHERE project_id = ?`).run(req.params.id)
  chatHistory.delete(req.params.id)
  planHistory.delete(req.params.id)
  return { deleted: true, costPreservedUsd: project.actual_cost_usd }
})

app.post('/api/projects', async (req, reply) => {
  const file = await req.file()
  if (!file) return reply.code(400).send({ error: 'sube un archivo de video' })

  const projectId = randomUUID()
  const videosDir = nextProjectDir()
  mkdirSync(videosDir, { recursive: true })
  const safeName = path.basename(file.filename).replace(/[^\w.\-]/g, '_')
  const dest = path.join(videosDir, safeName)
  await streamPipeline(file.file, createWriteStream(dest))

  let duration = 0
  try {
    const { stdout } = await execFileP('ffprobe', [
      '-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', dest,
    ])
    duration = Number(stdout.trim())
  } catch {
    return reply.code(400).send({ error: 'no se pudo leer el video — ¿está instalado FFprobe? (revisa el onboarding)' })
  }

  db.prepare(`
    INSERT INTO video_projects (project_id, videos_dir, source_filename, video_duration_seconds, execution_status)
    VALUES (?, ?, ?, ?, 'uploaded')
  `).run(projectId, videosDir, safeName, duration)

  return { projectId, durationSeconds: duration, filename: safeName }
})

// FR-W1: proyecto web — el video se GENERA desde una URL (captura local del
// sitio con el navegador headless + composición HyperFrames). La captura
// arranca de inmediato: no usa el LLM, así que no cuesta nada.
app.post('/api/projects/web', async (req, reply) => {
  let url
  try {
    url = new URL((req.body?.url ?? '').trim())
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
  } catch {
    return reply.code(400).send({ error: 'pega una URL válida (http/https)' })
  }

  const projectId = randomUUID()
  const videosDir = nextProjectDir()
  mkdirSync(videosDir, { recursive: true })

  db.prepare(`
    INSERT INTO video_projects
      (project_id, videos_dir, project_type, source_url, source_filename, video_duration_seconds, execution_status)
    VALUES (?, ?, 'web', ?, ?, 0, 'capturing')
  `).run(projectId, videosDir, url.href, url.hostname)

  runWebCapture(projectId) // async, sin await
  return { projectId, url: url.href }
})

// Captura del sitio para la UI: screenshots + resumen (solo lectura local)
app.get('/api/projects/:id/capture', async (req, reply) => {
  const project = db.prepare('SELECT * FROM video_projects WHERE project_id = ?').get(req.params.id)
  if (!project || project.project_type !== 'web') return reply.code(404).send({ error: 'proyecto web no encontrado' })
  if (!hasCaptureArtifacts(project)) return { ready: false, screenshots: [] }
  return { ready: true, screenshots: listScreenshots(project) }
})

app.get('/api/projects/:id/capture/screenshots/:name', async (req, reply) => {
  const project = db.prepare('SELECT * FROM video_projects WHERE project_id = ?').get(req.params.id)
  const name = path.basename(req.params.name)
  if (!project || project.project_type !== 'web' || !name.endsWith('.png'))
    return reply.code(404).send({ error: 'captura no encontrada' })
  const file = path.join(project.videos_dir, 'capture', 'screenshots', name)
  if (!existsSync(file)) return reply.code(404).send({ error: 'captura no encontrada' })
  reply.header('content-type', 'image/png')
  return reply.send(createReadStream(file))
})

app.get('/api/projects/:id', async (req, reply) => {
  const project = db.prepare('SELECT * FROM video_projects WHERE project_id = ?').get(req.params.id)
  if (!project) return reply.code(404).send({ error: 'proyecto no encontrado' })
  const versions = db
    .prepare('SELECT version_id, version_number, feedback, cost_usd, created_at FROM video_versions WHERE project_id = ? ORDER BY version_number')
    .all(req.params.id)
  const assets = db
    .prepare('SELECT asset_id, filename, kind, created_at FROM project_assets WHERE project_id = ? ORDER BY created_at')
    .all(req.params.id)
  return {
    project,
    versions,
    assets,
    progress: getProgress(req.params.id),
    chat: chatHistory.get(req.params.id) ?? [],
    planChat: planHistory.get(req.params.id) ?? [],
  }
})

// Chat de planeación PRE-render: turnos reales de LLM que refinan el brief de
// edición ANTES de transcribir/editar — no texto estático concatenado.
app.post('/api/projects/:id/plan', async (req, reply) => {
  const project = db.prepare('SELECT * FROM video_projects WHERE project_id = ?').get(req.params.id)
  const message = (req.body?.message ?? '').trim()
  const model = getModel(req.body?.model_id)
  if (!project || !message || !model) return reply.code(400).send({ error: 'proyecto, mensaje o modelo inválido' })

  const assets = db
    .prepare('SELECT filename FROM project_assets WHERE project_id = ? ORDER BY created_at')
    .all(req.params.id)
  const history = planHistory.get(req.params.id) ?? []

  const result =
    project.project_type === 'web'
      ? await planWebVideo({
          modelId: model.model_id,
          projectId: project.project_id,
          siteContext: buildSiteContext(project),
          assets,
          history,
          message,
        })
      : await planEdit({
          modelId: model.model_id,
          projectId: project.project_id,
          assets,
          history,
          message,
        })

  history.push({ role: 'usuario', text: message })
  history.push({ role: 'asistente', text: result.reply })
  planHistory.set(req.params.id, history)
  return result
})

// —— Assets (imágenes que pueden insertarse en el video) ——
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

app.post('/api/projects/:id/assets', async (req, reply) => {
  const project = db.prepare('SELECT * FROM video_projects WHERE project_id = ?').get(req.params.id)
  if (!project) return reply.code(404).send({ error: 'proyecto no encontrado' })
  const file = await req.file()
  if (!file) return reply.code(400).send({ error: 'sube una imagen' })

  const safeName = path.basename(file.filename).replace(/[^\w.\-]/g, '_')
  if (!IMAGE_EXTS.has(path.extname(safeName).toLowerCase()))
    return reply.code(400).send({ error: 'por ahora los assets son imágenes: png, jpg o webp' })

  const assetsDir = path.join(project.videos_dir, 'assets')
  mkdirSync(assetsDir, { recursive: true })
  await streamPipeline(file.file, createWriteStream(path.join(assetsDir, safeName)))

  const assetId = randomUUID()
  db.prepare(`
    INSERT INTO project_assets (asset_id, project_id, filename, kind) VALUES (?, ?, ?, 'image')
  `).run(assetId, req.params.id, safeName)
  return { assetId, filename: safeName }
})

app.delete('/api/projects/:id/assets/:assetId', async (req, reply) => {
  const asset = db
    .prepare('SELECT * FROM project_assets WHERE asset_id = ? AND project_id = ?')
    .get(req.params.assetId, req.params.id)
  if (!asset) return reply.code(404).send({ error: 'asset no encontrado' })
  db.prepare('DELETE FROM project_assets WHERE asset_id = ?').run(req.params.assetId)
  return { deleted: true }
})

app.get('/api/projects/:id/assets/:assetId/file', async (req, reply) => {
  const project = db.prepare('SELECT * FROM video_projects WHERE project_id = ?').get(req.params.id)
  const asset = db
    .prepare('SELECT * FROM project_assets WHERE asset_id = ? AND project_id = ?')
    .get(req.params.assetId, req.params.id)
  if (!project || !asset) return reply.code(404).send({ error: 'asset no encontrado' })
  const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
  reply.header('content-type', types[path.extname(asset.filename).toLowerCase()] ?? 'application/octet-stream')
  return reply.send(createReadStream(path.join(project.videos_dir, 'assets', asset.filename)))
})

// FR3: pre-estimación del costo antes de tocar la API
app.post('/api/projects/:id/estimate', async (req, reply) => {
  const project = db.prepare('SELECT * FROM video_projects WHERE project_id = ?').get(req.params.id)
  const model = getModel(req.body?.model_id)
  if (!project || !model) return reply.code(400).send({ error: 'proyecto o modelo inválido' })
  const estimate =
    project.project_type === 'web'
      ? estimateWebCost(model)
      : estimateCost(project.video_duration_seconds, model)
  db.prepare(`UPDATE video_projects SET execution_status = 'estimated', estimated_cost_usd = ?, model_id = ? WHERE project_id = ?`)
    .run(estimate.costFlatUsd, model.model_id, req.params.id)
  return { model: model.friendly_name, ...estimate }
})

// FR5: human-in-the-loop — nada corre sin esta aprobación explícita
app.post('/api/projects/:id/approve', async (req, reply) => {
  const project = db.prepare('SELECT * FROM video_projects WHERE project_id = ?').get(req.params.id)
  const model = getModel(req.body?.model_id ?? project?.model_id)
  if (!project || !model) return reply.code(400).send({ error: 'proyecto o modelo inválido' })
  if (['capturing', 'transcribing', 'editing', 'rendering'].includes(project.execution_status))
    return reply.code(409).send({ error: 'el pipeline ya está corriendo' })

  if (project.project_type === 'web') {
    runWebPipeline(project.project_id, model.model_id, req.body?.instructions ?? null) // async, sin await
  } else {
    runPipeline(project.project_id, model.model_id, req.body?.instructions ?? null) // async, sin await
  }
  return { started: true }
})

// FR7: chat de iteración
app.post('/api/projects/:id/chat', async (req, reply) => {
  const project = db.prepare('SELECT * FROM video_projects WHERE project_id = ?').get(req.params.id)
  const message = (req.body?.message ?? '').trim()
  if (!project || !message) return reply.code(400).send({ error: 'mensaje vacío' })

  const lastVersion = db
    .prepare('SELECT * FROM video_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1')
    .get(req.params.id)
  if (!lastVersion) return reply.code(409).send({ error: 'primero renderiza la versión 1' })

  const history = chatHistory.get(req.params.id) ?? []
  const assets = db
    .prepare('SELECT filename FROM project_assets WHERE project_id = ? ORDER BY created_at')
    .all(req.params.id)

  let result
  if (project.project_type === 'web') {
    let brief = null
    try {
      brief = readFileSync(path.join(project.videos_dir, 'edit', 'brief.txt'), 'utf8') || null
    } catch { /* sin brief guardado */ }
    result = await chatAboutWebVideo({
      modelId: project.model_id,
      projectId: project.project_id,
      siteContext: buildSiteContext(project),
      brief,
      strategy: project.strategy_text,
      assets,
      history,
      message,
    })
  } else {
    const packed = readFileSync(path.join(project.videos_dir, 'edit', 'takes_packed.md'), 'utf8')
    const currentEdl = JSON.parse(readFileSync(lastVersion.edl_path, 'utf8'))
    result = await chatAboutEdit({
      modelId: project.model_id,
      projectId: project.project_id,
      packedTranscript: packed,
      assets,
      currentEdl,
      history,
      message,
    })
  }

  history.push({ role: 'usuario', text: message })
  history.push({ role: 'asistente', text: result.reply })
  chatHistory.set(req.params.id, history)
  return result
})

// FR7: el usuario aprueba los cambios → versión N+1
app.post('/api/projects/:id/versions', async (req, reply) => {
  const project = db.prepare('SELECT * FROM video_projects WHERE project_id = ?').get(req.params.id)
  const feedback = (req.body?.feedback ?? '').trim()
  if (!project || !feedback) return reply.code(400).send({ error: 'feedback vacío' })
  if (['capturing', 'transcribing', 'editing', 'rendering'].includes(project.execution_status))
    return reply.code(409).send({ error: 'el pipeline ya está corriendo' })

  if (project.project_type === 'web') {
    runWebNewVersion(project.project_id, feedback) // async, sin await
  } else {
    runNewVersion(project.project_id, feedback) // async, sin await
  }
  return { started: true }
})

// Streaming del video renderizado (con soporte de Range para el <video> del navegador)
app.get('/api/projects/:id/versions/:n/video', async (req, reply) => {
  const version = db
    .prepare('SELECT * FROM video_versions WHERE project_id = ? AND version_number = ?')
    .get(req.params.id, Number(req.params.n))
  if (!version) return reply.code(404).send({ error: 'versión no encontrada' })

  const { size } = statSync(version.output_path)
  const range = req.headers.range
  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-')
    const start = Number(startStr)
    const end = endStr ? Number(endStr) : size - 1
    reply.code(206).headers({
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes',
      'content-length': end - start + 1,
      'content-type': 'video/mp4',
    })
    return reply.send(createReadStream(version.output_path, { start, end }))
  }
  reply.headers({ 'content-length': size, 'content-type': 'video/mp4', 'accept-ranges': 'bytes' })
  return reply.send(createReadStream(version.output_path))
})

// —— Dashboard (FR8) ——
app.get('/api/dashboard', async () => {
  const totals = db.prepare(`
    SELECT COUNT(*) AS projects,
           COALESCE(SUM(actual_cost_usd), 0) AS totalCostUsd,
           COALESCE(SUM(tokens_input_consumed), 0) AS tokensIn,
           COALESCE(SUM(tokens_output_consumed), 0) AS tokensOut,
           COALESCE(SUM(transcription_seconds_elapsed), 0) AS transcriptionSeconds
    FROM video_projects
  `).get()
  // Incluye eliminados: el consumo de tokens de un proyecto borrado sigue contando
  const perProject = db.prepare(`
    SELECT project_id, source_filename, model_id, execution_status,
           estimated_cost_usd, actual_cost_usd, deleted_at, created_at
    FROM video_projects ORDER BY created_at DESC LIMIT 50
  `).all()
  const calls = db.prepare(`
    SELECT a.*, p.source_filename FROM api_calls a
    LEFT JOIN video_projects p ON p.project_id = a.project_id
    ORDER BY a.created_at DESC LIMIT 100
  `).all()
  return { totals, perProject, calls }
})

// —— WebSocket con token de sesión (defensa DNS rebinding) ——
app.get('/ws', { websocket: true }, (socket, req) => {
  const url = new URL(req.url, `http://${HOST}`)
  if (url.searchParams.get('token') !== SESSION_TOKEN) {
    socket.close(4401, 'invalid session token')
    return
  }
  socket.send(JSON.stringify({ type: 'hello' }))
})

await app.listen({ port: PORT, host: HOST })
app.log.info(`Ovidee server en http://${HOST}:${PORT} (solo loopback)`)
