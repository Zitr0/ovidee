'use client'

import { useEffect, useState } from 'react'
import { api } from '../lib/api'

type DashboardData = {
  totals: { projects: number; totalCostUsd: number; tokensIn: number; tokensOut: number; transcriptionSeconds: number }
  perProject: {
    project_id: string; source_filename: string; model_id: string | null
    execution_status: string; estimated_cost_usd: number; actual_cost_usd: number
    deleted_at: string | null; created_at: string
  }[]
  calls: {
    call_id: string; source_filename: string | null; model_id: string; purpose: string
    tokens_input: number; tokens_output: number; cost_usd: number; created_at: string
  }[]
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)

  useEffect(() => {
    api.get<DashboardData>('/api/dashboard').then(setData)
  }, [])

  if (!data) return <p className="text-neutral-500">cargando…</p>
  const { totals, perProject, calls } = data

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Costo total" value={`$${totals.totalCostUsd.toFixed(3)} USD`} />
        <Stat label="Proyectos" value={String(totals.projects)} />
        <Stat label="Tokens (in / out)" value={`${fmt(totals.tokensIn)} / ${fmt(totals.tokensOut)}`} />
        <Stat label="Transcripción local" value={`${Math.round(totals.transcriptionSeconds)}s · $0`} />
      </div>

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-neutral-500">
          Costo por video (estimado vs real)
        </h3>
        <div className="overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-neutral-400">
              <tr>
                <th className="px-4 py-2">Video</th>
                <th className="px-4 py-2">Modelo</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2 text-right">Estimado</th>
                <th className="px-4 py-2 text-right">Real</th>
              </tr>
            </thead>
            <tbody>
              {perProject.map((p) => (
                <tr key={p.project_id} className="border-t border-neutral-800">
                  <td className={`px-4 py-2 ${p.deleted_at ? 'text-neutral-600 line-through' : ''}`}>
                    {p.source_filename}
                  </td>
                  <td className="px-4 py-2 text-neutral-400">{p.model_id ?? '—'}</td>
                  <td className="px-4 py-2 text-neutral-400">
                    {p.deleted_at ? 'eliminado' : p.execution_status}
                  </td>
                  <td className="px-4 py-2 text-right">${p.estimated_cost_usd.toFixed(3)}</td>
                  <td className="px-4 py-2 text-right">${p.actual_cost_usd.toFixed(4)}</td>
                </tr>
              ))}
              {perProject.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-neutral-500">aún no hay proyectos</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-neutral-500">
          Llamadas a la API
        </h3>
        <div className="overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-neutral-400">
              <tr>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2">Video</th>
                <th className="px-4 py-2">Propósito</th>
                <th className="px-4 py-2">Modelo</th>
                <th className="px-4 py-2 text-right">Tokens in</th>
                <th className="px-4 py-2 text-right">Tokens out</th>
                <th className="px-4 py-2 text-right">Costo</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.call_id} className="border-t border-neutral-800">
                  <td className="px-4 py-2 text-neutral-400">{new Date(c.created_at + 'Z').toLocaleString()}</td>
                  <td className="px-4 py-2">{c.source_filename ?? '—'}</td>
                  <td className="px-4 py-2">
                    {{ edl: 'edición', plan: 'planeación', chat: 'chat' }[c.purpose] ?? c.purpose}
                  </td>
                  <td className="px-4 py-2 text-neutral-400">{c.model_id}</td>
                  <td className="px-4 py-2 text-right">{fmt(c.tokens_input)}</td>
                  <td className="px-4 py-2 text-right">{fmt(c.tokens_output)}</td>
                  <td className="px-4 py-2 text-right">${c.cost_usd.toFixed(4)}</td>
                </tr>
              ))}
              {calls.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-neutral-500">aún no hay llamadas</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  )
}

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
