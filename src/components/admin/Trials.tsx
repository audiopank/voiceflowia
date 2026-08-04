import { useEffect, useState } from 'react'
import { Loader2, AlertCircle, RefreshCw, Timer } from 'lucide-react'
import { fetchTrialUsers, situacaoTrial, type TrialUserRow, type TrialSituacao } from '../../lib/trialsAdmin'
import { TRIAL_GENERATIONS } from '../../lib/trial'
import { Button } from '../ui/button'

function formatDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}

const SITUACAO_UI: Record<TrialSituacao, { label: string; className: string }> = {
  assinante: { label: '💰 Virou assinante', className: 'bg-green-900/30 border-green-700 text-green-300' },
  ativo: { label: '🟢 Trial ativo', className: 'bg-emerald-900/30 border-emerald-700 text-emerald-300' },
  expirado: { label: '🔴 Trial expirado', className: 'bg-red-900/30 border-red-700 text-red-300' },
  nao_iniciou: { label: '🟡 Pediu e não iniciou', className: 'bg-yellow-900/30 border-yellow-700 text-yellow-300' },
}

export function Trials() {
  const [rows, setRows] = useState<TrialUserRow[]>([])
  const [loading, setLoading] = useState(true)
  // Erro e "lista vazia" são coisas diferentes: vazio só é mostrado quando a RPC
  // respondeu de verdade — senão o admin leria "ninguém pediu trial" num hiccup.
  const [erro, setErro] = useState(false)

  async function load() {
    setLoading(true)
    setErro(false)
    const data = await fetchTrialUsers()
    if (data === null) {
      setErro(true)
    } else {
      setRows(data)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const contagem = rows.reduce(
    (acc, row) => {
      acc[situacaoTrial(row)] += 1
      return acc
    },
    { assinante: 0, ativo: 0, expirado: 0, nao_iniciou: 0 } as Record<TrialSituacao, number>,
  )

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-[#8B5CF6]" />
      </div>
    )
  }

  if (erro) {
    return (
      <div className="p-4 bg-red-900/30 border border-red-700 rounded-xl flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
        <span className="text-red-300">
          Não consegui carregar a lista. Se for a primeira vez, rode o script{' '}
          <code className="text-red-200">MIGRATION_TRIALS_ADMIN.sql</code> no SQL Editor do Supabase.
        </span>
        <Button onClick={load} className="ml-auto bg-[#1A1A1A] hover:bg-[#252525] shrink-0">
          Tentar de novo
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {(Object.keys(SITUACAO_UI) as TrialSituacao[]).map((key) => (
            <span
              key={key}
              className={`text-xs px-3 py-1.5 rounded-full border ${SITUACAO_UI[key].className}`}
            >
              {SITUACAO_UI[key].label}: <b>{contagem[key]}</b>
            </span>
          ))}
        </div>
        <Button onClick={load} className="bg-[#1A1A1A] hover:bg-[#252525] flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Atualizar
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-12 bg-[#111111] border border-gray-800 rounded-2xl">
          <Timer className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">Ninguém pediu ou iniciou o trial de 7 dias ainda.</p>
        </div>
      ) : (
        <div className="bg-[#111111] border border-gray-800 rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-left border-b border-gray-800">
                <th className="p-3 font-medium">Email</th>
                <th className="p-3 font-medium">Cadastro</th>
                <th className="p-3 font-medium">Iniciou o trial</th>
                <th className="p-3 font-medium">Gerações</th>
                <th className="p-3 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const situacao = situacaoTrial(row)
                return (
                  <tr key={row.email} className="border-b border-gray-900 last:border-0">
                    <td className="p-3 text-gray-300">{row.email}</td>
                    <td className="p-3 text-gray-500">{formatDate(row.cadastro_em)}</td>
                    <td className="p-3 text-gray-500">{formatDate(row.trial_started_at)}</td>
                    <td className="p-3 text-gray-300">
                      {row.trial_started_at ? `${row.trial_generations_used} de ${TRIAL_GENERATIONS}` : '—'}
                    </td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-1 rounded-full border ${SITUACAO_UI[situacao].className}`}>
                        {SITUACAO_UI[situacao].label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-600">
        Quem usou muitas gerações e expirou sem assinar é o lead mais quente pra um follow-up de
        venda. "Pediu e não iniciou" = se cadastrou pelo link do trial mas nunca ativou.
      </p>
    </div>
  )
}
