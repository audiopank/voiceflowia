import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, Mic, Pencil, Tag } from 'lucide-react'
import { Button } from './ui/button'
import { GravarBriefing } from './GravarBriefing'
import { carregarMinhaMarca, salvarDescricaoMarca, LIMITE_DESCRICAO } from '../lib/minhaMarca'
import { fetchWithRetry, friendlyApiError, safeJson } from '../lib/apiRetry'
import { realcarVoz, aplicarTrilha, TRILHAS_PRONTAS } from '../lib/estudioCards'
import { blobToAudioBuffer } from '../lib/audioMix'
import { convertVoiceToMp3 } from '../lib/audioConvert'
import { conferirPostDaMarca } from '../lib/conferirCatalogo'
import { GEMINI_VOICES_TEXTO_LONGO } from '../lib/voices'

// Card do Dashboard (12/11/2026): o cliente conta sobre a marca UMA vez e o texto fica na
// conta. Super Agente (Comece rápido), Catálogo e Kit de WhatsApp (Fatos da marca) já abrem
// com ele preenchido. O exemplo mostra só o que o VoiceFlow entrega de verdade, e tem a linha
// "O que NÃO fazemos" — é ela que deixa a conferência de promessas funcionar.
const EXEMPLO = `Padaria de bairro em Fortaleza que assa tudo de madrugada. Pão de fermentação natural e bolo de pote a R$ 12. Entregamos no Centro e na Aldeota; Pix e cartão.
Sensação: acolhedora, cheiro de forno, conversa de vizinho.
O que NÃO fazemos: não temos frete grátis, não abrimos aos domingos.
Quero: posts pro Instagram, locução pro status do WhatsApp e respostas prontas pro WhatsApp.`

// "Ouça a sua marca" (23/11/2026): spot de ~30 s com a descrição salva — roteiro (IA, só os fatos
// da descrição), voz, Realce Profissional e trilha. O cliente ouve a marca dele no 1º minuto.
// Não gasta geração do plano (como o "Preencher com IA"); só aparece pra quem tem acesso.
const TRILHA_DO_SPOT = TRILHAS_PRONTAS[0] // Business
const VOLUME_TRILHA_SPOT = 20

