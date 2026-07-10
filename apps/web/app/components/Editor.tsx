'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, SERVER, Asset, Estimate, Model, Project, Version } from '../lib/api'

const ACTIVE = ['capturing', 'transcribing', 'editing', 'rendering']

export function Editor() {
  const [projects, setProjects] = useState<Project[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(5)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<Project | null>(null)

  const refresh = useCallback(async (p = page) => {
    const res = await api.get<{ projects: Project[]; total: number; page: number; pageSize: number }>(
      `/api/projects?page=${p}`,
    )
    setProjects(res.projects)
    setTotal(res.total)
    setPageSize(res.pageSize)
    // Si la página quedó vacía tras eliminar, retrocede una
    if (res.projects.length === 0 && p > 1) {
      setPage(p - 1)
      refresh(p - 1)
    }
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refresh(page)
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  if (selectedId) {
    return <ProjectView projectId={selectedId} onBack={() => { setSelectedId(null); refresh() }} />
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div>
      <DropZone onUploaded={(id) => { refresh(); setSelectedId(id) }} />
      <UrlZone onCreated={(id) => { refresh(); setSelectedId(id) }} />
      {projects.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-neutral-500">
              Tus proyectos <span className="normal-case tracking-normal">({total})</span>
            </h3>
            {totalPages > 1 && (
              <div className="flex items-center gap-2 text-sm text-neutral-400">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded border border-neutral-700 px-2 py-1 transition hover:border-neutral-500 disabled:opacity-30"
                >
                  ‹
                </button>
                <span>{page} / {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded border border-neutral-700 px-2 py-1 transition hover:border-neutral-500 disabled:opacity-30"
                >
                  ›
                </button>
              </div>
            )}
          </div>
          <ul className="space-y-2">
            {projects.map((p) => (
              <li key={p.project_id} className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedId(p.project_id)}
                  className="flex flex-1 items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-left transition hover:border-neutral-600"
                >
                  <div>
                    <span className="mr-2">{p.project_type === 'web' ? '🌐' : '🎬'}</span>
                    <span className="font-medium">{p.source_filename}</span>
                    <span className="ml-3 text-sm text-neutral-500">
                      {p.project_type === 'web'
                        ? p.video_duration_seconds > 0
                          ? `${p.video_duration_seconds.toFixed(1)}s · desde URL`
                          : 'video desde URL'
                        : `${p.video_duration_seconds.toFixed(1)}s`}
                    </span>
                  </div>
                  <StatusBadge status={p.execution_status} />
                </button>
                <button
                  onClick={() => setToDelete(p)}
                  title="Eliminar proyecto"
                  className="rounded-lg border border-neutral-800 px-3 py-3 text-neutral-500 transition hover:border-red-800 hover:text-red-400"
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {toDelete && (
        <DeleteModal
          project={toDelete}
          onClose={() => setToDelete(null)}
          onDeleted={() => { setToDelete(null); refresh() }}
        />
      )}
    </div>
  )
}

function DeleteModal({ project, onClose, onDeleted }: { project: Project; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`${SERVER}/api/projects/${project.project_id}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      onDeleted()
    } catch (e) {
      setError((e as Error).message)
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold">¿Eliminar este proyecto?</h3>
        <p className="mt-2 text-sm text-neutral-400">
          Se eliminará <span className="font-medium text-neutral-200">{project.source_filename}</span> con
          su video, assets y todas las versiones renderizadas. Esta acción no se puede deshacer.
        </p>
        <p className="mt-2 rounded-lg bg-neutral-950 px-3 py-2 text-xs text-neutral-500">
          El historial de costos se conserva: este proyecto consumió{' '}
          <span className="text-neutral-300">${project.actual_cost_usd.toFixed(4)} USD</span> en tokens y
          seguirá visible en el dashboard.
        </p>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm transition hover:border-neutral-500"
          >
            Cancelar
          </button>
          <button
            onClick={confirm}
            disabled={deleting}
            className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium transition hover:bg-red-600 disabled:opacity-40"
          >
            {deleting ? 'Eliminando…' : 'Sí, eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    done: 'bg-emerald-950 text-emerald-400',
    error: 'bg-red-950 text-red-400',
    uploaded: 'bg-neutral-800 text-neutral-400',
    captured: 'bg-neutral-800 text-neutral-400',
    estimated: 'bg-sky-950 text-sky-400',
  }
  const labels: Record<string, string> = {
    uploaded: 'subido', estimated: 'estimado', transcribing: 'transcribiendo',
    editing: 'editando (IA)', rendering: 'renderizando', done: 'listo', error: 'error',
    capturing: 'capturando sitio', captured: 'sitio capturado',
  }
  return (
    <span className={`rounded-full px-3 py-1 text-xs ${styles[status] ?? 'bg-amber-950 text-amber-400'}`}>
      {ACTIVE.includes(status) && '● '}{labels[status] ?? status}
    </span>
  )
}

function DropZone({ onUploaded }: { onUploaded: (id: string) => void }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const res = await api.upload<{ projectId: string }>('/api/projects', file)
      onUploaded(res.projectId)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) handleFile(file)
      }}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded-2xl border-2 border-dashed px-8 py-16 text-center transition ${
        dragging ? 'border-emerald-500 bg-emerald-950/20' : 'border-neutral-700 bg-neutral-900/50 hover:border-neutral-500'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
      <p className="text-4xl">🎬</p>
      <p className="mt-3 text-lg font-medium">
        {uploading ? 'Subiendo…' : 'Arrastra tu video aquí'}
      </p>
      <p className="mt-1 text-sm text-neutral-500">o haz clic para elegirlo — mp4, mov, mkv…</p>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  )
}

// Video desde una URL: la app captura el sitio con el navegador local
// (screenshots, textos, paleta) y genera un video animado con ese material.
function UrlZone({ onCreated }: { onCreated: (id: string) => void }) {
  const [url, setUrl] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    const target = url.trim()
    if (!target || creating) return
    setCreating(true)
    setError(null)
    try {
      const res = await api.post<{ projectId: string }>('/api/projects/web', {
        url: /^https?:\/\//i.test(target) ? target : `https://${target}`,
      })
      setUrl('')
      onCreated(res.projectId)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-900/50 px-6 py-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-2xl">🌐</span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">…o crea un video desde una URL</p>
          <p className="text-xs text-neutral-500">
            La app captura el sitio localmente (screenshots, textos, colores) y genera un video
            animado con su propio material — cuéntale por chat qué quieres lograr.
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="https://tusitio.com"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-emerald-500 sm:w-64"
          />
          <button
            onClick={create}
            disabled={creating || !url.trim()}
            className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium transition hover:bg-emerald-600 disabled:opacity-40"
          >
            {creating ? '…' : 'Capturar'}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  )
}

type Detail = {
  project: Project
  versions: Version[]
  assets: Asset[]
  progress: { at: string; message: string }[]
  chat: { role: string; text: string }[]
  planChat: { role: string; text: string }[]
}

type Recommendation = { label: string; prompt: string }
type PlanReply = { reply: string; recommendations: Recommendation[]; instructions: string; ready_to_render: boolean }

// Aperturas estáticas (no cuestan nada, son solo texto para que el usuario
// tenga por dónde empezar) — al hacer clic se envían como un mensaje real al
// asistente, que sí hace una llamada al LLM y responde en conversación.
const PLAN_STARTERS: Recommendation[] = [
  { label: '🎤 Resalta solo la palabra actual', prompt: 'Quiero captions de 2 o 3 palabras que resalten únicamente la palabra exacta que se está diciendo en ese momento — no un relleno progresivo acumulado.' },
  { label: '📍 Subtítulos arriba, centrados', prompt: 'Quiero que los subtítulos aparezcan en la parte superior del video, centrados.' },
  { label: '🎞 Transiciones suaves entre cortes', prompt: 'Quiero transiciones suaves (crossfade) entre los cortes del video.' },
  { label: '🖼 Usa mis imágenes', prompt: 'Quiero que uses las imágenes que subí en los momentos más relevantes del video.' },
  { label: '❓ ¿Qué puedes hacer?', prompt: '¿Qué tipo de ediciones puedes hacer con este video? Cuéntame las opciones.' },
]

// Aperturas para videos generados desde una URL
const WEB_PLAN_STARTERS: Recommendation[] = [
  { label: '🎯 Tour del sitio en 30s', prompt: 'Quiero un tour de 30 segundos que presente el sitio: qué es, qué ofrece y cierre con la URL.' },
  { label: '📱 Clip vertical para redes', prompt: 'Quiero un clip vertical (9:16) de unos 15 segundos para Instagram/TikTok que enganche con lo más llamativo del sitio.' },
  { label: '🚀 Presentar el producto/servicio', prompt: 'Quiero un video que presente el producto o servicio principal del sitio, con sus beneficios clave y una llamada a la acción.' },
  { label: '❓ ¿Qué puedes hacer con mi sitio?', prompt: '¿Qué tipo de videos puedes generar a partir de este sitio? Cuéntame las opciones según lo que capturaste.' },
]

// Chat de planeación PRE-render: llamadas reales al LLM (no texto estático
// concatenado) que conversan con el usuario y van refinando el brief de
// edición ("instructions") antes de procesar el video.
function PlanningChat({
  projectId,
  modelId,
  assets,
  initialHistory,
  onInstructions,
  starters = PLAN_STARTERS,
  title = '2 · Cuéntanos cómo quieres la edición',
}: {
  projectId: string
  modelId: string
  assets: Asset[]
  initialHistory: { role: string; text: string }[]
  onInstructions: (text: string) => void
  starters?: Recommendation[]
  title?: string
}) {
  const [history, setHistory] = useState(initialHistory)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [readyToRender, setReadyToRender] = useState(false)

  const send = async (text?: string) => {
    const outgoing = (text ?? message).trim()
    if (!outgoing || sending || !modelId) return
    setSending(true)
    setHistory((h) => [...h, { role: 'usuario', text: outgoing }])
    setMessage('')
    try {
      const res = await api.post<PlanReply>(`/api/projects/${projectId}/plan`, {
        message: outgoing,
        model_id: modelId,
      })
      setHistory((h) => [...h, { role: 'asistente', text: res.reply }])
      setRecommendations(res.recommendations ?? [])
      setReadyToRender(Boolean(res.ready_to_render))
      // Async handler, no dentro de un updater de setState: seguro sincronizar
      // el estado del padre aquí (a diferencia de hacerlo dentro de setTags).
      onInstructions(res.instructions ?? '')
    } catch (e) {
      setHistory((h) => [...h, { role: 'asistente', text: `Error: ${(e as Error).message}` }])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <h3 className="font-medium">{title}</h3>
      <p className="mt-1 text-xs text-neutral-500">
        Descríbelo con tus palabras — el asistente te hace preguntas si falta algo importante
        y va armando el brief para la IA que edita. Puedes seguir ajustando antes de aprobar.
      </p>

      <div className="mt-4 max-h-72 space-y-3 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
        {history.length === 0 && (
          <div>
            <p className="text-xs text-neutral-500">Prueba con una de estas o escribe lo tuyo:</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {starters.map((s) => (
                <button
                  key={s.label}
                  onClick={() => send(s.prompt)}
                  disabled={sending || !modelId}
                  className="rounded-full border border-neutral-700 bg-neutral-800/60 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-emerald-600 hover:text-emerald-300 disabled:opacity-40"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {history.map((m, i) => (
          <div key={i} className={m.role === 'usuario' ? 'text-right' : ''}>
            <span
              className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                m.role === 'usuario' ? 'bg-emerald-950/60 text-emerald-100' : 'bg-neutral-800 text-neutral-200'
              }`}
            >
              {m.text}
            </span>
          </div>
        ))}
        {sending && <p className="text-xs text-neutral-500">pensando…</p>}
        {recommendations.length > 0 && (
          <div className="rounded-lg border border-sky-900 bg-sky-950/30 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-sky-400">
              Opciones — elige una para pedirla
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {recommendations.map((r, i) => (
                <button
                  key={i}
                  onClick={() => send(r.prompt)}
                  disabled={sending}
                  title={r.prompt}
                  className="rounded-full border border-sky-800 bg-sky-950/60 px-3 py-1.5 text-xs text-sky-200 transition hover:border-sky-500 hover:bg-sky-900/60 disabled:opacity-40"
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Escribe qué edición quieres…"
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <button
          onClick={() => send()}
          disabled={sending || !modelId}
          className="rounded-lg bg-neutral-700 px-4 py-2 text-sm transition hover:bg-neutral-600 disabled:opacity-40"
        >
          {sending ? '…' : 'Enviar'}
        </button>
      </div>

      {readyToRender && (
        <p className="mt-3 text-xs text-emerald-400">
          ✅ Ya tienes suficiente definido — puedes calcular el costo y aprobar abajo.
        </p>
      )}
      {assets.length === 0 && (
        <p className="mt-3 text-xs text-neutral-600">
          💡 Si quieres que la IA use imágenes (logo, producto), súbelas arriba en Assets antes
          de seguir — así puedes mencionarlas en la conversación.
        </p>
      )}
    </div>
  )
}

function ProjectView({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [models, setModels] = useState<Model[]>([])
  const [modelId, setModelId] = useState<string>('')
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [instructions, setInstructions] = useState('')

  const refresh = useCallback(async () => {
    const d = await api.get<Detail>(`/api/projects/${projectId}`)
    setDetail(d)
    if (d.project.model_id) setModelId((m) => m || d.project.model_id!)
  }, [projectId])

  useEffect(() => {
    refresh()
    api.get<{ models: Model[] }>('/api/models').then(({ models }) => {
      setModels(models.filter((m) => m.available))
      setModelId((m) => m || models.find((x) => x.available)?.model_id || '')
    })
  }, [refresh])

  // Polling mientras el pipeline corre
  const active = detail && ACTIVE.includes(detail.project.execution_status)
  useEffect(() => {
    if (!active) return
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [active, refresh])

  if (!detail) return <p className="text-neutral-500">cargando…</p>
  const { project, versions, progress } = detail
  const isWeb = project.project_type === 'web'

  const calc = async () => {
    setEstimate(await api.post<Estimate>(`/api/projects/${projectId}/estimate`, { model_id: modelId }))
  }
  const approve = async () => {
    await api.post(`/api/projects/${projectId}/approve`, { model_id: modelId, instructions: instructions || undefined })
    refresh()
  }

  return (
    <div>
      <button onClick={onBack} className="mb-4 text-sm text-neutral-400 hover:text-neutral-200">
        ← volver a proyectos
      </button>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">
          {isWeb ? '🌐 ' : ''}{project.source_filename}
        </h2>
        <StatusBadge status={project.execution_status} />
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        {isWeb
          ? <>video generado desde <span className="text-neutral-400">{project.source_url}</span> · </>
          : <>{project.video_duration_seconds.toFixed(1)} segundos · </>}
        costo real acumulado: ${project.actual_cost_usd.toFixed(4)} USD
      </p>

      {/* Capturas del sitio (solo proyectos web) */}
      {isWeb && <CapturePanel projectId={projectId} status={project.execution_status} />}

      {/* Assets del proyecto (imágenes que la IA puede insertar) */}
      <AssetsPanel projectId={projectId} assets={detail.assets} refresh={refresh} />

      {/* Fase 1: construir la instrucción de edición, estimar y aprobar */}
      {(isWeb ? ['captured', 'estimated', 'error'] : ['uploaded', 'estimated', 'error']).includes(project.execution_status) && versions.length === 0 && (
        <>
          <PlanningChat
            projectId={projectId}
            modelId={modelId}
            assets={detail.assets}
            initialHistory={detail.planChat}
            onInstructions={setInstructions}
            starters={isWeb ? WEB_PLAN_STARTERS : PLAN_STARTERS}
            title={isWeb ? '2 · Cuéntanos qué quieres lograr con el video' : '2 · Cuéntanos cómo quieres la edición'}
          />

          <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h3 className="font-medium">3 · Elige el modelo y calcula el costo</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {models.map((m) => (
              <button
                key={m.model_id}
                onClick={() => setModelId(m.model_id)}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                  modelId === m.model_id ? 'border-emerald-500 bg-emerald-950/40' : 'border-neutral-700 hover:border-neutral-500'
                }`}
              >
                <span className="font-medium">{m.friendly_name}</span>
                <span className="block text-xs text-neutral-500">
                  ${m.input_cost_per_million}/M in · ${m.output_cost_per_million}/M out
                </span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={calc}
              disabled={!modelId}
              className="rounded-lg border border-sky-700 bg-sky-950/40 px-4 py-2 text-sm font-medium text-sky-300 transition hover:bg-sky-900/40 disabled:opacity-40"
            >
              💰 Calcular costo
            </button>
            {estimate && (
              <span className="text-sm text-neutral-300">
                ~${estimate.costCachedUsd.toFixed(3)}–${estimate.costFlatUsd.toFixed(3)} USD ·{' '}
                {isWeb
                  ? 'la captura del sitio ya fue local y gratis'
                  : `transcripción local gratis (~${Math.ceil(estimate.transcriptionSeconds / 60)} min)`}
              </span>
            )}
          </div>

          {estimate && (
            <button
              onClick={approve}
              className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-3 font-medium transition hover:bg-emerald-500"
            >
              ✅ Aprobar y editar (~${estimate.costFlatUsd.toFixed(3)} USD máx.)
            </button>
          )}
          {project.error_message && (
            <p className="mt-3 text-sm text-red-400">Último error: {project.error_message}</p>
          )}
          </div>
        </>
      )}

      {/* Progreso del pipeline */}
      {(active || progress.length > 0) && project.execution_status !== 'done' && (
        <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h3 className="font-medium">{active ? 'Editando…' : 'Última ejecución'}</h3>
          <ul className="mt-3 space-y-1 text-sm text-neutral-400">
            {progress.map((p, i) => (
              <li key={i}>· {p.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Estrategia + versiones + chat */}
      {versions.length > 0 && (
        <ResultView projectId={projectId} detail={detail} refresh={refresh} active={Boolean(active)} />
      )}
    </div>
  )
}

// Capturas del sitio hechas por el navegador local — son el material con el
// que se construye el video web (se refrescan cuando termina la captura).
function CapturePanel({ projectId, status }: { projectId: string; status: string }) {
  const [shots, setShots] = useState<string[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    api
      .get<{ ready: boolean; screenshots: string[] }>(`/api/projects/${projectId}/capture`)
      .then((r) => { setReady(r.ready); setShots(r.screenshots) })
      .catch(() => setReady(false))
  }, [projectId, status])

  if (status === 'capturing') {
    return (
      <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5 text-sm text-neutral-400">
        📸 Capturando el sitio con tu navegador local — screenshots, textos y paleta de colores.
        Nada del sitio se sube a ningún lado.
      </div>
    )
  }
  if (!ready || shots.length === 0) return null

  return (
    <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <h3 className="font-medium">Capturas del sitio ({shots.length})</h3>
      <p className="mt-1 text-xs text-neutral-500">
        Este es el material real con el que se construye el video. Al modelo de IA solo viaja
        texto (títulos, textos visibles, colores) — las imágenes nunca salen de tu máquina.
      </p>
      <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
        {shots.map((name) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={name}
            src={`${SERVER}/api/projects/${projectId}/capture/screenshots/${name}`}
            alt={name}
            title={name}
            className="h-28 shrink-0 rounded-lg border border-neutral-700 object-cover"
          />
        ))}
      </div>
    </div>
  )
}

function AssetsPanel({ projectId, assets, refresh }: { projectId: string; assets: Asset[]; refresh: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        await api.upload(`/api/projects/${projectId}/assets`, file)
      }
      refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">1 · Assets (opcional)</h3>
          <p className="mt-1 text-xs text-neutral-500">
            Imágenes (png, jpg, webp) que la IA puede insertar en el video: a pantalla completa
            tipo B-roll o en la esquina (logo, producto). Menciónalas en tus instrucciones o en el chat.
          </p>
        </div>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="shrink-0 rounded-lg border border-neutral-700 px-3 py-2 text-sm transition hover:border-neutral-500 disabled:opacity-40"
        >
          {uploading ? 'Subiendo…' : '+ Agregar imagen'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {assets.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          {assets.map((a) => (
            <div key={a.asset_id} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${SERVER}/api/projects/${projectId}/assets/${a.asset_id}/file`}
                alt={a.filename}
                className="h-20 w-28 rounded-lg border border-neutral-700 object-cover"
              />
              <p className="mt-1 w-28 truncate text-xs text-neutral-500" title={a.filename}>
                {a.filename}
              </p>
              <button
                onClick={async () => {
                  await fetch(`${SERVER}/api/projects/${projectId}/assets/${a.asset_id}`, { method: 'DELETE' })
                  refresh()
                }}
                className="absolute -right-2 -top-2 hidden h-6 w-6 rounded-full bg-red-900 text-xs text-red-200 group-hover:block"
                title="eliminar"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

type ChatReply = { reply: string; recommendations: Recommendation[]; proposes_new_version: boolean }

// Sugerencias iniciales: enseñan qué se puede pedir (FR7)
const STARTER_SUGGESTIONS: Recommendation[] = [
  { label: '🎤 Captions karaoke en verde', prompt: 'Agrega captions estilo karaoke con resaltado palabra por palabra en verde' },
  { label: '💬 Subtítulos estilo social', prompt: 'Agrega subtítulos quemados estilo social, 2 palabras en mayúsculas' },
  { label: '✨ Título animado al inicio', prompt: 'Agrega un título animado al inicio del video con la idea principal' },
  { label: '🎞 Transiciones entre cortes', prompt: 'Agrega transiciones suaves (crossfade) entre los cortes' },
  { label: '📊 Motion graphic explicativo', prompt: 'Agrega un motion graphic que resuma visualmente la idea principal del video (diagrama o gráfica animada)' },
  { label: '✂️ Recorta más los silencios', prompt: 'Recorta más agresivamente los silencios y pausas para que quede más dinámico' },
]

// Sugerencias de iteración para videos generados desde una URL
const WEB_ITERATION_STARTERS: Recommendation[] = [
  { label: '⏱ Más corto y dinámico', prompt: 'Haz el video más corto y dinámico: escenas de menos duración y ritmo más rápido.' },
  { label: '🎨 Cambia el esquema de color', prompt: 'Prueba otro esquema de color del sitio: usa otro de sus colores dominantes como fondo.' },
  { label: '📝 Ajusta los textos', prompt: 'Cambia los textos de las escenas: hazlos más cortos y directos.' },
  { label: '📸 Muestra más el sitio', prompt: 'Dale más protagonismo a las capturas del sitio: pantallas más grandes y por más tiempo.' },
]

function ResultView({ projectId, detail, refresh, active }: { projectId: string; detail: Detail; refresh: () => void; active: boolean }) {
  const { project, versions, chat } = detail
  const starters = project.project_type === 'web' ? WEB_ITERATION_STARTERS : STARTER_SUGGESTIONS
  const [current, setCurrent] = useState(versions[versions.length - 1].version_number)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [lastReply, setLastReply] = useState<ChatReply | null>(null)
  const [pendingFeedback, setPendingFeedback] = useState<string | null>(null)

  useEffect(() => {
    setCurrent(versions[versions.length - 1].version_number)
  }, [versions.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (text?: string) => {
    const outgoing = (text ?? message).trim()
    if (!outgoing || sending) return
    setSending(true)
    try {
      const res = await api.post<ChatReply>(`/api/projects/${projectId}/chat`, { message: outgoing })
      setLastReply(res)
      if (res?.proposes_new_version) setPendingFeedback(outgoing)
      setMessage('')
      refresh()
    } finally {
      setSending(false)
    }
  }

  const renderNew = async () => {
    if (!pendingFeedback) return
    await api.post(`/api/projects/${projectId}/versions`, { feedback: pendingFeedback })
    setPendingFeedback(null)
    setLastReply(null)
    refresh()
  }

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <div>
        <div className="mb-2 flex items-center gap-2">
          {versions.map((v) => (
            <button
              key={v.version_number}
              onClick={() => setCurrent(v.version_number)}
              className={`rounded-full px-3 py-1 text-xs transition ${
                current === v.version_number ? 'bg-emerald-600' : 'bg-neutral-800 hover:bg-neutral-700'
              }`}
              title={v.feedback ?? 'versión inicial'}
            >
              v{v.version_number} · ${v.cost_usd.toFixed(3)}
            </button>
          ))}
        </div>
        <video
          key={current}
          controls
          className="w-full rounded-xl border border-neutral-800 bg-black"
          src={`${SERVER}/api/projects/${projectId}/versions/${current}/video`}
        />
        {project.strategy_text && (
          <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-300">
            <span className="font-medium text-neutral-100">Estrategia de la IA: </span>
            {project.strategy_text}
          </div>
        )}
      </div>

      <div className="flex flex-col rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="font-medium">💬 Pide cambios</h3>
        <div className="mt-3 flex-1 space-y-3 overflow-y-auto text-sm" style={{ maxHeight: 320 }}>
          {chat.length === 0 && (
            <div>
              <p className="text-neutral-500">¿No sabes qué pedir? Prueba una de estas:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {starters.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => send(s.prompt)}
                    disabled={sending || active}
                    className="rounded-full border border-neutral-700 bg-neutral-800/60 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-emerald-600 hover:text-emerald-300 disabled:opacity-40"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {chat.map((m, i) => (
            <div key={i} className={m.role === 'usuario' ? 'text-right' : ''}>
              <span
                className={`inline-block max-w-[85%] rounded-lg px-3 py-2 ${
                  m.role === 'usuario' ? 'bg-emerald-950/60 text-emerald-100' : 'bg-neutral-800 text-neutral-200'
                }`}
              >
                {m.text}
              </span>
            </div>
          ))}
          {lastReply && lastReply.recommendations.length > 0 && (
            <div className="rounded-lg border border-sky-900 bg-sky-950/30 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-sky-400">
                Opciones — elige una para pedirla
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {lastReply.recommendations.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => send(r.prompt)}
                    disabled={sending || active}
                    title={r.prompt}
                    className="rounded-full border border-sky-800 bg-sky-950/60 px-3 py-1.5 text-xs text-sky-200 transition hover:border-sky-500 hover:bg-sky-900/60 disabled:opacity-40"
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {pendingFeedback && !active && (
            <button
              onClick={renderNew}
              className="w-full rounded-lg bg-emerald-600 px-3 py-2 font-medium transition hover:bg-emerald-500"
            >
              ✅ Aprobar cambios y renderizar v{versions.length + 1}
            </button>
          )}
          {active && <p className="text-amber-400">⏳ renderizando la nueva versión…</p>}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Escribe qué quieres cambiar…"
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
          <button
            onClick={() => send()}
            disabled={sending || active}
            className="rounded-lg bg-neutral-700 px-4 py-2 text-sm transition hover:bg-neutral-600 disabled:opacity-40"
          >
            {sending ? '…' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  )
}
