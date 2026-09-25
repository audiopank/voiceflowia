import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Loader2, AlertCircle, MessageCircle, Copy, Check, Trash2, Sparkles, ArrowRight, FolderOpen,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { listarKits, apagarKit, textoDoKitSalvo, type KitWhatsapp } from '../lib/kitsWhatsapp'
import { BackButton } from '../components/BackButton'
import { Button } from '../components/ui/button'

export const Route = createFileRoute('/meus-kits')({
  component: MeusKits,
})

// MEUS KITS (F1, 25/09) — os Kits de Respostas de WhatsApp salvos. Molde de Meus
// Templates: sempre acessível a quem está logado (a RLS só devolve o que é do
// cliente); abrir um kit leva pro /kit-whatsapp?kit=<id>, que aplica o gate do plano.

function formatData(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function KitCard({ kit, onApagado }: { kit: KitWhatsapp; onApagado: (id: string) => void }) {
  const navigate = useNavigate()
  const [copiado, setCopiado] = useState(false)
  const [apagando, setApagando] = useState(false)
  const [erroApagar, setErroApagar] = useState('')

  async function copiar() {
    try {
      await navigator.clipboard.writeText(textoDoKitSalvo(kit))
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Clipboard bloqueado — sem feedback falso de "copiado".
    }
  }

  async function apagar() {
    if (!window.confirm(`Apagar o kit "${kit.nicho}"? As respostas somem de Meus Kits (os áudios que você já baixou continuam no seu aparelho).`)) return
    setApagando(true)
    setErroApagar('')
    const { error } = await apagarKit(kit.id)
    if (!error) {
      onApagado(kit.id)
      return
    }
    console.error('=== ERRO ao apagar kit ===', error)
    setErroApagar('Não consegui apagar agora. Tente de novo.')
    setApagando(false)
  }

  const previa = kit.respostas.slice(0, 3)

  return (
    <div className="bg-[#111111] border border-gray-800 rounded-2xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-white font-bold truncate">{kit.nicho || 'Sem nome do negócio'}</h3>
          <p className="text-gray-500 text-xs mt-0.5">
            {formatData(kit.updated_at || kit.created_at)} · {kit.respostas.length}{' '}
            {kit.respostas.length === 1 ? 'resposta' : 'respostas'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {kit.voz && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#1A1A1A] border border-gray-700 text-gray-400">
              Voz: {kit.voz}
            </span>
          )}
          {kit.tom && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#1A1A1A] border border-gray-700 text-gray-400">
              {kit.tom}
            </span>
          )}
        </div>
      </div>

      {previa.length > 0 && (
        <ul className="space-y-1">
          {previa.map((r, i) => (
            <li key={i} className="text-sm">
              <p className="text-[#22C55E] font-medium truncate">{i + 1}. {r.pergunta}</p>
              <p className="text-gray-400 line-clamp-2">{r.resposta}</p>
            </li>
          ))}
          {kit.respostas.length > previa.length && (
            <li className="text-xs text-gray-500">+ {kit.respostas.length - previa.length} respostas no kit</li>
          )}
        </ul>
      )}

      <div className="flex gap-2">
        <Button
          onClick={() => navigate({ to: '/kit-whatsapp', search: { kit: kit.id } })}
          className="flex-1 bg-[#22C55E] hover:bg-[#16A34A] flex items-center justify-center gap-2 text-sm font-bold"
        >
          <FolderOpen className="w-4 h-4" /> Abrir kit
        </Button>
        <Button
          onClick={copiar}
          className="bg-[#1A1A1A] hover:bg-[#252525] flex items-center justify-center gap-2 text-sm px-3"
          title="Copiar todas as respostas em texto"
        >
          {copiado ? <Check className="w-4 h-4 text-[#22C55E]" /> : <Copy className="w-4 h-4" />}
        </Button>
        <Button
          onClick={apagar}
          disabled={apagando}
          className="bg-[#1A1A1A] hover:bg-red-900/30 disabled:opacity-50 flex items-center justify-center gap-2 px-3"
          title="Apagar kit"
        >
          {apagando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 text-red-400" />}
        </Button>
      </div>
      {erroApagar && (
        <p className="text-amber-400 text-xs flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5" /> {erroApagar}
        </p>
      )}
    </div>
  )
}

function MeusKits() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [kits, setKits] = useState<KitWhatsapp[]>([])
  // Erro ≠ vazio: "nenhum kit ainda" só pode aparecer quando a consulta respondeu
  // de verdade — num hiccup de rede seria uma afirmação falsa.
  const [erro, setErro] = useState('')

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelado) return
      if (!user) {
        navigate({ to: '/login' })
        return
      }
      try {
        const data = await listarKits(user.id)
        if (!cancelado) setKits(data)
      } catch (err) {
        console.error('=== ERRO ao listar kits ===', err)
        if (!cancelado) setErro(err instanceof Error ? err.message : 'erro desconhecido')
      }
      if (!cancelado) setLoading(false)
    })()
    return () => {
      cancelado = true
    }
  }, [navigate])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A]">
        <Loader2 className="w-8 h-8 animate-spin text-[#22C55E]" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] p-6">
      <div className="max-w-5xl mx-auto">
        <BackButton to="/dashboard" label="Voltar ao Painel" className="mb-6" />

        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-2">
              <MessageCircle className="w-8 h-8 text-[#22C55E]" />
              Meus Kits de WhatsApp
            </h1>
            <p className="text-gray-400">
              Cada kit gerado fica guardado aqui — reabra, edite as respostas e gere os áudios quando quiser.
            </p>
          </div>
          <Button
            onClick={() => navigate({ to: '/kit-whatsapp' })}
            className="bg-[#22C55E] hover:bg-[#16A34A] font-bold flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" /> Novo kit
          </Button>
        </div>

        {erro ? (
          <div className="p-4 bg-red-900/30 border border-red-700 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <span className="text-red-300">
              Não consegui carregar seus kits agora ({erro}). Tente recarregar a página.
            </span>
          </div>
        ) : kits.length === 0 ? (
          <div className="text-center py-16 bg-[#111111] border border-gray-800 rounded-2xl">
            <MessageCircle className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Nenhum kit salvo ainda</h2>
            <p className="text-gray-400 mb-6">
              Gere seu primeiro Kit de Respostas de WhatsApp — ele é salvo aqui automaticamente.
            </p>
            <Button
              onClick={() => navigate({ to: '/kit-whatsapp' })}
              className="bg-[#22C55E] hover:bg-[#16A34A] font-bold flex items-center gap-2 mx-auto"
            >
              Criar meu primeiro kit
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {kits.map((k) => (
              <KitCard key={k.id} kit={k} onApagado={(id) => setKits((prev) => prev.filter((x) => x.id !== id))} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