function OuvirMarca({ descricao }: { descricao: string }) {
  const [etapa, setEtapa] = useState<'parado' | 'escrevendo' | 'gravando' | 'pronto'>('parado')
  const [aviso, setAviso] = useState('')
  const [erro, setErro] = useState('')
  const [roteiro, setRoteiro] = useState('')
  const [semTrilha, setSemTrilha] = useState(false)
  const [audioUrl, setAudioUrl] = useState('')
  // Locutor (23/11, pedido do Mestre): só as vozes rápidas — as outras passam do teto de tempo.
  const [voz, setVoz] = useState('Puck')
  const finalRef = useRef<Blob | null>(null)
  const urlRef = useRef('')
  const vivoRef = useRef(true)
  useEffect(() => {
    vivoRef.current = true
    return () => { vivoRef.current = false; if (urlRef.current) URL.revokeObjectURL(urlRef.current) }
  }, [])

  async function gerar() {
    setErro(''); setAviso('')
    try {
      setEtapa('escrevendo')
      const r1 = await fetchWithRetry('/api/gemini/spot-da-marca', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ descricao }),
      }, { retries: 1, onWait: (s) => setAviso(`⏳ Muita procura na IA agora — tentando de novo em ${s}s...`) })
      if (!r1.ok) {
        const d = await r1.json().catch(() => null)
        throw new Error(friendlyApiError(r1.status, d?.error))
      }
      const texto = String((await safeJson(r1))?.roteiro || '').trim()
      if (!texto) throw new Error('A IA respondeu sem o roteiro. Tente de novo.')

      setEtapa('gravando'); setAviso('')
      const r2 = await fetchWithRetry('/api/gemini/text-to-speech', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: texto, voiceName: voz }),
      }, { onWait: (s) => setAviso(`⏳ Muita procura na voz agora — tentando de novo em ${s}s...`) })
      if (!r2.ok) {
        const d = await r2.json().catch(() => null)
        throw new Error(friendlyApiError(r2.status, d?.error))
      }
      const gravada = await realcarVoz(await r2.blob())

      // Trilha: se não carregar, o spot sai só com a voz — e a tela diz isso (nunca calado).
      let trilha: AudioBuffer | null = null
      try {
        const t = await fetch(`/trilhas/${TRILHA_DO_SPOT.file}`)
        const b = t.ok ? await t.blob() : null
        if (b && b.type.startsWith('audio')) trilha = await blobToAudioBuffer(b)
      } catch { /* segue sem trilha */ }
      const final = await aplicarTrilha(gravada, trilha, VOLUME_TRILHA_SPOT)
      if (!vivoRef.current) return // saiu da tela no meio (ex.: Editar): não cria URL que ninguém revoga

      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = URL.createObjectURL(final)
      finalRef.current = final
      setSemTrilha(!trilha)
      setRoteiro(texto)
      setAudioUrl(urlRef.current)
      setAviso('')
      setEtapa('pronto')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui montar o spot agora.')
      setAviso('')
      setEtapa(audioUrl ? 'pronto' : 'parado')
    }
  }

  async function baixar() {
    if (!finalRef.current) return
    const { blob, ext } = await convertVoiceToMp3(finalRef.current)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `spot-da-minha-marca.${ext}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  const ocupado = etapa === 'escrevendo' || etapa === 'gravando'
  const promessas = roteiro ? conferirPostDaMarca({ gancho: '', legenda: roteiro, locucao: '' }, descricao).avisos : []

  return (
    <div className="border-t border-gray-800 pt-4 space-y-3" data-testid="ouvir-marca">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="spot-voz" className="text-xs text-gray-400">Locutor</label>
        <select id="spot-voz" value={voz} onChange={(e) => setVoz(e.target.value)} disabled={ocupado}
          className="bg-[#1A1A1A] border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-[#8B5CF6] disabled:opacity-60">
          {GEMINI_VOICES_TEXTO_LONGO.map((v) => <option key={v.voice_id} value={v.voice_id}>{v.name} — {v.vibe}</option>)}
        </select>
        <Button onClick={gerar} disabled={ocupado} className="bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-60 flex items-center gap-2">
          {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
          {etapa === 'escrevendo' ? 'Escrevendo o roteiro...' : etapa === 'gravando' ? 'Gravando a voz...' : audioUrl ? 'Gerar outro spot' : 'Ouvir o spot da minha marca'}
        </Button>
        <span className="text-xs text-gray-500">Um spot de ~30 s com a sua descrição, voz e trilha. Não gasta geração do seu plano.</span>
      </div>
      {aviso && <p className="text-xs text-amber-400">{aviso}</p>}
      {erro && <p className="text-sm text-amber-400">{erro}</p>}
      {audioUrl && (
        <div className="space-y-2">
          <audio controls src={audioUrl} className="w-full" data-testid="spot-player" />
          {semTrilha && <p className="text-xs text-gray-500">A trilha não carregou agora — este spot saiu só com a voz.</p>}
          <details className="text-sm text-gray-300">
            <summary className="cursor-pointer text-xs text-gray-400">Ver o roteiro</summary>
            <p className="mt-2 whitespace-pre-line" data-testid="spot-roteiro">{roteiro}</p>
          </details>
          {promessas.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200" data-testid="spot-avisos">
              <p className="font-semibold mb-1">⚠️ Confira antes de usar este spot</p>
              <ul className="list-disc pl-4 space-y-0.5">{promessas.map((a, i) => <li key={i}>{a.replace(/no briefing/g, 'na sua descrição')}</li>)}</ul>
              <p className="mt-1 text-amber-300/70">Se for verdade, escreva na sua descrição. Se não for, gere outro spot.</p>
            </div>
          )}
          <Button onClick={baixar} className="bg-[#1A1A1A] hover:bg-[#252525] text-sm flex items-center gap-2">
            <Download className="w-4 h-4" /> Baixar MP3
          </Button>
        </div>
      )}
    </div>
  )
}

export function MinhaMarcaCard({ podeOuvir = false }: { podeOuvir?: boolean }) {
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
      <div className="mb-8 bg-[#111111] border border-gray-800 rounded-xl p-4 space-y-4">
      <div className="flex items-start gap-3" data-testid="minha-marca-compacto">
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
      {podeOuvir && <OuvirMarca descricao={salva} />}
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
