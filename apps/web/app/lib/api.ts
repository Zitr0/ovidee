export const SERVER = 'http://127.0.0.1:3001'

async function json<T>(res: Response): Promise<T> {
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  return body as T
}

export const api = {
  get: <T>(path: string) => fetch(`${SERVER}${path}`).then((r) => json<T>(r)),
  post: <T>(path: string, body?: unknown) =>
    fetch(`${SERVER}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => json<T>(r)),
  upload: <T>(path: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return fetch(`${SERVER}${path}`, { method: 'POST', body: form }).then((r) => json<T>(r))
  },
}

export type SetupState = {
  hasApiKey: boolean
  provider: { provider: string; name: string; maskedKey: string } | null
  providers: { id: string; name: string; keyUrl: string; supported: boolean }[]
  checks: {
    id: string
    name: string
    detail: string
    installed: boolean
    command: string
    downloadSize: string
    needsSudo?: boolean
    optional?: boolean
  }[]
  allInstalled: boolean
}

export type Model = {
  model_id: string
  provider: string
  friendly_name: string
  input_cost_per_million: number
  output_cost_per_million: number
  available: boolean
}

export type Project = {
  project_id: string
  project_type: 'video' | 'web'
  source_url: string | null
  source_filename: string
  video_duration_seconds: number
  execution_status: string
  model_id: string | null
  estimated_cost_usd: number
  actual_cost_usd: number
  strategy_text: string | null
  error_message: string | null
  created_at: string
}

export type Asset = {
  asset_id: string
  filename: string
  kind: string
}

export type Version = {
  version_number: number
  feedback: string | null
  cost_usd: number
  created_at: string
}

export type Estimate = {
  model: string
  inputTokens: number
  outputTokens: number
  costFlatUsd: number
  costCachedUsd: number
  transcriptionSeconds: number
}
