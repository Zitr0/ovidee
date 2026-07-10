'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, SetupState } from './lib/api'
import { ApiKeyStep, EnvStep } from './components/Setup'
import { Editor } from './components/Editor'
import { Dashboard } from './components/Dashboard'

type View = 'loading' | 'apikey' | 'env' | 'app' | 'offline'

export default function Home() {
  const [setup, setSetup] = useState<SetupState | null>(null)
  const [view, setView] = useState<View>('loading')
  const [tab, setTab] = useState<'editor' | 'dashboard'>('editor')

  const refresh = useCallback(async () => {
    try {
      const s = await api.get<SetupState>('/api/setup/state')
      setSetup(s)
      if (!s.hasApiKey) setView('apikey')
      else if (!s.allInstalled) setView('env')
      else setView('app')
    } catch {
      setView('offline')
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">🎬 Ovidee</h1>
          <p className="text-sm text-neutral-500">
            Edición de video con IA, local-first — tu metraje nunca sale de tu máquina
          </p>
        </div>
        {view === 'app' && (
          <nav className="flex gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1 text-sm">
            <TabButton active={tab === 'editor'} onClick={() => setTab('editor')}>Editor</TabButton>
            <TabButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>Costos</TabButton>
          </nav>
        )}
      </header>

      {view === 'loading' && <p className="text-neutral-500">conectando…</p>}
      {view === 'offline' && (
        <p className="rounded-lg bg-red-950 px-4 py-3 text-red-300">
          Backend no disponible — ejecuta <code>pnpm dev</code> en la raíz del proyecto.
        </p>
      )}
      {view === 'apikey' && setup && <ApiKeyStep state={setup} onSaved={refresh} />}
      {view === 'env' && setup && <EnvStep state={setup} onReady={() => setView('app')} refresh={refresh} />}
      {view === 'app' && (tab === 'editor' ? <Editor /> : <Dashboard />)}

      <footer className="mt-16 border-t border-neutral-800 pt-6 text-sm text-neutral-400">
        <p>
          Ovidee es gratuito y open source. Si te resulta útil, puedes apoyar el proyecto —
          las donaciones no desbloquean nada: todo es y seguirá siendo libre.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <a
            href="https://buymeacoffee.com/supportprojects"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-yellow-600/40 bg-yellow-950/40 px-4 py-1.5 text-yellow-300 transition hover:bg-yellow-900/40"
          >
            ☕ Buy Me a Coffee
          </a>
          <a
            href="https://link.mercadopago.com.co/buymeacoffeecolombia"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-sky-600/40 bg-sky-950/40 px-4 py-1.5 text-sky-300 transition hover:bg-sky-900/40"
          >
            💛 MercadoPago (Colombia)
          </a>
        </div>
      </footer>
    </main>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-4 py-1.5 transition ${active ? 'bg-neutral-700' : 'text-neutral-400 hover:text-neutral-200'}`}
    >
      {children}
    </button>
  )
}
