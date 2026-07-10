import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const ENV_PATH = path.join(ROOT, '.env')

export const PROVIDERS = {
  anthropic: {
    envKey: 'ANTHROPIC_API_KEY',
    name: 'Anthropic (Claude)',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    prefix: 'sk-ant-',
    supported: true,
  },
  openai: {
    envKey: 'OPENAI_API_KEY',
    name: 'OpenAI (GPT)',
    keyUrl: 'https://platform.openai.com/api-keys',
    prefix: 'sk-',
    supported: false, // próximamente vía LiteLLM
  },
  gemini: {
    envKey: 'GEMINI_API_KEY',
    name: 'Google (Gemini)',
    keyUrl: 'https://aistudio.google.com/apikey',
    prefix: '',
    supported: false,
  },
  deepseek: {
    envKey: 'DEEPSEEK_API_KEY',
    name: 'DeepSeek',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    prefix: 'sk-',
    supported: false,
  },
}

function parseEnvFile() {
  if (!existsSync(ENV_PATH)) return {}
  const out = {}
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const [key, ...rest] = trimmed.split('=')
    out[key.trim()] = rest.join('=').trim()
  }
  return out
}

export function loadEnv() {
  for (const [key, value] of Object.entries(parseEnvFile())) {
    if (!(key in process.env)) process.env[key] = value
  }
}

// Detecta qué proveedor tiene una key con valor (en .env o en el entorno)
export function detectProvider() {
  const env = parseEnvFile()
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const value = env[p.envKey] || process.env[p.envKey]
    if (value && value.length > 8) {
      return { provider: id, ...p, maskedKey: `…${value.slice(-4)}` }
    }
  }
  return null
}

export function getApiKey(provider) {
  const p = PROVIDERS[provider]
  const env = parseEnvFile()
  return env[p.envKey] || process.env[p.envKey] || null
}

// FR2: escribe la key en .env con permisos 0600; nunca se loguea ni vuelve al frontend
export function saveApiKey(provider, key) {
  const p = PROVIDERS[provider]
  if (!p) throw new Error(`proveedor desconocido: ${provider}`)
  const trimmed = key.trim()
  if (trimmed.length < 16) throw new Error('la API key parece incompleta')

  const env = parseEnvFile()
  env[p.envKey] = trimmed
  if (!env.OVIDEE_WHISPER_MODEL) env.OVIDEE_WHISPER_MODEL = 'large-v3'

  const lines = [
    '# Credenciales de Ovidee — nunca subir a git (protegido por .gitignore)',
    ...Object.entries(env).map(([k, v]) => `${k}=${v}`),
  ]
  writeFileSync(ENV_PATH, lines.join('\n') + '\n')
  chmodSync(ENV_PATH, 0o600)
  process.env[p.envKey] = trimmed
  return { provider, maskedKey: `…${trimmed.slice(-4)}` }
}
