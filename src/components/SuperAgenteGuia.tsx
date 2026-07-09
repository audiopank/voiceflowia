import { useState } from 'react'
import {
  Bot, Sparkles, Loader2, ChevronRight, ChevronLeft, Minus, Check, Lightbulb, Copy
} from 'lucide-react'
import { fetchWithRetry, safeJson } from '../lib/apiRetry'

interface Suggestions {
  servicos: string[]
  tomMarca: string[]
  cta: string[]
}

interface Hook {
  hook: string
  angle: string
}

interface Props {
  // Valores atuais do formulário (para habilitar a IA e evitar duplicar serviços).
  nicho: string
  servicos: string
  // Ações que preenchem os campos do formulário do Super Agente.
  onAppendServico: (servico: string) => void
  onSetTomMarca: (v: string) => void
  onSetCta: (v: string) => void
}

interface Step {
  title: string
  body: string
  // Passo do Estudo de Marca é o único que mostra as sugestões da IA (chips).
  showSuggestions?: boolean
  // V1.7 — Passo das "Ideias Desta Semana" (hooks prontos em cards).
  showHooks?: boolean
}

const STEPS: Step[] = [
  {
    title: 'Oi! Eu sou seu Agente Guia 👋',
    body: 'Vou te ajudar a montar o conteúdo do mês do seu cliente em poucos minutos. É só seguir os passos. Bora?',
  },
  {
    title: 'Passo 1 — Nicho da Agência',
    body: 'Comece dizendo o segmento do cliente no campo "Nicho da Agência". Ex: Barbearia, Clínica de Estética, Pet Shop, Advocacia.',
  },
  {
    title: 'Passo 2 — Ideias Desta Semana 💡',
    body: 'Sem saber por onde começar? Me diz o objetivo do cliente e eu te dou 3 ideias de post prontas para gravar. Copie a que mais amar.',
    showHooks: true,
  },
  {
    title: 'Passo 3 — Tom e Voz',
    body: 'Escolha o "Tom de Voz" do conteúdo e a "Voz da IA" que vai narrar. Na dúvida, deixe a Voz em "Automático" que a IA escolhe a melhor para cada roteiro.',
  },
  {
    title: 'Passo 4 — Estudo de Marca ✨',
    body: 'Aqui a mágica acontece. Preencha olhando o Instagram do cliente: quanto mais completo, mais os roteiros saem na cara da marca. Sem ideias? Deixa comigo:',
    showSuggestions: true,
  },
  {
    title: 'Passo 5 — Logo e Gerar 🚀',
    body: 'Envie a logo da marca (aparece automaticamente em todos os cards) e clique em "Gerar Estratégia + Conteúdo". Pronto: estratégia, roteiros e vozes do mês inteiro num clique!',
  },
]

