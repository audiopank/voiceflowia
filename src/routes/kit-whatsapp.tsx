import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import {
  Lock, Loader2, Sparkles, Download, Copy, Check, X, AlertCircle, MessageCircle, Play, Square, Plus,
  Smartphone, Share2, FolderOpen,
} from 'lucide-react'
import { useSubscription, devolverGeracaoTrial } from '../lib/useSubscription'
import { supabase } from '../lib/supabase'
import { fetchWithRetry, safeJson, friendlyApiError, sleep, parseRetryMs } from '../lib/apiRetry'
import { Button } from '../components/ui/button'
import { BackButton } from '../components/BackButton'
import { TONS, TOM_PADRAO } from '../lib/tons'
import { GEMINI_VOICES_TEXTO_LONGO } from '../lib/voices'
import { convertToWhatsAppOgg } from '../lib/audioConvert'
import { realcarVoz } from '../lib/estudioCards'
import { brandWhatsappKey, loadBrandWhatsapp, saveBrandWhatsapp, whatsappIncompleto, buildWaLink } from '../lib/brandWhatsapp'
import JSZip from 'jszip'
import { salvarKit, atualizarKit, carregarKit } from '../lib/kitsWhatsapp'

export const Route = createFileRoute('/kit-whatsapp')({
  // ?kit=<id> reabre um kit salvo (Meus Kits). Normaliza pra texto: a query pode
  // chegar como outro tipo (lição do ?trial=1 no /cadastro).
  validateSearch: (search: Record<string, unknown>): { kit?: string } => ({
    kit: search.kit == null || search.kit === '' ? undefined : String(search.kit),
  }),
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
// gerado SOB DEMANDA — um por clique ou todos em FILA cadenciada (um por vez, com
// pausa; rajada estouraria a cota; se a IA travar, guarda o que saiu e retoma);
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

// Pausa entre pedidos da fila "Gerar todos os áudios": cadência, não rajada.
const PAUSA_ENTRE_AUDIOS_MS = 1500

// Nome de arquivo sem acento/espaço: "02-qual-o-horario-de-funcionamento.ogg".
function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

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
  // Modelo reserva: quando a IA principal está em fila, o endpoint gera com um
  // "lite" e avisa — a tela conta a verdade e pede conferência das respostas.
  const [modeloReserva, setModeloReserva] = useState('')
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

  // Refs-espelho: a fila "Gerar todos" roda por minutos e não pode ler estado velho
  // (closure) — texto editado ou voz trocada no meio valem na hora.
  const respostasRef = useRef(respostas)
  respostasRef.current = respostas
  const vozRef = useRef(voz)
  vozRef.current = voz
  const audioBlobsRef = useRef(audioBlobs)
  audioBlobsRef.current = audioBlobs
  const oggCacheRef = useRef(oggCache)
  oggCacheRef.current = oggCache
  const ultimoErroAudioRef = useRef('')
  // Fila "Gerar todos os áudios" (fatia 1.4, 25/09): um por vez, com pausa. Se a IA
  // travar, para com honestidade, guarda o que saiu e oferece continuar de onde parou.
  const [lote, setLote] = useState<{ ativo: boolean; aviso: string }>({ ativo: false, aviso: '' })
  const loteCancelRef = useRef(false)
  // "Baixar todos" (ZIP) / "Compartilhar todos" (celular) — empacotando OGGs.
  const [empacotando, setEmpacotando] = useState<'zip' | 'share' | null>(null)
  const [zipProgresso, setZipProgresso] = useState('')
  const [avisoTodos, setAvisoTodos] = useState('')
  // Web Share aceita UM compartilhar por vez: clique duplo no Windows dava
  // InvalidStateError "An earlier share has not yet completed" (console do Mestre, 25/09),
  // e a tela dizia só "não consegui abrir". Agora trava o 2º clique e conta o motivo.
  const shareEmAndamentoRef = useRef(false)
  const [shareAberto, setShareAberto] = useState<number | 'todos' | null>(null)
  const [ehCelular] = useState(() => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent))
  // Meus Kits F1 (25/09): o kit gerado é salvo NA HORA em tabela própria
  // (`kits_whatsapp`, RLS de dono — nunca em `contents`). ?kit=<id> reabre; editar
  // uma resposta salva sozinho; a tela sempre diz se salvou ou não.
  const search = useSearch({ from: '/kit-whatsapp' })
  const [userId, setUserId] = useState<string | null>(null)
  const [kitId, setKitId] = useState<string | null>(null)
  const [nichoSalvo, setNichoSalvo] = useState('')
  const [estadoKit, setEstadoKit] = useState<{ tipo: 'carregando' | 'salvando' | 'salvo' | 'erro'; msg?: string } | null>(null)
  const autosaveRef = useRef<number | null>(null)
  const kitCarregadoRef = useRef<string | null>(null)
  // "A espera": cota por minuto da voz (429) no meio da fila → a fila espera o tempo
  // que a Google pede, com contagem na tela, e retoma a mesma resposta sozinha.
  const ultimaEsperaMsRef = useRef(0)
  const [esperaFim, setEsperaFim] = useState<number | null>(null)
  const [agora, setAgora] = useState(() => Date.now())

  useEffect(() => {
    let cancelado = false
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelado) return
      setUserId(user?.id ?? null)
      const key = brandWhatsappKey(user?.id)
      setWhatsKey(key)
      setMeuWhats(loadBrandWhatsapp(key).numero)
    })
    return () => { cancelado = true }
  }, [])

  // Reabrir kit salvo (?kit=<id>): preenche briefing + respostas. Áudios não são
  // guardados — regeram sob demanda. null = apagado ou de outro usuário (RLS).
  useEffect(() => {
    const id = search.kit
    if (!id || kitCarregadoRef.current === id) return
    kitCarregadoRef.current = id
    let cancelado = false
    setEstadoKit({ tipo: 'carregando' })
    carregarKit(id).then((kit) => {
      if (cancelado) return
      if (!kit) {
        setEstadoKit({ tipo: 'erro', msg: 'Esse kit não foi encontrado — pode ter sido apagado, ou não é seu.' })
        return
      }
      pararAudioAtivo()
      setNicho(kit.nicho)
      setFatos(kit.fatos)
      setDiferenciais(kit.diferenciais)
      setCta(kit.cta)
      if (TONS.some((t) => t.value === kit.tom)) setTom(kit.tom)
      if (GEMINI_VOICES_TEXTO_LONGO.some((v) => v.voice_id === kit.voz)) setVoz(kit.voz)
      if (kit.respostas.length > 0) setPerguntas(kit.respostas.map((r) => r.pergunta))
      setRespostas(kit.respostas)
      setAudioBlobs({})
      setOggCache({})
      setAudioErros({})
      setLote({ ativo: false, aviso: '' })
      setAvisoTodos('')
      setErro('')
      setModeloReserva('')
      setKitId(kit.id)
      setNichoSalvo(kit.nicho.trim())
      setEstadoKit({ tipo: 'salvo' })
    }, (err) => {
      if (cancelado) return
      console.error('=== ERRO ao carregar kit salvo ===', err)
      setEstadoKit({ tipo: 'erro', msg: 'Não consegui abrir esse kit agora. Tente recarregar a página.' })
    })
    return () => {
      cancelado = true
      // StrictMode (dev) roda o efeito 2x: solta a trava pra 2ª rodada carregar de
      // verdade — senão o dev fica em "Abrindo kit salvo…" pra sempre (prod não muda).
      if (kitCarregadoRef.current === id) kitCarregadoRef.current = null
    }
  }, [search.kit])

  // Relógio da contagem regressiva (só roda enquanto há espera).
  useEffect(() => {
    if (esperaFim == null) return
    const t = window.setInterval(() => setAgora(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [esperaFim])

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
        // retries: 1 — o endpoint já tenta 3 modelos por dentro (reserva); insistir 3x
        // aqui em cima só faria o cliente olhar o spinner por quase 4 minutos.
        { retries: 1, onWait: (s) => setRateNotice(`⏳ Muita procura agora — tentando de novo em ${s}s...`) },
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
      setModeloReserva(data.reserva === true ? String(data.modelo || 'reserva') : '')
      // Kit novo = áudios antigos não valem mais (texto mudou).
      setAudioBlobs({})
      setOggCache({})
      setAudioErros({})
      setLote({ ativo: false, aviso: '' })
      setAvisoTodos('')
      void persistirKit(lista)
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
    agendarAutosave()
  }

  // Gera (ou reaproveita) a locução DESTA resposta. Sob demanda de propósito.
  // `emFila`: a fila cuida da espera de cota por conta própria (com contagem e
  // Parar), então aqui o 429 volta na hora em vez de segurar 20s no escuro.
  async function obterAudio(idx: number, opts: { emFila?: boolean } = {}): Promise<Blob | null> {
    // Zera ANTES dos retornos antecipados: a fila lê estes refs depois de um null,
    // e um valor velho (429 anterior) faria a fila esperar por uma resposta vazia.
    ultimoErroAudioRef.current = ''
    ultimaEsperaMsRef.current = 0
    const existente = audioBlobsRef.current[idx]
    if (existente) return existente
    const texto = respostasRef.current[idx]?.resposta?.trim()
    if (!texto) return null

    setGerandoAudio(idx)
    setAudioErros((prev) => ({ ...prev, [idx]: '' }))
    try {
      const response = await fetchWithRetry(
        '/api/gemini/text-to-speech',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: texto, voiceName: vozRef.current }),
        },
        {
          maxTotalWaitMs: opts.emFila ? 0 : 20000,
          onWait: (s) => setAudioErros((prev) => ({ ...prev, [idx]: `⏳ Muita procura — tentando de novo em ${s}s...` })),
        },
      )
      if (!response.ok) {
        if (response.status === 429) {
          // Quanto a Google pede de pausa ("retry in 43s") — a fila usa isso pra esperar.
          try {
            ultimaEsperaMsRef.current = parseRetryMs(await response.clone().text())
          } catch {
            ultimaEsperaMsRef.current = 30000
          }
        }
        const data = await response.json().catch(() => null)
        throw new Error(friendlyApiError(response.status, data?.error))
      }
      const bruto = await response.blob()
      const polido = await realcarVoz(bruto)
      setAudioBlobs((prev) => ({ ...prev, [idx]: polido }))
      setAudioErros((prev) => ({ ...prev, [idx]: '' }))
      return polido
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Não consegui gerar o áudio agora.'
      ultimoErroAudioRef.current = msg
      setAudioErros((prev) => ({ ...prev, [idx]: msg }))
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
      a.download = nomeOgg(idx)
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
      const arquivo = new File([pronto], nomeOgg(idx), { type: pronto.type || 'audio/ogg' })
      dispararShare([arquivo], `Resposta ${idx + 1}`, idx)
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

  function nomeOgg(idx: number): string {
    return `${String(idx + 1).padStart(2, '0')}-${slug(respostasRef.current[idx]?.pergunta || '') || 'resposta'}.ogg`
  }

  // Um share por vez (regra da Web Share API). Chamado SÍNCRONO dentro do clique.
  function dispararShare(arquivos: File[], titulo: string, alvo: number | 'todos') {
    const avisar = (msg: string) => {
      if (alvo === 'todos') setAvisoTodos(msg)
      else setAudioErros((prev) => ({ ...prev, [alvo]: msg }))
    }
    if (shareEmAndamentoRef.current) {
      avisar('O painel de compartilhar já está aberto — escolha o WhatsApp nele. No Windows ele aparece na lateral direita, às vezes atrás desta janela.')
      return
    }
    if (!(navigator as any).canShare?.({ files: arquivos })) {
      avisar(arquivos.length > 1
        ? 'Este navegador não compartilha vários arquivos de uma vez. Use o Baixar todos (ZIP) ou compartilhe um por um.'
        : 'Este navegador não compartilha arquivos de áudio. Use o Baixar e envie pelo WhatsApp.')
      return
    }
    shareEmAndamentoRef.current = true
    setShareAberto(alvo)
    avisar('')
    // Válvula: no Windows, fechar o painel clicando fora às vezes deixa a promise pendurada.
    let valvula = 0
    const soltar = () => {
      window.clearTimeout(valvula)
      shareEmAndamentoRef.current = false
      setShareAberto(null)
    }
    valvula = window.setTimeout(soltar, 90000)
    navigator.share({ files: arquivos, title: titulo }).then(soltar, (err) => {
      soltar()
      const nome = (err as any)?.name as string | undefined
      // Fechar a folha de compartilhar não é erro.
      if (nome === 'AbortError') return
      console.error('=== ERRO ao compartilhar áudio (kit) ===', err)
      if (nome === 'InvalidStateError') {
        avisar('O painel de compartilhar anterior ainda está aberto. Feche-o (Esc) e toque de novo.')
        return
      }
      avisar(`Não consegui abrir o compartilhar (${nome || 'erro'}). Use o Baixar e envie o arquivo pelo WhatsApp.`)
    })
  }

  // OGG desta resposta: converte uma vez e guarda no mesmo cache do Compartilhar.
  async function obterOgg(idx: number): Promise<Blob | null> {
    const emCache = oggCacheRef.current[idx]
    if (emCache) return emCache
    const blob = audioBlobsRef.current[idx]
    if (!blob) return null
    const ogg = await convertToWhatsAppOgg(blob, 'wav')
    oggCacheRef.current = { ...oggCacheRef.current, [idx]: ogg }
    setOggCache((prev) => ({ ...prev, [idx]: ogg }))
    return ogg
  }

  // Espera cancelável (Parar funciona no meio). Devolve true se o cliente parou.
  async function esperarCota(ms: number): Promise<boolean> {
    const fim = Date.now() + ms
    setEsperaFim(fim)
    setAgora(Date.now())
    try {
      while (Date.now() < fim) {
        if (loteCancelRef.current) return true
        await sleep(Math.min(500, Math.max(0, fim - Date.now())))
      }
      return loteCancelRef.current
    } finally {
      setEsperaFim(null)
    }
  }

  // Fila: gera os áudios que faltam, UM POR VEZ com pausa. Se a IA de voz travar
  // (cota/fila do modelo), para na hora, diz onde parou e mantém o que já saiu.
  async function gerarTodosAudios() {
    if (lote.ativo || empacotando) return
    const lista = respostasRef.current
    const pendentes = lista.map((_, i) => i).filter((i) => !audioBlobsRef.current[i] && lista[i].resposta.trim())
    if (pendentes.length === 0) return
    pararAudioAtivo()
    loteCancelRef.current = false
    setLote({ ativo: true, aviso: '' })
    setAvisoTodos('')
    const MAX_ESPERAS = 3
    let esperas = 0
    try {
      let n = 0
      while (n < pendentes.length) {
        const idx = pendentes[n]
        if (loteCancelRef.current) {
          setLote({ ativo: false, aviso: 'Fila parada. O que já saiu está guardado — toque em Continuar quando quiser.' })
          return
        }
        const blob = await obterAudio(idx, { emFila: true })
        if (!blob) {
          // Cota por minuto da voz: espera o que a Google pediu e tenta A MESMA resposta.
          const esperaMs = ultimaEsperaMsRef.current
          if (esperaMs > 0 && esperas < MAX_ESPERAS) {
            esperas++
            const parou = await esperarCota(esperaMs + 1000)
            if (parou) {
              setLote({ ativo: false, aviso: 'Fila parada. O que já saiu está guardado — toque em Continuar quando quiser.' })
              return
            }
            continue
          }
          setLote({
            ativo: false,
            aviso: `Parei na resposta ${idx + 1}: ${ultimoErroAudioRef.current || 'a IA de voz não respondeu'} O que já saiu está guardado — toque em Continuar pra retomar daí.`,
          })
          return
        }
        n++
        if (n < pendentes.length) await sleep(PAUSA_ENTRE_AUDIOS_MS)
      }
      setLote({ ativo: false, aviso: '' })
    } catch (err) {
      console.error('=== ERRO na fila de áudios (kit) ===', err)
      setLote({ ativo: false, aviso: 'A fila parou por um erro inesperado. O que já saiu está guardado — toque em Continuar.' })
    }
  }

  function indicesComAudio(): number[] {
    return respostasRef.current.map((_, i) => i).filter((i) => !!audioBlobsRef.current[i])
  }

  // ZIP com os OGGs prontos + o texto do kit (padrão do Super Agente).
  async function baixarTodos() {
    if (empacotando || lote.ativo) return
    const indices = indicesComAudio()
    if (indices.length === 0) return
    pararAudioAtivo()
    setEmpacotando('zip')
    setAvisoTodos('')
    try {
      const zip = new JSZip()
      zip.file('respostas.txt', textoDoKit())
      for (let n = 0; n < indices.length; n++) {
        setZipProgresso(`Empacotando ${n + 1} de ${indices.length}…`)
        const ogg = await obterOgg(indices[n])
        if (ogg) zip.file(nomeOgg(indices[n]), ogg)
      }
      const content = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(content)
      const a = document.createElement('a')
      a.href = url
      a.download = `kit-whatsapp-${slug(nicho) || 'respostas'}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('=== ERRO ao empacotar o kit (zip) ===', err)
      setAvisoTodos('Não consegui montar o ZIP agora. Tente de novo ou baixe um por um.')
    } finally {
      setEmpacotando(null)
      setZipProgresso('')
    }
  }

  // Celular: 1º toque prepara todos os OGGs; 2º toque compartilha TODOS de uma vez
  // (síncrono, a partir do cache) — a folha do aparelho → WhatsApp → conversa "Você".
  async function compartilharTodos() {
    if (empacotando || lote.ativo) return
    const indices = indicesComAudio()
    if (indices.length === 0) return
    if (indices.every((i) => !!oggCacheRef.current[i])) {
      const arquivos = indices.map((i) => {
        const b = oggCacheRef.current[i]
        return new File([b], nomeOgg(i), { type: b.type || 'audio/ogg' })
      })
      dispararShare(arquivos, 'Kit de respostas', 'todos')
      return
    }
    pararAudioAtivo()
    setEmpacotando('share')
    setAvisoTodos('')
    try {
      for (let n = 0; n < indices.length; n++) {
        setZipProgresso(`Preparando ${n + 1} de ${indices.length}…`)
        await obterOgg(indices[n])
      }
    } catch (err) {
      console.error('=== ERRO ao preparar áudios pra compartilhar (kit) ===', err)
      setAvisoTodos('Não consegui preparar os áudios. Tente de novo.')
    } finally {
      setEmpacotando(null)
      setZipProgresso('')
    }
  }

  // Salva o kit assim que a IA responde. Mesmo negócio já salvo = atualiza o mesmo
  // kit ("Gerar de novo"); negócio diferente = kit novo. Falha NÃO some: a tela diz.
  async function persistirKit(lista: Resposta[]) {
    setEstadoKit({ tipo: 'salvando' })
    try {
      let uid = userId
      if (!uid) {
        const { data: { user } } = await supabase.auth.getUser()
        uid = user?.id ?? null
        setUserId(uid)
      }
      if (!uid) throw new Error('sessão não encontrada')
      const briefing = { nicho: nicho.trim(), fatos, diferenciais, cta, tom, voz, respostas: lista }
      if (kitId && nichoSalvo === nicho.trim()) {
        await atualizarKit(kitId, briefing)
      } else {
        const id = await salvarKit(uid, briefing)
        setKitId(id)
      }
      setNichoSalvo(nicho.trim())
      setEstadoKit({ tipo: 'salvo' })
    } catch (err) {
      console.error('=== ERRO ao salvar o kit (Meus Kits) ===', err)
      const motivo = err instanceof Error ? err.message : 'erro desconhecido'
      setEstadoKit({ tipo: 'erro', msg: `Kit gerado, mas NÃO foi salvo em Meus Kits (${motivo}). Copie ou baixe agora pra não perder.` })
    }
  }

  // Resposta editada: salva sozinha 1,2s depois da última tecla (lê respostasRef,
  // o texto mais novo — nunca closure velha). Só quando o kit já está em Meus Kits.
  function agendarAutosave() {
    if (!kitId) return
    const id = kitId
    if (autosaveRef.current) window.clearTimeout(autosaveRef.current)
    setEstadoKit({ tipo: 'salvando' })
    autosaveRef.current = window.setTimeout(() => {
      autosaveRef.current = null
      atualizarKit(id, { respostas: respostasRef.current }).then(
        () => setEstadoKit({ tipo: 'salvo' }),
        (err) => {
          console.error('=== ERRO no autosave do kit ===', err)
          setEstadoKit({ tipo: 'erro', msg: 'Sua edição NÃO foi salva em Meus Kits (sem conexão?). Copie o texto pra não perder.' })
        },
      )
    }, 1200)
  }

  function salvarVozNoKit(novaVoz: string) {
    if (!kitId) return
    atualizarKit(kitId, { voz: novaVoz }).catch((err) => console.error('=== ERRO ao salvar a voz do kit ===', err))
  }

  // Começar outro negócio do zero (o kit atual continua salvo em Meus Kits).
  function novoKit() {
    pararAudioAtivo()
    if (autosaveRef.current) window.clearTimeout(autosaveRef.current)
    kitCarregadoRef.current = null
    setKitId(null)
    setNichoSalvo('')
    setEstadoKit(null)
    setNicho('')
    setFatos('')
    setDiferenciais('')
    setCta('')
    setTom(TOM_PADRAO)
    setPerguntas(PERGUNTAS_PADRAO)
    setRespostas([])
    setAudioBlobs({})
    setOggCache({})
    setAudioErros({})
    setLote({ ativo: false, aviso: '' })
    setAvisoTodos('')
    setErro('')
    setModeloReserva('')
    navigate({ to: '/kit-whatsapp', search: {} })
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

  const podeGerar = nicho.trim().length > 0 && perguntas.length > 0 && !gerando && !lote.ativo && !empacotando
  const prontos = respostas.reduce((n, _, i) => n + (audioBlobs[i] ? 1 : 0), 0)
  const faltam = respostas.filter((r, i) => r.resposta.trim() && !audioBlobs[i]).length
  const todosOggProntos = prontos > 0 && respostas.every((_, i) => !audioBlobs[i] || !!oggCache[i])
  const segundosEspera = esperaFim == null ? 0 : Math.max(0, Math.ceil((esperaFim - agora) / 1000))

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
          {/* A dúvida real de um cliente (25/09): "como as perguntas chegam na plataforma?".
              Não chegam — e a tela precisa dizer isso com todas as letras. */}
          <div className="mt-4 bg-[#111111] border border-gray-800 rounded-xl p-4 text-sm">
            <p className="font-medium text-white">Como funciona (não é robô)</p>
            <p className="text-gray-400 mt-1">
              Seus clientes continuam falando com você, no seu WhatsApp de sempre. Aqui você deixa as
              respostas prontas antes — a plataforma não lê nem responde conversas.
            </p>
            <ol className="mt-2 space-y-1 text-gray-300 list-decimal list-inside">
              <li>Preencha os fatos da marca e gere o kit: as respostas em texto.</li>
              <li>Gere os áudios (um por um ou todos de uma vez) e mande pro seu WhatsApp — a conversa “Você” guarda tudo.</li>
              <li>Cliente perguntou? Texto pelas respostas rápidas do WhatsApp Business; áudio encaminhando da conversa “Você”. Dois toques.</li>
            </ol>
          </div>
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
                      disabled={lote.ativo || !!empacotando}
                      onClick={() => {
                        if (voz === v.voice_id) return
                        pararAudioAtivo()
                        setVoz(v.voice_id)
                        setAudioBlobs({})
                        setOggCache({})
                        setLote({ ativo: false, aviso: '' })
                        setAvisoTodos('')
                        salvarVozNoKit(v.voice_id)
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
              <p className="text-xs text-gray-500 mt-1">Cada resposta pode virar áudio nessa voz — um por um ou todos de uma vez, depois de gerar o kit.</p>
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
            {/* Meus Kits: onde o kit está guardado + estado do salvamento (sempre visível). */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => navigate({ to: '/meus-kits' })}
                  className="text-gray-400 hover:text-white flex items-center gap-1"
                >
                  <FolderOpen className="w-3.5 h-3.5" /> Meus kits salvos
                </button>
                {kitId && (
                  <button type="button" onClick={novoKit} className="text-gray-400 hover:text-white flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> Novo kit
                  </button>
                )}
              </div>
              {estadoKit && (
                <span className={`flex items-center gap-1 ${estadoKit.tipo === 'erro' ? 'text-amber-400' : estadoKit.tipo === 'salvo' ? 'text-[#22C55E]' : 'text-gray-400'}`}>
                  {estadoKit.tipo === 'carregando' && <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Abrindo kit salvo…</>}
                  {estadoKit.tipo === 'salvando' && <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Salvando em Meus Kits…</>}
                  {estadoKit.tipo === 'salvo' && <><Check className="w-3.5 h-3.5" /> Salvo em Meus Kits</>}
                  {estadoKit.tipo === 'erro' && <><AlertCircle className="w-3.5 h-3.5 shrink-0" /> {estadoKit.msg}</>}
                </span>
              )}
            </div>
            {respostas.length ? (
              <>
                {modeloReserva && (
                  <p className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-lg px-3 py-2 flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      Gerado com o <strong>modelo reserva</strong> ({modeloReserva}) porque a IA principal está em fila.
                      Os fatos continuam sendo a única fonte, mas o reserva é menos afiado: confira as respostas antes de usar.
                    </span>
                  </p>
                )}
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
                      : podeCompartilharArquivo && ehCelular
                        ? 'O texto abre no WhatsApp já digitado — você só toca em enviar. Áudio: o 1º toque prepara, o 2º abre o compartilhar do aparelho → WhatsApp (mande pra você mesmo: a conversa “Você”).'
                        : podeCompartilharArquivo
                          ? 'O texto abre no WhatsApp já digitado — você só toca em enviar. Áudio: o 1º toque prepara, o 2º abre o painel de compartilhar do Windows (lateral direita). No computador, Baixar + anexar no WhatsApp sempre funciona.'
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
                            disabled={lote.ativo || !!empacotando}
                            onClick={() => {
                              if (voz === v.voice_id) return
                              // Trocar de voz invalida os áudios já gerados — eles nasceram na outra voz.
                              pararAudioAtivo()
                              setVoz(v.voice_id)
                              setAudioBlobs({})
                              setOggCache({})
                              setLote({ ativo: false, aviso: '' })
                              setAvisoTodos('')
                              salvarVozNoKit(v.voice_id)
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

                {/* Fatia 1.4: todos os áudios de uma vez — em FILA (um por vez, com pausa; a IA
                    de voz não aceita rajada). Se travar, guarda o que saiu e retoma de onde parou. */}
                <div className="bg-[#111111] border border-gray-800 rounded-xl p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={gerarTodosAudios}
                      disabled={lote.ativo || !!empacotando || gerandoAudio !== null || convertingIndex !== null || faltam === 0}
                      className="bg-[#22C55E] hover:bg-[#16A34A] disabled:opacity-60"
                    >
                      {lote.ativo && esperaFim != null ? (
                        <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Esperando a cota… {segundosEspera}s</>
                      ) : lote.ativo ? (
                        <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Gerando {Math.min(prontos + 1, respostas.length)} de {respostas.length}…</>
                      ) : faltam === 0 ? (
                        <><Check className="w-4 h-4 mr-1" /> Todos os áudios prontos</>
                      ) : prontos > 0 ? (
                        <><Play className="w-4 h-4 mr-1" /> Continuar: faltam {faltam}</>
                      ) : (
                        <><Play className="w-4 h-4 mr-1" /> Gerar todos os áudios</>
                      )}
                    </Button>
                    {lote.ativo && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => { loteCancelRef.current = true }}
                        className="border-gray-700"
                      >
                        <Square className="w-4 h-4 mr-1" /> Parar
                      </Button>
                    )}
                    {prontos > 0 && !lote.ativo && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={baixarTodos}
                        disabled={!!empacotando}
                        className="border-[#22C55E]/50 text-[#22C55E] hover:bg-[#22C55E]/10"
                      >
                        {empacotando === 'zip' ? (
                          <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> {zipProgresso || 'Empacotando…'}</>
                        ) : (
                          <><Download className="w-4 h-4 mr-1" /> Baixar todos ({prontos} .ogg em ZIP)</>
                        )}
                      </Button>
                    )}
                    {prontos > 0 && !lote.ativo && podeCompartilharArquivo && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={compartilharTodos}
                        disabled={!!empacotando || shareAberto !== null}
                        className="border-[#22C55E]/50 text-[#22C55E] hover:bg-[#22C55E]/10"
                      >
                        {empacotando === 'share' ? (
                          <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> {zipProgresso || 'Preparando…'}</>
                        ) : shareAberto === 'todos' ? (
                          <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Escolha o WhatsApp no painel…</>
                        ) : todosOggProntos ? (
                          <><Share2 className="w-4 h-4 mr-1" /> Compartilhar todos ({prontos})</>
                        ) : (
                          <><Share2 className="w-4 h-4 mr-1" /> Preparar todos pra compartilhar</>
                        )}
                      </Button>
                    )}
                  </div>
                  {(prontos > 0 || lote.ativo) && (
                    <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={respostas.length} aria-valuenow={prontos}>
                      <div className="h-full bg-[#22C55E] transition-all" style={{ width: `${respostas.length ? Math.round((prontos / respostas.length) * 100) : 0}%` }} />
                    </div>
                  )}
                  <p className={`text-xs ${lote.aviso || avisoTodos || esperaFim != null ? 'text-amber-400' : 'text-gray-500'}`}>
                    {lote.aviso || avisoTodos || (lote.ativo && esperaFim != null
                      ? `Cota da voz atingida — a Google pede uma pausa. Continuo sozinho em ${segundosEspera} s (${prontos} de ${respostas.length} prontos). Pode parar se quiser.`
                      : lote.ativo
                      ? 'Um por vez, com pausa — a IA de voz não aceita rajada. Pode levar uns 2 a 3 minutos; pode continuar navegando nesta tela.'
                      : `${prontos} de ${respostas.length} áudios prontos. Gera um por vez, com pausa; se a IA travar no meio, o que já saiu fica guardado e você continua de onde parou.`)}
                  </p>
                </div>

                {respostas.map((r, idx) => {
                  const temAudio = !!audioBlobs[idx]
                  const tocando = tocandoIndex === idx
                  const ocupado = gerandoAudio === idx || convertingIndex === idx || lote.ativo || !!empacotando
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
                            disabled={ocupado || !r.resposta.trim() || shareAberto !== null}
                            className="border-[#22C55E]/50 text-[#22C55E] hover:bg-[#22C55E]/10"
                          >
                            {convertingIndex === idx ? (
                              <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Preparando…</>
                            ) : shareAberto === idx ? (
                              <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Escolha o WhatsApp no painel…</>
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
                  Dica: no WhatsApp Business, Ferramentas comerciais → Respostas rápidas aceitam texto, foto e
                  vídeo (áudio não) — cole cada texto com um atalho (ex: /preco). Os áudios (.ogg) ficam
                  guardados na sua conversa “Você”: quando o cliente perguntar, é só encaminhar. Chega como
                  mensagem de voz.
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
