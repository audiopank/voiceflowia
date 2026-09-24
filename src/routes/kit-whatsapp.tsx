import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Lock, Loader2, Sparkles, Download, Copy, Check, X, AlertCircle, MessageCircle, Play, Square, Plus,
  Smartphone, Share2,
} from 'lucide-react'
import { useSubscription, devolverGeracaoTrial } from '../lib/useSubscription'
import { supabase } from '../lib/supabase'
import { fetchWithRetry, safeJson, friendlyApiError } from '../lib/apiRetry'
import { Button } from '../components/ui/button'
import { BackButton } from '../components/BackButton'
import { TONS, TOM_PADRAO } from '../lib/tons'
import { GEMINI_VOICES_TEXTO_LONGO } from '../lib/voices'
import { convertToWhatsAppOgg } from '../lib/audioConvert'
import { realcarVoz } from '../lib/estudioCards'
import { brandWhatsappKey, loadBrandWhatsapp, saveBrandWhatsapp, whatsappIncompleto, buildWaLink } from '../lib/brandWhatsapp'

export const Route = createFileRoute('/kit-whatsapp')({
  component: KitWhatsapp,
})

// KIT DE RESPOSTAS DE WHATSAPP — as perguntas que todo negócio recebe, respondidas
// na voz da marca, em TEXTO (pra colar nas respostas rápidas do WhatsApp Business)
// e em ÁUDIO (locução na voz escolhida, baixada em OGG que o WhatsApp toca como
// mensagem de voz). Nasceu de um protótipo na Base44 (23/09): o mercado de
// auto-resposta é commodity; responder o cliente com áudio na voz da marca ninguém
// faz — é a única parte que só o VoiceFlow sabe entregar, sem API do WhatsApp e
// sem risco de banir número.
//
// Regras da casa aplicadas: 1 geração de trial por kit (texto); áudio é livre e
// gerado SOB DEMANDA, um por clique (10 locuções em rajada estourariam a cota);
// áudio sempre corresponde ao texto atual (editou a resposta → o áudio antigo é
// descartado); a IA só afirma o que os FATOS DA MARCA dizem.

const PERGUNTAS_PADRAO = [
  'Quanto custa?',
  'Qual o horário de funcionamento?',
  'Onde fica / qual o endereço?',
  'Vocês entregam? Qual o prazo?',
  'Quais as formas de pagamento?',
  'Como faço pra agendar?',
  'Tem disponível / em estoque?',
  'Tem garantia?',
  'Está em promoção?',
  'Como funciona?',
]

const MAX_PERGUNTAS = 15

interface Resposta {
  pergunta: string
  resposta: string
}