export function SuperAgenteGuia({ nicho, servicos, onAppendServico, onSetTomMarca, onSetCta }: Props) {
  const [minimized, setMinimized] = useState(false)
  const [step, setStep] = useState(0)

  const [suggestions, setSuggestions] = useState<Suggestions | null>(null)
  const [loadingSug, setLoadingSug] = useState(false)
  const [sugError, setSugError] = useState('')
  // Guarda o que já foi aplicado para dar feedback visual (chip marcado).
  const [appliedTom, setAppliedTom] = useState('')
  const [appliedCta, setAppliedCta] = useState('')

  // V1.7 — Ideias Desta Semana (hooks prontos).
  const [objetivo, setObjetivo] = useState('')
  const [hooks, setHooks] = useState<Hook[] | null>(null)
  const [loadingHooks, setLoadingHooks] = useState(false)
  const [hooksError, setHooksError] = useState('')
  const [copiedHook, setCopiedHook] = useState(-1)

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1
  const servicosJaAdicionados = servicos
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  async function handleSuggest() {
    if (!nicho.trim()) {
      setSugError('Preencha o campo "Nicho da Agência" primeiro para eu sugerir sob medida.')
      return
    }
    setLoadingSug(true)
    setSugError('')
    try {
      const res = await fetchWithRetry(
        '/api/gemini/suggest-brand',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nicho: nicho.trim() }),
        },
        { onWait: (s) => setSugError(`⏳ Limite temporário. Tentando de novo em ${s}s...`) },
      )
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`)
      setSuggestions(data.suggestions)
      setSugError('')
    } catch (err) {
      setSugError(err instanceof Error ? err.message : 'Erro ao gerar sugestões')
    } finally {
      setLoadingSug(false)
    }
  }

  async function handleGerarHooks() {
    if (!nicho.trim()) {
      setHooksError('Preencha o campo "Nicho da Agência" primeiro.')
      return
    }
    setLoadingHooks(true)
    setHooksError('')
    try {
      const res = await fetchWithRetry(
        '/api/gemini/generate-hooks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nicho: nicho.trim(), objetivo: objetivo.trim() }),
        },
        { onWait: (s) => setHooksError(`⏳ Limite temporário. Tentando de novo em ${s}s...`) },
      )
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`)
      setHooks(data.hooks)
      setHooksError('')
    } catch (err) {
      setHooksError(err instanceof Error ? err.message : 'Erro ao gerar ideias')
    } finally {
      setLoadingHooks(false)
    }
  }

  async function copyHook(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedHook(i)
      setTimeout(() => setCopiedHook((c) => (c === i ? -1 : c)), 1500)
    } catch {
      // navegador sem permissão de clipboard — ignora
    }
  }

  // Minimizado: bolha flutuante que reabre o guia.
  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-full bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-bold shadow-lg shadow-[#8B5CF6]/30 transition-colors"
      >
        <Bot className="w-5 h-5" />
        Agente Guia
        <span className="absolute -top-1 -right-1 w-3 h-3 bg-[#22C55E] rounded-full animate-pulse" />
      </button>
    )
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[22rem] max-w-[calc(100vw-3rem)] bg-[#111111] border border-[#8B5CF6]/40 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#8B5CF6]/10 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-[#8B5CF6] flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-none">Agente Guia</p>
            <p className="text-[11px] text-gray-500 mt-0.5">Passo {step + 1} de {STEPS.length}</p>
          </div>
        </div>
        <button
          onClick={() => setMinimized(true)}
          title="Minimizar"
          className="text-gray-500 hover:text-white transition-colors"
        >
          <Minus className="w-5 h-5" />
        </button>
      </div>

      {/* Barra de progresso */}
      <div className="h-1 bg-[#1A1A1A]">
        <div
          className="h-1 bg-[#8B5CF6] transition-all"
          style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
        />
      </div>

      {/* Corpo */}
      <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
        <h3 className="text-sm font-bold text-white">{current.title}</h3>
        <p className="text-sm text-gray-400 leading-relaxed">{current.body}</p>

        {current.showSuggestions && (
          <div className="space-y-3 pt-1">
            <button
              onClick={handleSuggest}
              disabled={loadingSug}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white text-sm font-bold transition-colors"
            >
              {loadingSug ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Pensando no seu nicho...</>
              ) : (
                <><Sparkles className="w-4 h-4" /> {suggestions ? 'Sugerir de novo' : 'Sugerir com IA'}</>
              )}
            </button>

            {sugError && <p className="text-xs text-yellow-500">{sugError}</p>}

            {suggestions && (
              <div className="space-y-3">
                <SuggestGroup
                  label="Serviços (clique para ir montando a lista)"
                  items={suggestions.servicos}
                  isApplied={(s) => servicosJaAdicionados.includes(s.trim().toLowerCase())}
                  onPick={(s) => onAppendServico(s)}
                />
                <SuggestGroup
                  label="Tom da Marca (clique para usar)"
                  items={suggestions.tomMarca}
                  isApplied={(s) => appliedTom === s}
                  onPick={(s) => { onSetTomMarca(s); setAppliedTom(s) }}
                />
                <SuggestGroup
                  label="CTA Principal (clique para usar)"
                  items={suggestions.cta}
                  isApplied={(s) => appliedCta === s}
                  onPick={(s) => { onSetCta(s); setAppliedCta(s) }}
                />
              </div>
            )}
          </div>
        )}

        {current.showHooks && (
          <div className="space-y-3 pt-1">
            <input
              type="text"
              value={objetivo}
              onChange={(e) => setObjetivo(e.target.value)}
              placeholder="Objetivo do cliente (ex: vender aparelho)"
              className="w-full p-2 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-[#8B5CF6]"
            />
            <button
              onClick={handleGerarHooks}
              disabled={loadingHooks}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white text-sm font-bold transition-colors"
            >
              {loadingHooks ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Criando ideias...</>
              ) : (
                <><Lightbulb className="w-4 h-4" /> {hooks ? 'Gerar novas ideias' : 'Gerar ideias'}</>
              )}
            </button>

            {hooksError && <p className="text-xs text-yellow-500">{hooksError}</p>}

            {hooks && (
              <div className="space-y-2">
                {hooks.map((h, i) => (
                  <div key={i} className="rounded-lg border border-gray-700 bg-[#1A1A1A] p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#8B5CF6]/15 text-[#8B5CF6] font-bold">
                        {h.angle}
                      </span>
                    </div>
                    <p className="text-sm text-white leading-snug">{h.hook}</p>
                    <button
                      onClick={() => copyHook(i, h.hook)}
                      className={`w-full flex items-center justify-center gap-1.5 text-xs font-bold px-2 py-1.5 rounded-md border transition-colors ${
                        copiedHook === i
                          ? 'bg-[#22C55E]/15 border-[#22C55E]/50 text-[#22C55E]'
                          : 'bg-[#111111] border-gray-700 text-gray-300 hover:border-[#8B5CF6] hover:text-white'
                      }`}
                    >
                      {copiedHook === i
                        ? <><Check className="w-3.5 h-3.5" /> Copiado!</>
                        : <><Copy className="w-3.5 h-3.5" /> Usar esta ideia</>}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navegação */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:text-gray-400 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> Anterior
        </button>
        {isLast ? (
          <button
            onClick={() => setMinimized(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] text-white text-sm font-bold transition-colors"
          >
            <Check className="w-4 h-4" /> Entendi!
          </button>
        ) : (
          <button
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-bold transition-colors"
          >
            Próximo <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}

function SuggestGroup({
  label, items, isApplied, onPick,
}: {
  label: string
  items: string[]
  isApplied: (s: string) => boolean
  onPick: (s: string) => void
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((s, i) => {
          const applied = isApplied(s)
          return (
            <button
              key={i}
              onClick={() => onPick(s)}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-colors ${
                applied
                  ? 'bg-[#22C55E]/15 border-[#22C55E]/50 text-[#22C55E]'
                  : 'bg-[#1A1A1A] border-gray-700 text-gray-300 hover:border-[#8B5CF6] hover:text-white'
              }`}
            >
              {applied ? <Check className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
              {s}
            </button>
          )
        })}
      </div>
    </div>
  )
}
