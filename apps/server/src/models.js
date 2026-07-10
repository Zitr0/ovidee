import { db } from './db.js'
import { detectProvider } from './env.js'

// Catálogo semilla (precios oficiales por millón de tokens, 2026-06).
// FR4: el cron de sincronización con OpenRouter actualizará esta tabla.
const SEED = [
  ['claude-fable-5', 'anthropic', 'Claude Fable 5', 10.0, 50.0, 1_000_000],
  ['claude-opus-4-8', 'anthropic', 'Claude Opus 4.8', 5.0, 25.0, 1_000_000],
  ['claude-sonnet-5', 'anthropic', 'Claude Sonnet 5', 3.0, 15.0, 1_000_000],
  ['claude-haiku-4-5', 'anthropic', 'Claude Haiku 4.5', 1.0, 5.0, 200_000],
]

export function seedModels() {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO llm_models
      (model_id, provider, friendly_name, input_cost_per_million, output_cost_per_million, context_window_size)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  for (const row of SEED) insert.run(...row)
}

export function listModels() {
  const active = detectProvider()
  const models = db
    .prepare('SELECT * FROM llm_models ORDER BY input_cost_per_million DESC')
    .all()
  return {
    activeProvider: active ? { provider: active.provider, name: active.name, maskedKey: active.maskedKey } : null,
    models: models.map((m) => ({ ...m, available: active?.provider === m.provider })),
  }
}

export function getModel(modelId) {
  return db.prepare('SELECT * FROM llm_models WHERE model_id = ?').get(modelId)
}

// FR3: Costo Estimado = (Tokens Contexto + Tokens Transcripción Proyectada) × F × Tarifa
const CONTEXT_TOKENS = 4000       // reglas de edición + brief del editor
const TOKENS_PER_SECOND = 5       // habla ~2.5 palabras/s × ~1.3 tokens/palabra + timestamps
const OVERHEAD_FACTOR = 2.5       // F: iteraciones del agente (calibrable vs actual_cost_usd)
const OUTPUT_RATIO = 0.25         // el EDL de salida es una fracción de la entrada
const CACHE_DISCOUNT = 0.4        // ahorro típico con prompt caching en iteraciones

export function estimateCost(durationSeconds, model) {
  const transcriptTokens = Math.ceil(durationSeconds * TOKENS_PER_SECOND)
  const inputTokens = Math.ceil((CONTEXT_TOKENS + transcriptTokens) * OVERHEAD_FACTOR)
  const outputTokens = Math.ceil(inputTokens * OUTPUT_RATIO)

  const flat =
    (inputTokens / 1e6) * model.input_cost_per_million +
    (outputTokens / 1e6) * model.output_cost_per_million
  const cached = flat * (1 - CACHE_DISCOUNT)

  // Transcripción local: ~4× la duración del clip en CPU (benchmark inicial)
  const transcriptionSeconds = Math.ceil(durationSeconds * 4 + 20)

  return {
    inputTokens,
    outputTokens,
    costFlatUsd: Number(flat.toFixed(4)),
    costCachedUsd: Number(cached.toFixed(4)),
    transcriptionSeconds,
    transcriptionCostUsd: 0,
  }
}

// FR-W: estimación para videos web. No hay transcripción; el costo dominante es
// la generación de la composición HTML (salida larga) + el resumen del sitio.
const WEB_CONTEXT_TOKENS = 6000    // contrato de composición + resumen del sitio + brief
const WEB_OUTPUT_TOKENS = 9000     // HTML multi-escena típico
const WEB_LINT_RETRY_FACTOR = 1.6  // el bucle lint/autocorrección reintenta a veces

export function estimateWebCost(model) {
  const inputTokens = Math.ceil(WEB_CONTEXT_TOKENS * WEB_LINT_RETRY_FACTOR)
  const outputTokens = Math.ceil(WEB_OUTPUT_TOKENS * WEB_LINT_RETRY_FACTOR)
  const flat =
    (inputTokens / 1e6) * model.input_cost_per_million +
    (outputTokens / 1e6) * model.output_cost_per_million
  const cached = flat * (1 - CACHE_DISCOUNT)
  return {
    inputTokens,
    outputTokens,
    costFlatUsd: Number(flat.toFixed(4)),
    costCachedUsd: Number(cached.toFixed(4)),
    transcriptionSeconds: 0,
    transcriptionCostUsd: 0,
  }
}

export function recordApiCall({ projectId, modelId, purpose, usage }) {
  const model = getModel(modelId)
  const cost =
    (usage.input_tokens / 1e6) * model.input_cost_per_million +
    (usage.output_tokens / 1e6) * model.output_cost_per_million
  db.prepare(`
    INSERT INTO api_calls (call_id, project_id, model_id, purpose, tokens_input, tokens_output, cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), projectId, modelId, purpose, usage.input_tokens, usage.output_tokens, cost)
  db.prepare(`
    UPDATE video_projects SET
      actual_cost_usd = actual_cost_usd + ?,
      tokens_input_consumed = tokens_input_consumed + ?,
      tokens_output_consumed = tokens_output_consumed + ?
    WHERE project_id = ?
  `).run(cost, usage.input_tokens, usage.output_tokens, projectId)
  return cost
}
