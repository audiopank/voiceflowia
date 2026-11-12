import { useEffect, useState } from 'react'
import { Loader2, Pencil, Tag } from 'lucide-react'
import { Button } from './ui/button'
import { GravarBriefing } from './GravarBriefing'
import { carregarMinhaMarca, salvarDescricaoMarca, LIMITE_DESCRICAO } from '../lib/minhaMarca'

// Card do Dashboard (12/11/2026): o cliente conta sobre a marca UMA vez e o texto fica na
// conta. Super Agente (Comece rápido), Catálogo e Kit de WhatsApp (Fatos da marca) já abrem
// com ele preenchido. O exemplo mostra só o que o VoiceFlow entrega de verdade, e tem a linha
// "O que NÃO fazemos" — é ela que deixa a conferência de promessas funcionar.
const EXEMPLO = `Padaria de bairro em Fortaleza que assa tudo de madrugada. Pão de fermentação natural e bolo de pote a R$ 12. Entregamos no Centro e na Aldeota; Pix e cartão.
Sensação: acolhedora, cheiro de forno, conversa de vizinho.
O que NÃO fazemos: não temos frete grátis, não abrimos aos domingos.
Quero: posts pro Instagram, locução pro status do WhatsApp e respostas prontas pro WhatsApp.`

export function MinhaMarcaCard() {
  const [salva, setSalva] = useState<string | null>(null) // null = carregando
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [acabouDeSalvar, setAcabouDeSalvar] = useState(false)

  useEffect(() => {
    let vivo = true
    carregarMinhaMarca().then((m) => {
      if (!vivo) return
      setSalva(m?.descricao ?? '')
      setTexto(m?.descricao ?? '')
    })
    return () => { vivo = false }
  }, [])

  async function salvar() {
    setErro('')
    setSalvando(true)
    const falha = await salvarDescricaoMarca(texto)
    setSalvando(false)
    if (falha) { setErro(falha); return }
    setSalva(texto.trim())
    setEditando(false)
    setAcabouDeSalvar(true)
  }

  if (salva === null) return null

  // Já tem marca salva: card compacto, sempre à mão pra atualizar.
  if (salva && !editando) {
    return (
      <div className="mb-8 bg-[#111111] border border-gray-800 rounded-xl p-4 flex items-start gap-3" data-testid="minha-marca-compacto">
        <Tag className="w-5 h-5 text-[#22C55E] shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white">Minha marca ✅</p>
          <p className="text-xs text-gray-400 truncate">{salva}</p>
          {acabouDeSalvar && (
            <p className="text-xs text-[#22C55E] mt-1">
              Salvo na sua conta. O Super Agente, o Catálogo → Posts e o Kit de WhatsApp já abrem com este texto.
            </p>
          )}
        </div>
        <button type="button" onClick={() => { setEditando(true); setAcabouDeSalvar(false) }}
          className="text-xs text-[#8B5CF6] hover:underline flex items-center gap-1 shrink-0">
          <Pencil className="w-3.5 h-3.5" /> Editar
        </button>
      </div>
    )
  }

  return (
    <div className="mb-8 bg-gradient-to-r from-[#8B5CF6]/10 to-transparent border border-[#8B5CF6]/40 rounded-xl p-6" data-testid="minha-marca-editor">
      <h2 className="text-xl font-bold text-white mb-1">Em que você está trabalhando?</h2>
      <p className="text-gray-400 text-sm mb-3">
        Conte sobre a sua marca: o que você vende, como quer soar e o que é verdade sobre ela. Você escreve uma vez e o
        Super Agente, o Catálogo → Posts e o Kit de WhatsApp já abrem com isso preenchido.
      </p>
      <label htmlFor="minha-marca-texto" className="sr-only">Descrição da sua marca</label>
      <textarea
        id="minha-marca-texto"
        value={texto}
        onChange={(e) => setTexto(e.target.value.slice(0, LIMITE_DESCRICAO))}
        rows={6}
        placeholder={`Exemplo:\n${EXEMPLO}`}
        className="w-full p-3 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-[#8B5CF6]"
      />
      <p className="text-xs text-gray-500 mt-1">
        Dica: escreva também <b className="text-gray-300">o que você NÃO faz</b> (frete, horário, garantia). A IA usa isso pra não prometer o que não existe.
      </p>
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <Button onClick={salvar} disabled={!texto.trim() || salvando} className="bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40">
          {salvando ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</> : 'Salvar minha marca'}
        </Button>
        <GravarBriefing disabled={salvando} onTexto={(t) => setTexto((atual) => (atual.trim() ? `${atual.trim()}\n${t}` : t).slice(0, LIMITE_DESCRICAO))} />
        {salva && (
          <button type="button" onClick={() => { setTexto(salva); setEditando(false); setErro('') }} className="text-sm text-gray-500 hover:text-gray-300">
            Cancelar
          </button>
        )}
        <span className="text-xs text-gray-600 ml-auto">{texto.length}/{LIMITE_DESCRICAO}</span>
      </div>
      {erro && <p className="text-sm text-amber-400 mt-2">{erro}</p>}
    </div>
  )
}
