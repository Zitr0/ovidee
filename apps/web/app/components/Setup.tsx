'use client'

import { useEffect, useState } from 'react'
import { api, SetupState } from '../lib/api'

export function ApiKeyStep({ state, onSaved }: { state: SetupState; onSaved: () => void }) {
  const [provider, setProvider] = useState('anthropic')
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const selected = state.providers.find((p) => p.id === provider)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.post('/api/setup/apikey', { provider, key })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <h2 className="text-xl font-semibold">Paso 1 · Conecta tu modelo de IA</h2>
      <p className="mt-2 text-sm text-neutral-400">
        Ovidee usa la API de tu proveedor de IA para decidir la edición. Es la única credencial
        de todo el sistema — se guarda en tu máquina (archivo <code>.env</code>, permisos 0600) y
        nunca sale de ella salvo hacia el propio proveedor.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-2">
        {state.providers.map((p) => (
          <button
            key={p.id}
            onClick={() => setProvider(p.id)}
            disabled={!p.supported}
            className={`rounded-lg border px-4 py-3 text-left text-sm transition ${
              provider === p.id
                ? 'border-emerald-500 bg-emerald-950/40'
                : 'border-neutral-800 bg-neutral-900 hover:border-neutral-600'
            } ${!p.supported ? 'opacity-40' : ''}`}
          >
            <span className="font-medium">{p.name}</span>
            {!p.supported && <span className="block text-xs text-neutral-500">próximamente</span>}
          </button>
        ))}
      </div>

      {selected && (
        <p className="mt-4 text-sm text-neutral-400">
          Obtén tu API key en{' '}
          <a href={selected.keyUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 underline">
            {selected.keyUrl}
          </a>{' '}
          (crea una cuenta si no tienes, genera una key y pégala aquí).
        </p>
      )}

      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="Pega tu API key aquí (sk-ant-…)"
        className="mt-4 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 font-mono text-sm outline-none focus:border-emerald-500"
      />
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      <button
        onClick={save}
        disabled={saving || key.length < 16}
        className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-3 font-medium transition hover:bg-emerald-500 disabled:opacity-40"
      >
        {saving ? 'Guardando…' : 'Guardar y continuar'}
      </button>
    </div>
  )
}

type InstallStatus = { running: boolean; current: string | null; log: string[]; done: string[]; failed: string | null }

export function EnvStep({ state, onReady, refresh }: { state: SetupState; onReady: () => void; refresh: () => void }) {
  const missing = state.checks.filter((c) => !c.installed)
  const [installing, setInstalling] = useState(false)
  const [status, setStatus] = useState<InstallStatus | null>(null)

  useEffect(() => {
    if (!installing) return
    const t = setInterval(async () => {
      const s = await api.get<InstallStatus>('/api/setup/install/status')
      setStatus(s)
      if (!s.running) {
        setInstalling(false)
        refresh()
      }
    }, 1500)
    return () => clearInterval(t)
  }, [installing, refresh])

  const install = async () => {
    setInstalling(true)
    setStatus(null)
    await api.post('/api/setup/install', { ids: missing.map((c) => c.id) })
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="text-xl font-semibold">Paso 2 · Prepara tu entorno</h2>
      <p className="mt-2 text-sm text-neutral-400">
        Ovidee necesita estas herramientas en tu máquina. Esto es lo que hay y lo que falta —
        con el comando exacto que se ejecutará y cuánto descarga cada uno. Nada se instala sin
        tu aprobación.
      </p>

      <ul className="mt-6 space-y-2">
        {state.checks.map((c) => (
          <li key={c.id} className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {c.installed ? '✅' : '⬜'} {c.name}
                {c.optional && !c.installed && (
                  <span className="ml-2 text-xs text-neutral-500">(opcional)</span>
                )}
              </span>
              {!c.installed && <span className="text-xs text-neutral-500">{c.downloadSize}</span>}
            </div>
            <p className="mt-1 text-xs text-neutral-500">{c.detail}</p>
            {!c.installed && (
              <p className="mt-2 rounded bg-neutral-950 px-2 py-1 font-mono text-xs text-amber-300">
                {c.needsSudo ? '⚠ ejecútalo tú (requiere sudo): ' : 'se ejecutará: '}
                {c.command}
              </p>
            )}
          </li>
        ))}
      </ul>

      {missing.length > 0 ? (
        <button
          onClick={install}
          disabled={installing}
          className="mt-6 w-full rounded-lg bg-emerald-600 px-4 py-3 font-medium transition hover:bg-emerald-500 disabled:opacity-40"
        >
          {installing
            ? 'Instalando…'
            : `Aprobar e instalar ${missing.length} componente(s) (${missing.map((m) => m.downloadSize).join(' + ')})`}
        </button>
      ) : (
        <button
          onClick={onReady}
          className="mt-6 w-full rounded-lg bg-emerald-600 px-4 py-3 font-medium transition hover:bg-emerald-500"
        >
          Todo listo — ir al editor 🎬
        </button>
      )}

      {status && status.log.length > 0 && (
        <pre className="mt-4 max-h-64 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-400">
          {status.log.join('\n')}
        </pre>
      )}
      {status?.failed && (
        <p className="mt-2 text-sm text-red-400">
          Un paso falló — revisa el log. Puedes ejecutar el comando manualmente y volver a verificar.
        </p>
      )}
    </div>
  )
}