function KitWhatsapp() {
  const navigate = useNavigate()
  const { hasContentAgentFeature, trial, loading: subLoading, refresh, courtesyExpired } = useSubscription()

  // Briefing (o miolo que muda de negócio pra negócio)
  const [nicho, setNicho] = useState('')
  const [tom, setTom] = useState(TOM_PADRAO)
  const [fatos, setFatos] = useState('')
  const [diferenciais, setDiferenciais] = useState('')
  const [cta, setCta] = useState('')
  const [perguntas, setPerguntas] = useState<string[]>(PERGUNTAS_PADRAO)
  const [novaPergunta, setNovaPergunta] = useState('')
  const [voz, setVoz] = useState('Zephyr')

  // Resultado
  const [respostas, setRespostas] = useState<Resposta[]>([])
  const [gerando, setGerando] = useState(false)
  const [erro, setErro] = useState('')
  const [rateNotice, setRateNotice] = useState('')
  const [copiadoIdx, setCopiadoIdx] = useState<number | null>(null)
  const [copiadoTudo, setCopiadoTudo] = useState(false)

  // Áudio — estado SEMPRE chaveado pelo índice da lista (nunca por texto da IA)
  const [audioBlobs, setAudioBlobs] = useState<Record<number, Blob>>({})
  const [gerandoAudio, setGerandoAudio] = useState<number | null>(null)
  const [tocandoIndex, setTocandoIndex] = useState<number | null>(null)
  const [convertingIndex, setConvertingIndex] = useState<number | null>(null)
  const [audioErros, setAudioErros] = useState<Record<number, string>>({})
  const audioAtivoRef = useRef<{ audio: HTMLAudioElement; url: string; index: number } | null>(null)

  // "Enviar pro seu WhatsApp" — VERSÃO HONESTA (pedido do Mestre, 24/09): o link
  // wa.me só pré-preenche TEXTO; mandar áudio pra um número exigiria a API da Meta
  // ou bot banível (vetado). No celular, a Web Share API entrega o arquivo OGG direto
  // na folha de compartilhar → WhatsApp. No computador não existe isso: só baixar.
  // O número reaproveita o WhatsApp da marca (mesmo cofre do CtaObjetivo).
  // OGG pronto por resposta: a Web Share API exige ativação do usuário RECENTE —
  // qualquer await antes do share() (TTS, ffmpeg) estoura NotAllowedError. Então:
  // 1º toque prepara e guarda aqui; 2º toque compartilha síncrono a partir do cache.
  const [oggCache, setOggCache] = useState<Record<number, Blob>>({})
  const [meuWhats, setMeuWhats] = useState('')
  const [whatsKey, setWhatsKey] = useState('')
  const [podeCompartilharArquivo] = useState(() => {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof (navigator as any).canShare !== 'function') return false
    // Sonda com um arquivo de mentira: navegador que tem share() mas recusa arquivos
    // não ganha botão — sem botão morto, e sem gastar voz + ffmpeg pra descobrir depois.
    try {
      const sonda = new File([new Uint8Array(1)], 'sonda.ogg', { type: 'audio/ogg' })
      return (navigator as any).canShare({ files: [sonda] }) === true
    } catch {
      return false
    }
  })

  useEffect(() => {
    let cancelado = false
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelado) return
      const key = brandWhatsappKey(user?.id)
      setWhatsKey(key)
      setMeuWhats(loadBrandWhatsapp(key).numero)
    })
    return () => { cancelado = true }
  }, [])

  function salvarMeuWhats() {
    if (!whatsKey) return
    const atual = loadBrandWhatsapp(whatsKey)
    saveBrandWhatsapp(whatsKey, { ...atual, numero: meuWhats.trim() })
  }

  const whatsPronto = meuWhats.trim().length > 0 && !whatsappIncompleto(meuWhats)

  function pararAudioAtivo() {
    const ativo = audioAtivoRef.current
    if (!ativo) return
    ativo.audio.pause()
    URL.revokeObjectURL(ativo.url)
    audioAtivoRef.current = null
    setTocandoIndex(null)
  }

  function adicionarPergunta() {
    const p = novaPergunta.trim()
    if (!p || perguntas.length >= MAX_PERGUNTAS) return
    setPerguntas((prev) => [...prev, p])
    setNovaPergunta('')
  }

  function removerPergunta(idx: number) {
    setPerguntas((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleGerar() {
    if (!nicho.trim() || perguntas.length === 0 || gerando) return

    // Trial: o kit de texto consome 1 das 10 gerações (é conteúdo de IA). O áudio,
    // depois, é livre — regra da casa: conteúdo conta, voz não.
    if (trial.isTrial) {
      const { error: trialErr } = await supabase.rpc('use_trial_generation')
      if (trialErr) {
        await refresh()
        setErro('Seu trial acabou. Assine para continuar gerando.')
        return
      }
    }

    pararAudioAtivo()
    setGerando(true)
    setErro('')
    setRateNotice('')
    try {
      const response = await fetchWithRetry(
        '/api/gemini/gerar-kit-whatsapp',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nicho, tom, fatos, diferenciais, cta, perguntas }),
        },
        { onWait: (s) => setRateNotice(`⏳ Muita procura agora — tentando de novo em ${s}s...`) },
      )
      setRateNotice('')

      if (!response.ok) {
        const errData = await response.json().catch(() => null)
        throw new Error(friendlyApiError(response.status, errData?.error))
      }

      const data = await safeJson(response)
      const lista: Resposta[] = Array.isArray(data.respostas) ? data.respostas : []
      if (lista.length === 0 || lista.every((r) => !r.resposta)) {
        throw new Error('A IA não retornou respostas. Tente de novo.')
      }
      setRespostas(lista)
      // Kit novo = áudios antigos não valem mais (texto mudou).
      setAudioBlobs({})
      setOggCache({})
      setAudioErros({})
      if (trial.isTrial) void refresh()
    } catch (err) {
      setRateNotice('')
      // Nada foi entregue: devolve a geração debitada antes da chamada à IA (todos os
      // caminhos de falha, inclusive queda de rede — padrão do Card Mágico).
      if (trial.isTrial) {
        await devolverGeracaoTrial()
        void refresh()
      }
      setErro(err instanceof Error ? err.message : 'Não foi possível gerar o kit agora.')
    } finally {
      setGerando(false)
    }
  }

  function editarResposta(idx: number, texto: string) {
    setRespostas((prev) => prev.map((r, i) => (i === idx ? { ...r, resposta: texto } : r)))
    // Texto mudou → o áudio gerado antes não corresponde mais; descarta pra nunca
    // entregar locução de uma versão antiga.
    setAudioBlobs((prev) => {
      if (!prev[idx]) return prev
      const proximo = { ...prev }
      delete proximo[idx]
      return proximo
    })
    setOggCache((prev) => {
      if (!prev[idx]) return prev
      const proximo = { ...prev }
      delete proximo[idx]
      return proximo
    })
    if (audioAtivoRef.current?.index === idx) pararAudioAtivo()
  }

  // Gera (ou reaproveita) a locução DESTA resposta. Sob demanda de propósito.
  async function obterAudio(idx: number): Promise<Blob | null> {
    const existente = audioBlobs[idx]
    if (existente) return existente
    const texto = respostas[idx]?.resposta?.trim()
    if (!texto) return null

    setGerandoAudio(idx)
    setAudioErros((prev) => ({ ...prev, [idx]: '' }))
    try {
      const response = await fetchWithRetry(
        '/api/gemini/text-to-speech',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: texto, voiceName: voz }),
        },
        { onWait: (s) => setAudioErros((prev) => ({ ...prev, [idx]: `⏳ Muita procura — tentando de novo em ${s}s...` })) },
      )
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(friendlyApiError(response.status, data?.error))
      }
      const bruto = await response.blob()
      const polido = await realcarVoz(bruto)
      setAudioBlobs((prev) => ({ ...prev, [idx]: polido }))
      setAudioErros((prev) => ({ ...prev, [idx]: '' }))
      return polido
    } catch (err) {
      setAudioErros((prev) => ({
        ...prev,
        [idx]: err instanceof Error ? err.message : 'Não consegui gerar o áudio agora.',
      }))
      return null
    } finally {
      setGerandoAudio(null)
    }
  }

  async function handleOuvir(idx: number) {
    // Mesmo botão: se ESTA resposta já toca, para. Sempre para o que estiver no ar
    // antes de começar outro — no máximo um áudio no ar.
    const jaTocavaEssa = audioAtivoRef.current?.index === idx
    pararAudioAtivo()
    if (jaTocavaEssa) return

    const blob = await obterAudio(idx)
    if (!blob) return
    let url = ''
    try {
      url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      const soltar = () => {
        URL.revokeObjectURL(url)
        if (audioAtivoRef.current?.audio === audio) {
          audioAtivoRef.current = null
          setTocandoIndex(null)
        }
      }
      audio.addEventListener('ended', soltar, { once: true })
      audio.addEventListener('error', soltar, { once: true })
      pararAudioAtivo()
      audioAtivoRef.current = { audio, url, index: idx }
      setTocandoIndex(idx)
      await audio.play()
    } catch (err) {
      console.error('=== ERRO ao tocar áudio (kit) ===', err)
      if (url) URL.revokeObjectURL(url)
      if (audioAtivoRef.current?.url === url) {
        audioAtivoRef.current = null
        setTocandoIndex(null)
      }
      setAudioErros((prev) => ({ ...prev, [idx]: 'Não foi possível tocar o áudio agora. Tente de novo ou use o Baixar.' }))
    }
  }

  // OGG/Opus é o único formato que o WhatsApp toca como mensagem de voz.
  async function handleBaixar(idx: number) {
    const blob = await obterAudio(idx)
    if (!blob) return
    setConvertingIndex(idx)
    try {
      const ogg = await convertToWhatsAppOgg(blob, 'wav')
      // Já deixa pronto pro "Compartilhar áudio": Baixar → Compartilhar não converte 2x.
      setOggCache((prev) => ({ ...prev, [idx]: ogg }))
      const url = URL.createObjectURL(ogg)
      const a = document.createElement('a')
      a.href = url
      a.download = `resposta-whatsapp-${idx + 1}.ogg`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('=== ERRO ao baixar áudio (kit) ===', err)
      setAudioErros((prev) => ({ ...prev, [idx]: 'Não consegui preparar o arquivo pra baixar. Tente de novo.' }))
    } finally {
      setConvertingIndex(null)
    }
  }

  // Abre o WhatsApp no número informado com o TEXTO já digitado — o cliente só toca
  // em enviar (pra si mesmo, vira a conversa "Você").
  function enviarTexto(idx: number) {
    const r = respostas[idx]
    if (!r?.resposta.trim() || !whatsPronto) return
    window.open(buildWaLink(meuWhats, r.resposta, true), '_blank', 'noopener,noreferrer')
  }

  // Celular: OGG vai pra folha de compartilhar do sistema — o cliente escolhe o
  // WhatsApp e o contato (inclusive ele mesmo). Só aparece onde o navegador suporta.
  async function compartilharAudio(idx: number) {
    const pronto = oggCache[idx]
    if (pronto) {
      // 2º toque: share() SÍNCRONO a partir do cache — nenhum await antes dele.
      const arquivo = new File([pronto], `resposta-whatsapp-${idx + 1}.ogg`, { type: pronto.type || 'audio/ogg' })
      if (!(navigator as any).canShare?.({ files: [arquivo] })) {
        setAudioErros((prev) => ({ ...prev, [idx]: 'Este navegador não compartilha arquivos de áudio. Use o Baixar e envie pelo WhatsApp.' }))
        return
      }
      navigator.share({ files: [arquivo], title: `Resposta ${idx + 1}` }).catch((err) => {
        // Fechar a folha de compartilhar não é erro.
        if ((err as any)?.name === 'AbortError') return
        console.error('=== ERRO ao compartilhar áudio (kit) ===', err)
        setAudioErros((prev) => ({ ...prev, [idx]: 'Não consegui abrir o compartilhar. Use o Baixar e envie o arquivo pelo WhatsApp.' }))
      })
      return
    }
    // 1º toque: prepara (voz + OGG) e guarda; o botão vira "Compartilhar áudio".
    const blob = await obterAudio(idx)
    if (!blob) return
    setConvertingIndex(idx)
    try {
      const ogg = await convertToWhatsAppOgg(blob, 'wav')
      setOggCache((prev) => ({ ...prev, [idx]: ogg }))
    } catch (err) {
      console.error('=== ERRO ao preparar áudio pra compartilhar (kit) ===', err)
      setAudioErros((prev) => ({ ...prev, [idx]: 'Não consegui preparar o áudio. Tente de novo ou use o Baixar.' }))
    } finally {
      setConvertingIndex(null)
    }
  }

  async function copiar(texto: string, idx: number | 'tudo') {
    try {
      await navigator.clipboard.writeText(texto)
      if (idx === 'tudo') {
        setCopiadoTudo(true)
        setTimeout(() => setCopiadoTudo(false), 2000)
      } else {
        setCopiadoIdx(idx)
        setTimeout(() => setCopiadoIdx(null), 2000)
      }
    } catch {
      // clipboard bloqueado — ignora silenciosamente
    }
  }

  function textoDoKit(): string {
    return respostas
      .map((r, i) => `${i + 1}. ${r.pergunta}\n${r.resposta}`)
      .join('\n\n')
  }

  if (subLoading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white">
        <div className="container mx-auto p-4 py-8">
          <h1 className="text-3xl font-bold mb-6">Carregando...</h1>
        </div>
      </div>
    )
  }

  if (!hasContentAgentFeature) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white">
        <div className="container mx-auto p-4 py-8 max-w-2xl">
          <BackButton to="/dashboard" label="Voltar" className="mb-6" />
          <div className="bg-[#111111] border border-gray-800 rounded-2xl p-10 text-center">
            <Lock className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Kit de Respostas de WhatsApp 🔒</h1>
            <p className="text-gray-400 mb-6">
              As perguntas que todo cliente faz, respondidas na voz da sua marca — em texto pra
              colar nas respostas rápidas e em áudio pra mandar como mensagem de voz.
              {courtesyExpired
                ? ' Sua cortesia encerrou — assine pra continuar.'
                : ' Disponível nos planos Crescimento e Dominação.'}
            </p>
            <Button onClick={() => navigate({ to: '/precos' })} className="bg-[#8B5CF6] hover:bg-[#7C3AED]">
              Ver Planos
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const podeGerar = nicho.trim().length > 0 && perguntas.length > 0 && !gerando

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <div className="container mx-auto p-4 py-8 max-w-5xl">
        <BackButton to="/dashboard" label="Voltar" className="mb-4" />

        <div className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <MessageCircle className="w-8 h-8 text-[#22C55E]" />
            Kit de Respostas de WhatsApp
          </h1>
          <p className="text-gray-400 mt-1">
            As perguntas que todo cliente manda, respondidas na voz da sua marca. Cole o texto nas
            respostas rápidas do WhatsApp Business — ou mande em áudio, com a voz que você escolher.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Coluna esquerda: briefing */}
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Seu negócio *</label>
              <input
                type="text"
                value={nicho}
                onChange={(e) => setNicho(e.target.value)}
                placeholder="Ex: Barbearia do Messias, em Fortaleza"
                className="w-full bg-[#111111] border border-gray-800 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 focus:border-[#8B5CF6] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Fatos da sua marca <span className="text-gray-500 font-normal">(a IA só afirma o que estiver aqui)</span>
              </label>
              <textarea
                value={fatos}
                onChange={(e) => setFatos(e.target.value)}
                rows={5}
                placeholder={'Ex: Seg a sáb, 9h às 19h. Rua das Flores, 120 — Centro. Corte R$ 45, barba R$ 30. Pix, cartão e dinheiro. Agendamento pelo WhatsApp. Não entregamos.'}
                className="w-full bg-[#111111] border border-gray-800 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 focus:border-[#8B5CF6] focus:outline-none resize-none text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                Preço, horário, endereço, entrega, pagamento… O que não estiver aqui a IA <strong>não inventa</strong>:
                ela pede o dado ao cliente em vez de chutar.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Diferenciais <span className="text-gray-500 font-normal">(opcional)</span>
              </label>
              <textarea
                value={diferenciais}
                onChange={(e) => setDiferenciais(e.target.value)}
                rows={2}
                placeholder="Ex: 15 anos de experiência, atendimento com hora marcada, produtos profissionais"
                className="w-full bg-[#111111] border border-gray-800 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 focus:border-[#8B5CF6] focus:outline-none resize-none text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Chamada para ação <span className="text-gray-500 font-normal">(opcional)</span>
              </label>
              <input
                type="text"
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder="Ex: Quer agendar? Me manda o dia e o horário 😉"
                className="w-full bg-[#111111] border border-gray-800 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 focus:border-[#8B5CF6] focus:outline-none text-sm"
              />
            </div>

            {/* Tom de voz */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">🎭 Tom das respostas</label>
              <div className="flex flex-wrap gap-2">
                {TONS.map((t) => {
                  const ativo = tom === t.value
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setTom(t.value)}
                      aria-pressed={ativo}
                      className={`text-sm rounded-full border px-3 py-1.5 transition-colors ${
                        ativo
                          ? 'border-[#8B5CF6] bg-[#8B5CF6]/15 text-white'
                          : 'border-gray-700 bg-[#111111] text-gray-400 hover:border-gray-500 hover:text-white'
                      }`}
                    >
                      {t.emoji} {t.value}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Perguntas */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Perguntas dos clientes <span className="text-gray-500 font-normal">({perguntas.length}/{MAX_PERGUNTAS})</span>
              </label>
              <ul className="space-y-1.5">
                {perguntas.map((p, i) => (
                  <li key={i} className="flex items-center gap-2 bg-[#111111] border border-gray-800 rounded-lg px-3 py-2 text-sm">
                    <span className="text-gray-500 w-5 shrink-0">{i + 1}.</span>
                    <span className="flex-1">{p}</span>
                    <button
                      type="button"
                      onClick={() => removerPergunta(i)}
                      className="text-gray-500 hover:text-red-400"
                      aria-label={`Remover pergunta ${i + 1}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
              {perguntas.length < MAX_PERGUNTAS && (
                <div className="flex gap-2 mt-2">
                  <input
                    type="text"
                    value={novaPergunta}
                    onChange={(e) => setNovaPergunta(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); adicionarPergunta() } }}
                    placeholder="Adicionar outra pergunta que seus clientes fazem"
                    className="flex-1 bg-[#111111] border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-[#8B5CF6] focus:outline-none text-sm"
                  />
                  <Button type="button" variant="outline" onClick={adicionarPergunta} className="border-gray-700">
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">🎙️ Voz dos áudios</label>
              <div className="flex flex-wrap gap-2">
                {GEMINI_VOICES_TEXTO_LONGO.map((v) => {
                  const ativo = voz === v.voice_id
                  return (
                    <button
                      key={v.voice_id}
                      type="button"
                      onClick={() => {
                        if (voz === v.voice_id) return
                        pararAudioAtivo()
                        setVoz(v.voice_id)
                        setAudioBlobs({})
                        setOggCache({})
                      }}
                      aria-pressed={ativo}
                      className={`text-sm rounded-full border px-3 py-1.5 transition-colors ${
                        ativo
                          ? 'border-[#22C55E] bg-[#22C55E]/15 text-white'
                          : 'border-gray-700 bg-[#111111] text-gray-400 hover:border-gray-500 hover:text-white'
                      }`}
                    >
                      {v.name}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-gray-500 mt-1">Cada resposta pode virar áudio nessa voz — você gera um por um, só os que quiser.</p>
            </div>

            <Button
              onClick={handleGerar}
              disabled={!podeGerar}
              className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED] py-6 text-lg font-bold disabled:opacity-50"
            >
              {gerando ? (
                <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Escrevendo as respostas...</>
              ) : (
                <><Sparkles className="w-5 h-5 mr-2" /> {respostas.length ? 'Gerar de novo' : 'Gerar kit de respostas'}</>
              )}
            </Button>
            {trial.isTrial && (
              <p className="text-xs text-gray-500 text-center">
                Usa 1 das suas {trial.generationsLeft} gerações do teste grátis — os áudios são livres.
              </p>
            )}

            {rateNotice && <p className="text-amber-400 text-sm text-center">{rateNotice}</p>}
            {erro && (
              <p className="text-red-400 text-sm flex items-center gap-1">
                <AlertCircle className="w-4 h-4" /> {erro}
              </p>
            )}
          </div>

          {/* Coluna direita: o kit */}
          <div className="space-y-4">
            {respostas.length ? (
              <>
                <div className="bg-[#111111] border border-gray-800 rounded-xl p-3">
                  <label className="text-sm font-medium text-gray-300 mb-1.5 flex items-center gap-1.5">
                    <Smartphone className="w-4 h-4 text-[#22C55E]" /> Enviar pro seu WhatsApp
                  </label>
                  <input
                    type="tel"
                    value={meuWhats}
                    onChange={(e) => setMeuWhats(e.target.value)}
                    onBlur={salvarMeuWhats}
                    placeholder="55 85 9 9226-2297"
                    className="w-full bg-[#0A0A0A] border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-[#22C55E] focus:outline-none text-sm"
                  />
                  <p className={`text-xs mt-1 ${meuWhats.trim() && whatsappIncompleto(meuWhats) ? 'text-amber-400' : 'text-gray-500'}`}>
                    {meuWhats.trim() && whatsappIncompleto(meuWhats)
                      ? '⚠️ Número incompleto — DDD + número (o 55 a gente põe).'
                      : podeCompartilharArquivo
                        ? 'O texto abre no WhatsApp já digitado — você só toca em enviar. Áudio: o 1º toque prepara, o 2º abre o compartilhar do aparelho → WhatsApp.'
                        : 'O texto abre no WhatsApp já digitado — você só toca em enviar. Pra mandar o áudio pelo computador, baixe e anexe no WhatsApp.'}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-300">🎙️ Voz dos áudios</label>
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {GEMINI_VOICES_TEXTO_LONGO.map((v) => {
                        const ativo = voz === v.voice_id
                        return (
                          <button
                            key={v.voice_id}
                            type="button"
                            onClick={() => {
                              if (voz === v.voice_id) return
                              // Trocar de voz invalida os áudios já gerados — eles nasceram na outra voz.
                              pararAudioAtivo()
                              setVoz(v.voice_id)
                              setAudioBlobs({})
                              setOggCache({})
                            }}
                            aria-pressed={ativo}
                            className={`text-xs rounded-full border px-3 py-1.5 transition-colors ${
                              ativo
                                ? 'border-[#22C55E] bg-[#22C55E]/15 text-white'
                                : 'border-gray-700 bg-[#111111] text-gray-400 hover:border-gray-500 hover:text-white'
                            }`}
                          >
                            {v.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copiar(textoDoKit(), 'tudo')}
                    className="text-xs text-gray-400 hover:text-white flex items-center gap-1 shrink-0"
                  >
                    {copiadoTudo ? <><Check className="w-3.5 h-3.5" /> Kit copiado</> : <><Copy className="w-3.5 h-3.5" /> Copiar kit inteiro</>}
                  </button>
                </div>

                {respostas.map((r, idx) => {
                  const temAudio = !!audioBlobs[idx]
                  const tocando = tocandoIndex === idx
                  const ocupado = gerandoAudio === idx || convertingIndex === idx
                  return (
                    <div key={idx} className="bg-[#111111] border border-gray-800 rounded-xl p-4 space-y-2">
                      <p className="text-sm font-semibold text-[#22C55E]">
                        {idx + 1}. {r.pergunta}
                      </p>
                      <textarea
                        value={r.resposta}
                        onChange={(e) => editarResposta(idx, e.target.value)}
                        rows={3}
                        className="w-full bg-[#0A0A0A] border border-gray-800 rounded-lg px-3 py-2 text-white focus:border-[#8B5CF6] focus:outline-none resize-none text-sm"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => copiar(r.resposta, idx)}
                          className="text-xs text-gray-400 hover:text-white flex items-center gap-1 px-2 py-1"
                        >
                          {copiadoIdx === idx ? <><Check className="w-3.5 h-3.5" /> Copiado</> : <><Copy className="w-3.5 h-3.5" /> Copiar texto</>}
                        </button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleOuvir(idx)}
                          disabled={ocupado || !r.resposta.trim()}
                          className="border-gray-700"
                        >
                          {gerandoAudio === idx ? (
                            <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Gerando voz…</>
                          ) : tocando ? (
                            <><Square className="w-4 h-4 mr-1" /> Parar</>
                          ) : (
                            <><Play className="w-4 h-4 mr-1" /> {temAudio ? 'Ouvir' : 'Gerar áudio e ouvir'}</>
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleBaixar(idx)}
                          disabled={ocupado || !r.resposta.trim()}
                          className="bg-[#22C55E] hover:bg-[#16A34A]"
                        >
                          {convertingIndex === idx ? (
                            <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Preparando…</>
                          ) : (
                            <><Download className="w-4 h-4 mr-1" /> Baixar pro WhatsApp</>
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => enviarTexto(idx)}
                          disabled={!whatsPronto || !r.resposta.trim()}
                          title={whatsPronto ? 'Abre o WhatsApp com este texto já digitado' : 'Informe seu WhatsApp acima'}
                          className="border-[#22C55E]/50 text-[#22C55E] hover:bg-[#22C55E]/10"
                        >
                          <Smartphone className="w-4 h-4 mr-1" /> Enviar texto
                        </Button>
                        {podeCompartilharArquivo && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => compartilharAudio(idx)}
                            disabled={ocupado || !r.resposta.trim()}
                            className="border-[#22C55E]/50 text-[#22C55E] hover:bg-[#22C55E]/10"
                          >
                            {convertingIndex === idx ? (
                              <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Preparando…</>
                            ) : oggCache[idx] ? (
                              <><Share2 className="w-4 h-4 mr-1" /> Compartilhar áudio</>
                            ) : (
                              <><Share2 className="w-4 h-4 mr-1" /> Preparar áudio pra compartilhar</>
                            )}
                          </Button>
                        )}
                      </div>
                      {audioErros[idx] && (
                        <p className="text-amber-400 text-xs flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5" /> {audioErros[idx]}
                        </p>
                      )}
                    </div>
                  )
                })}

                <p className="text-xs text-gray-500">
                  Dica: no WhatsApp Business, vá em Ferramentas comerciais → Respostas rápidas e cole cada
                  texto com um atalho (ex: /preco). O áudio baixado (.ogg) chega lá como mensagem de voz.
                </p>
              </>
            ) : (
              <div className="border border-gray-800 rounded-xl h-full min-h-[320px] flex flex-col items-center justify-center text-center p-8 text-gray-500">
                <MessageCircle className="w-10 h-10 mb-3 text-gray-700" />
                <p className="font-medium text-gray-400">Suas respostas aparecem aqui</p>
                <p className="text-sm mt-1">
                  Preencha o negócio e os fatos da marca, ajuste as perguntas e clique em “Gerar kit de respostas”.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
