import { useState } from 'react'
import { MessagesSquare, Loader2, X, RefreshCw } from 'lucide-react'
import { Button } from './ui/button'
import { fetchWithRetry, safeJson, friendlyApiError } from '../lib/apiRetry'
import { LIMITE_AVISO, LIMITE_TEXTO } from '../lib/limites'
import { TRILHAS_DIALOGO } from '../lib/estudioCards'
import {
  FALANTE_CLIENTE,
  FALANTE_DONO,
  VOZES_DIALOGO,
  VOZES_PADRAO,
  tamanhoDialogo,
  segundosEstimados,
  dialogoLongoDemais,
  type Dialogo,
  type Fala,
} from '../lib/dialogo'

// Painel do Modo Diálogo num card: transforma o roteiro de uma voz só numa conversa
// entre o cliente (levantando a objeção) e o dono (respondendo).
//
// Fica ABAIXO do roteiro e ACIMA do botão de áudio de propósito: o cliente lê o roteiro
// normal, decide virar diálogo, edita as falas e só então gera a locução. Enquanto houver
// um diálogo aqui, é ELE que vira áudio — o botão de gerar muda de rótulo pra deixar isso
// explícito, senão o cliente clicaria em "Gerar Áudio" sem saber qual texto seria falado.
export function ModoDialogo({
  hook,
  roteiro,
  nicho,
  tom,
  dialogo,
  onChange,
  disabled,
}: {
  hook: string
  roteiro: string
  nicho: string
  tom: string
  dialogo: Dialogo | null
  onChange: (d: Dialogo | null) => void
  disabled?: boolean
}) {
  const [gerando, setGerando] = useState(false)
  const [erro, setErro] = useState('')

  async function gerar() {
    setErro('')
    setGerando(true)
    try {
      const res = await fetchWithRetry('/api/gemini/gerar-dialogo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hook, roteiro, nicho, tom }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(friendlyApiError(res.status, data?.error))
      }
      // safeJson (nao res.json() cru): num 504/erro de plataforma a Vercel devolve HTML
      // e o .json() estouraria um SyntaxError ilegivel na tela do cliente.
      const data = await safeJson(res)
      const falas: Fala[] = Array.isArray(data?.falas) ? data.falas : []
      if (!falas.length) throw new Error('A IA não devolveu falas.')
      // Vozes e cama só entram no estado se ainda não havia diálogo: refazer as falas não
      // deve desfazer a escolha de voz nem a trilha que o cliente já tinha feito.
      onChange({
        falas,
        vozes: dialogo?.vozes ?? { ...VOZES_PADRAO },
        trilhaId: dialogo?.trilhaId ?? null,
      })
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui montar o diálogo.')
    } finally {
      setGerando(false)
    }
  }

  if (!dialogo) {
    return (
      <div className="space-y-1">
        <Button
          onClick={gerar}
          disabled={disabled || gerando || (!hook.trim() && !roteiro.trim())}
          title="Reescreve este roteiro como uma conversa de duas vozes — o cliente perguntando e você respondendo"
          className="w-full bg-transparent border border-[#8B5CF6]/50 text-[#C4B5FD] hover:bg-[#8B5CF6]/10 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessagesSquare className="w-4 h-4" />}
          {gerando ? 'Montando a conversa…' : 'Transformar em diálogo'}
        </Button>
        {erro && <p className="text-yellow-500 text-xs">{erro}</p>}
      </div>
    )
  }

  const total = tamanhoDialogo(dialogo.falas)
  const longo = dialogoLongoDemais(dialogo.falas)

  function editarFala(i: number, texto: string) {
    if (!dialogo) return
    onChange({ ...dialogo, falas: dialogo.falas.map((f, n) => (n === i ? { ...f, texto } : f)) })
  }

  function trocarVoz(papel: string, voz: string) {
    if (!dialogo) return
    onChange({ ...dialogo, vozes: { ...dialogo.vozes, [papel]: voz } })
  }

  return (
    <div className="rounded-lg border border-[#8B5CF6]/40 bg-[#8B5CF6]/5 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <MessagesSquare className="w-3.5 h-3.5 text-[#C4B5FD] shrink-0" />
        <span className="text-xs text-[#C4B5FD] font-medium">Diálogo — 2 vozes</span>
        <button
          onClick={gerar}
          disabled={gerando}
          title="Montar outra versão da conversa"
          className="ml-auto text-gray-500 hover:text-gray-300 disabled:opacity-50"
        >
          {gerando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={() => onChange(null)}
          title="Descartar o diálogo e voltar pro roteiro de uma voz só"
          className="text-gray-500 hover:text-gray-300"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-1.5">
        {dialogo.falas.map((fala, i) => (
          <div key={i} className="flex gap-2 items-start">
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 mt-1 ${
                fala.quem === FALANTE_CLIENTE
                  ? 'bg-[#0EA5A4]/20 text-[#5EEAD4]'
                  : 'bg-[#8B5CF6]/20 text-[#C4B5FD]'
              }`}
            >
              {fala.quem}
            </span>
            <textarea
              value={fala.texto}
              onChange={(e) => editarFala(i, e.target.value)}
              rows={2}
              className="flex-1 min-w-0 bg-[#0A0A0A] border border-gray-800 rounded p-1.5 text-xs text-gray-200 resize-y focus:outline-none focus:border-[#8B5CF6]"
            />
          </div>
        ))}
      </div>

      {/* Cama de conversa: exclusiva do Modo Diálogo. Estas duas NÃO estão em
          TRILHAS_PRONTAS, então nunca aparecem como opção pra um spot de uma voz só.
          Nenhuma marcada é o padrão — clicar de novo na ativa desliga. */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-[11px] text-gray-500">Cama:</span>
        {TRILHAS_DIALOGO.map((t) => {
          const ativa = dialogo.trilhaId === t.id
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={ativa}
              onClick={() => onChange({ ...dialogo, trilhaId: ativa ? null : t.id })}
              className={`text-[11px] rounded-full border px-2 py-0.5 transition-colors ${
                ativa
                  ? 'border-[#8B5CF6] bg-[#8B5CF6]/15 text-white'
                  : 'border-gray-700 bg-[#0F0F0F] text-gray-400 hover:border-gray-500 hover:text-white'
              }`}
            >
              {t.emoji} {t.label}
            </button>
          )
        })}
        {!dialogo.trilhaId && <span className="text-[11px] text-gray-600">nenhuma</span>}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {[FALANTE_CLIENTE, FALANTE_DONO].map((papel) => (
          <label key={papel} className="flex items-center gap-1 text-[11px] text-gray-400">
            {papel}:
            <select
              value={dialogo.vozes[papel] ?? VOZES_PADRAO[papel]}
              onChange={(e) => trocarVoz(papel, e.target.value)}
              className="bg-[#1A1A1A] border border-gray-700 rounded px-1.5 py-0.5 text-[11px] text-white focus:outline-none focus:border-[#8B5CF6]"
            >
              {VOZES_DIALOGO.map((v) => (
                <option key={v.voice_id} value={v.voice_id}>
                  {v.name}{v.vibe ? ` (${v.vibe})` : ''}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {/* Contador só aparece perto do teto — antes disso ele só poluiria (mesma regra do
          aviso de roteiro longo). O tempo é ESTIMADO e a tela diz isso. */}
      {total > LIMITE_AVISO && (
        <p className={`text-[11px] ${longo ? 'text-red-400' : 'text-yellow-500'}`}>
          {total}/{LIMITE_TEXTO} caracteres · cerca de {segundosEstimados(dialogo.falas)}s de áudio
          {longo && ' — encurte alguma fala pra conseguir gerar a locução.'}
        </p>
      )}

      {dialogo.vozes[FALANTE_CLIENTE] === dialogo.vozes[FALANTE_DONO] && (
        <p className="text-[11px] text-yellow-500">
          As duas falas estão com a mesma voz — escolha vozes diferentes pra soar como conversa.
        </p>
      )}

      {erro && <p className="text-yellow-500 text-xs">{erro}</p>}
    </div>
  )
}
