import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import JSZip from 'jszip'
import { toPng } from 'html-to-image'
import {
  Lock, Loader2, AlertCircle, Rocket, Volume2, Download, Play, Package,
  Users, Target, Hash, Clock, Megaphone, CheckCircle2, Copy, Check, ImagePlus, X, Pencil,
  ChevronDown, ChevronUp, CalendarDays, Share2, Sparkles, Brain
} from 'lucide-react'
import { useSubscription, devolverGeracaoTrial } from '../lib/useSubscription'
import { supabase } from '../lib/supabase'
import { fetchWithRetry, sleep, safeJson, friendlyApiError } from '../lib/apiRetry'
import { Button } from '../components/ui/button'
import { BackButton } from '../components/BackButton'
import { AtivarTrial } from '../components/AtivarTrial'
import { SuperAgenteGuia } from '../components/SuperAgenteGuia'
import { buildIcsCalendar, downloadIcsFile, postDateTime } from '../lib/ics'
import { convertToWhatsAppOgg } from '../lib/audioConvert'
import { RedesSociais } from '../components/RedesSociais'
import { SOCIAL_NETWORKS, socialKey, loadSocialLinks, saveSocialLinks, type SocialLinks } from '../lib/socialLinks'
import { TONS, TOM_PADRAO, TONS_VALIDOS } from '../lib/tons'
import { proximasDatasSazonais, textoContagem } from '../lib/datasSazonais'

// Espaça as gerações de voz para não estourar o limite/minuto do free tier.
const VOICE_THROTTLE_MS = 3500

// Data de hoje em yyyy-mm-dd, pro input type="date" (padrão: "Dia 1" = hoje).
function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const Route = createFileRoute('/super-agente')({
  component: SuperAgente,
})

interface Persona {
  nome: string
  descricao: string
}

interface Estrategia {
  resumo: string
  personas: Persona[]
  pilares: string[]
  hashtags: string[]
  melhoresHorarios: string[]
  ctas: string[]
}

interface Post {
  dia: number
  periodo: 'Manhã' | 'Tarde'
  horario: string
  hook: string
  roteiro: string
  legenda: string
  vozSugerida: string
}

function buildEstrategiaMarkdown(nicho: string, tom: string, est: Estrategia): string {
  return `# Estratégia de Conteúdo — ${nicho}

Tom de voz: ${tom}

## Resumo
${est.resumo}

## Personas
${est.personas.map((p) => `- **${p.nome}**: ${p.descricao}`).join('\n')}

## Pilares de Conteúdo
${est.pilares.map((p) => `- ${p}`).join('\n')}

## Hashtags
${est.hashtags.join(' ')}

## Melhores Horários
${est.melhoresHorarios.map((h) => `- ${h}`).join('\n')}

## Ideias de CTA
${est.ctas.map((c) => `- ${c}`).join('\n')}
`
}

// Nome de arquivo estável pra um post: "dia-01-manha-09h15". Sem o período, Manhã e Tarde
// do mesmo dia (mesmo "dia", pedido de cliente: 2 posts/dia) sobrescreveriam o arquivo uma
// da outra; o horário só deixa o nome mais informativo pro cliente.
function diaTag(dia: number, periodo: string, horario?: string): string {
  const p = periodo === 'Manhã' ? 'manha' : 'tarde'
  const h = horario ? `-${horario.replace(':', 'h')}` : ''
  return `dia-${String(dia).padStart(2, '0')}-${p}${h}`
}

function buildPostText(post: Post): string {
  return `DIA ${post.dia} · ${post.periodo} · ${post.horario} — Voz sugerida: ${post.vozSugerida}

HOOK (3s):
${post.hook}

ROTEIRO (20s):
${post.roteiro}

LEGENDA:
${post.legenda}
`
}

// Auto-ajuste simples de fonte pros slides do carrossel (1080x1350 cada, um bloco por slide):
// texto longo = fonte menor, pra caber sem cortar no canvas fixo.
function hookFontSize(hook: string): number {
  if (hook.length > 140) return 30
  if (hook.length > 90) return 38
  if (hook.length > 50) return 46
  return 54
}

// Roteiro e legenda usam a mesma régua — cada um sozinho no próprio slide, tem bem mais espaço
// do que quando dividiam card com o resto.
function bodyFontSize(text: string): number {
  if (text.length > 500) return 20
  if (text.length > 350) return 24
  if (text.length > 220) return 28
  return 32
}

type SlideKey = 'hook' | 'roteiro' | 'legenda' | 'imagem'

// Tamanho fixo dos slides do carrossel: 1080x1350 (4:5), o retrato mais alto que o Instagram
// aceita sem cortar/recomprimir no feed.
const EXPORT_W = 540
const EXPORT_H = 675

// Um slide do carrossel: só o CONTEÚDO + a logo da marca no canto. NADA de chrome de
// produção (Dia, rótulo do bloco HOOK/ROTEIRO/LEGENDA/IMAGEM, contador 1/4, rodapé de
// horário) — isso serve pra organização interna e vazava no PNG que o cliente publica.
// Fica oculto (height:0/overflow:hidden na wrapper) até ser exportado.
function ExportSlide({
  innerRef, brandLogo, children,
}: {
  innerRef: (el: HTMLDivElement | null) => void
  brandLogo: string | null
  children: React.ReactNode
}) {
  return (
    <div style={{ height: 0, overflow: 'hidden' }}>
      <div
        ref={innerRef}
        style={{
          width: EXPORT_W,
          height: EXPORT_H,
          background: '#111111',
          color: '#FFFFFF',
          boxSizing: 'border-box',
          padding: 36,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {brandLogo && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start' }}>
            <img
              src={brandLogo}
              alt=""
              style={{ width: 40, height: 40, objectFit: 'contain', background: '#FFFFFF', borderRadius: 8, padding: 4 }}
            />
          </div>
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', marginTop: 8 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

// Teto de hooks enviados como memória. Um mês cheio já são 60 posts, e mandar
// tudo incharia o prompt de uma chamada que já vive perto do limite de 45s.
// Os 40 mais recentes cobrem o que o cliente lembra de ter visto.
const MAX_HOOKS_MEMORIA = 40

// Lê os hooks já gerados pra este nicho nas últimas gerações do próprio usuário
// (RLS garante que só enxerga o que é dele). A memória é BÔNUS: se a consulta
// falhar, devolve lista vazia e a geração acontece normalmente — nunca vale a
// pena derrubar a entrega principal por causa do extra.
// O nicho é texto livre digitado pelo usuário. Comparar cru no banco faria
// "Estética", "estetica" e "Estética " serem três nichos diferentes, e a memória
// voltaria VAZIA sem ninguém perceber — a feature não tem sinal na UI, então o
// sintoma seria só os ângulos repetindo de novo. Normaliza caixa, acento e
// espaço em ambos os lados, na comparação, sem mudar o que é gravado.
function chaveNicho(v: string): string {
  return v
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

async function buscarHooksAnteriores(nicho: string): Promise<string[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    // Traz as últimas gerações do usuário e filtra no cliente: o PostgREST não
    // compara ignorando acento, e é justamente o acento que quebra em português.
    const { data, error } = await supabase
      .from('contents')
      .select('nicho, posts_json')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(12)

    if (error || !Array.isArray(data)) return []

    const alvo = chaveNicho(nicho)
    const hooks: string[] = []
    let geracoesUsadas = 0

    for (const linha of data) {
      if (typeof linha?.nicho !== 'string' || chaveNicho(linha.nicho) !== alvo) continue
      if (geracoesUsadas >= 3) break
      geracoesUsadas++

      const posts = Array.isArray(linha?.posts_json) ? linha.posts_json : []
      for (const p of posts) {
        const h = typeof p?.hook === 'string' ? p.hook.trim() : ''
        if (h) hooks.push(h.slice(0, 120))
        if (hooks.length >= MAX_HOOKS_MEMORIA) return hooks
      }
    }
    return hooks
  } catch {
    return []
  }
}

// Data curta (DD/MM) pra exibir "último kit em ..." no painel de Memória da Marca.
function formatarDataMemoria(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

// Estatísticas REAIS da Memória da Marca pra ESTE nicho, pra exibir na UI (não vai pro
// prompt — quem alimenta a IA é o buscarHooksAnteriores acima). Conta quantos kits o
// usuário já gerou pra a marca e quantos ganchos foram memorizados. Nunca inventa: se a
// consulta FALHAR, devolve null e o painel some — importante NÃO devolver zeros aqui,
// senão um cliente que TEM histórico veria "Primeira vez com..." (afirmação falsa) num
// hiccup de rede. kits===0 só vale quando a consulta deu certo e não há histórico mesmo.
async function carregarMemoriaMarca(nicho: string): Promise<{ kits: number; hooks: number; ultima: string | null } | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data, error } = await supabase
      .from('contents')
      .select('nicho, posts_json, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error || !Array.isArray(data)) return null

    const alvo = chaveNicho(nicho)
    let kits = 0
    let hooks = 0
    let ultima: string | null = null

    for (const linha of data) {
      if (typeof linha?.nicho !== 'string' || chaveNicho(linha.nicho) !== alvo) continue
      kits++
      if (!ultima && typeof linha?.created_at === 'string') ultima = linha.created_at
      const posts = Array.isArray(linha?.posts_json) ? linha.posts_json : []
      for (const p of posts) {
        if (typeof p?.hook === 'string' && p.hook.trim()) hooks++
      }
    }
    return { kits, hooks, ultima }
  } catch {
    return null
  }
}

function SuperAgente() {
  const { hasAccess, loading: loadingSubscription, trial, refresh, canStartTrial, startTrial } = useSubscription()
  const [nicho, setNicho] = useState('')
  const [tom, setTom] = useState(TOM_PADRAO)
  // Fluxo de 2 posts/dia (Manhã + Tarde): este campo é quantidade de DIAS, não de posts —
  // o total de cards gerados é o dobro.
  const [qtdDias, setQtdDias] = useState(4)
  // Data em que "Dia 1" cai de verdade — pro export do Google Agenda. Padrão: hoje.
  const [dataInicio, setDataInicio] = useState(todayIso)

  // Memória da Marca (Fase 1) VISÍVEL: dado real de quantos kits a IA já gerou pra este
  // nicho e quantos ganchos memorizou. É o custo de troca de quem pensa em cancelar —
  // cancelou, some o histórico. null = ainda não carregado / nicho curto (painel oculto).
  const [memoria, setMemoria] = useState<{ kits: number; hooks: number; ultima: string | null } | null>(null)

  // Ganchos sazonais: data/campanha opcional que a IA destaca em parte do mês.
  // As datas chegando saem do calendário real (não recalcula a cada tecla).
  const [campanha, setCampanha] = useState('')
  const datasProximas = useMemo(() => proximasDatasSazonais(45), [])

  // V1.5 Estudo de Marca — opcionais. Vazios = gera igual hoje.
  const [instagram, setInstagram] = useState('')
  const [servicos, setServicos] = useState('')
  const [tomMarca, setTomMarca] = useState('')
  const [cta, setCta] = useState('')
  const [diferenciais, setDiferenciais] = useState('')

  // V1.6 Seletor de voz. '' = Automático (IA decide entre Zephyr/Puck).
  const [voz, setVoz] = useState('')

  // "Preencher com IA": material bruto colado pelo cliente (site, bio, conversa) que
  // vira briefing. Encurta o caminho até a primeira geração — a tela em branco de 10
  // campos é onde o trial costuma morrer, não a qualidade do roteiro.
  const [briefingBruto, setBriefingBruto] = useState('')
  const [extraindo, setExtraindo] = useState(false)
  const [extrairErro, setExtrairErro] = useState('')
  // Resultado da última extração: o que foi preenchido e o que o texto não sustentava.
  // O cliente precisa saber QUAIS campos vieram da IA pra conferir só esses.
  const [extracao, setExtracao] = useState<{ preenchidos: string[]; vazios: string[] } | null>(null)

  // Copiar texto (pedido de cliente): guarda a chave do campo copiado p/ feedback.
  const [copied, setCopied] = useState('')

  // Redes sociais do cliente (localStorage por usuário, ver src/lib/socialLinks.ts).
  // Fonte única da verdade: o painel edita via onSave; os cards leem pra "postar".
  const [socialLinks, setSocialLinks] = useState<SocialLinks>({})
  const [socialStoreKey, setSocialStoreKey] = useState('')
  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      const key = socialKey(user?.id)
      setSocialStoreKey(key)
      setSocialLinks(loadSocialLinks(key))
    })()
  }, [])

  // Imagem/logo do cliente por card (client-side, sem API). Entra no ZIP do kit.
  const [postImages, setPostImages] = useState<Record<number, { url: string; blob: Blob; ext: string }>>({})

  // Logo da marca: enviada 1x, aplicada em TODOS os cards. base64 p/ embutir no PNG.
  const [brandLogo, setBrandLogo] = useState<string | null>(null)
  const [logoError, setLogoError] = useState('')
  const [exportingIndex, setExportingIndex] = useState<number | null>(null)
  // Cada dia vira um carrossel de até 4 slides (Hook, Roteiro, Legenda, Imagem — pedido de
  // cliente: um card por bloco, não um card só tentando encaixar tudo). Chave do ref:
  // "<index>:<slide>" — pela posição na lista, não pelo número "dia" que a IA devolve (ela
  // não garante unicidade/sequência, sobretudo em respostas maiores; duas posições com o
  // mesmo "dia" já causaram cards compartilhando áudio/imagem entre si).
  const exportRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const slideRefKey = (index: number, slide: SlideKey) => `${index}:${slide}`

  // Estratégia vem recolhida (pedido de cliente): mostra só o resumo, detalhes sob demanda.
  const [estrategiaAberta, setEstrategiaAberta] = useState(false)

  const [estrategia, setEstrategia] = useState<Estrategia | null>(null)
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState('')

  const [audioBlobs, setAudioBlobs] = useState<Record<number, Blob>>({})
  const [audioErrors, setAudioErrors] = useState<Record<number, string>>({})
  const [generatingAll, setGeneratingAll] = useState(false)
  const [audioProgress, setAudioProgress] = useState({ done: 0, total: 0 })
  const [isZipping, setIsZipping] = useState(false)
  // Aviso amigável quando bate o limite da API e o app espera/re-tenta sozinho.
  const [rateNotice, setRateNotice] = useState('')

  // Lê o material colado e preenche o formulário. NÃO consome geração do trial:
  // preencher briefing não é gerar conteúdo, e cobrar por isso mataria o trial antes
  // do cliente ver o produto.
  async function handleExtrairBriefing() {
    if (!briefingBruto.trim() || extraindo) return

    setExtraindo(true)
    setExtrairErro('')
    setExtracao(null)

    try {
      const response = await fetchWithRetry(
        '/api/gemini/extrair-briefing',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texto: briefingBruto })
        },
        { onWait: (s) => setRateNotice(`⏳ Muita procura agora — tentando de novo em ${s}s...`) },
      )
      setRateNotice('')

      if (!response.ok) {
        const errData = await response.json().catch(() => null)
        throw new Error(friendlyApiError(response.status, errData?.error))
      }

      const data = await safeJson(response)
      const b = data.briefing || {}

      // Campo que a IA não encontrou no material fica VAZIO e é anunciado como tal.
      // Nunca sobrescrevemos com um valor plausível: briefing chutado vira um mês de
      // roteiro errado que o cliente só descobre depois de gerar tudo.
      // Tom só entra se for uma das opções do select — valor fora da lista renderiza
      // o select em branco e o cliente não entende o que aconteceu.
      const tomExtraido = TONS_VALIDOS.includes(b.tom) ? b.tom : ''

      const campos: Array<{ nome: string; valor: unknown; aplicar: (v: string) => void }> = [
        { nome: 'Nicho', valor: b.nicho, aplicar: setNicho },
        { nome: 'Tom de Voz', valor: tomExtraido, aplicar: setTom },
        { nome: '@ Instagram', valor: b.instagram, aplicar: setInstagram },
        { nome: 'Serviços', valor: b.servicos, aplicar: setServicos },
        { nome: 'Tom da Marca', valor: b.tomMarca, aplicar: setTomMarca },
        { nome: 'CTA', valor: b.cta, aplicar: setCta },
        { nome: 'Diferenciais', valor: b.diferenciais, aplicar: setDiferenciais },
      ]

      const preenchidos: string[] = []
      const vazios: string[] = []
      for (const campo of campos) {
        const texto = typeof campo.valor === 'string' ? campo.valor.trim() : ''
        if (texto) {
          campo.aplicar(texto)
          preenchidos.push(campo.nome)
        } else {
          vazios.push(campo.nome)
        }
      }

      setExtracao({ preenchidos, vazios })
    } catch (err) {
      setRateNotice('')
      setExtrairErro(err instanceof Error ? err.message : 'Não consegui ler esse material.')
    } finally {
      setExtraindo(false)
    }
  }

  // Carrega a Memória da Marca com debounce enquanto a pessoa digita o nicho. Nicho
  // curto (< 2 chars) esconde o painel; a última resposta vence (flag cancelado).
  useEffect(() => {
    const alvo = nicho.trim()
    if (alvo.length < 2) {
      setMemoria(null)
      return
    }
    let cancelado = false
    const t = setTimeout(() => {
      carregarMemoriaMarca(alvo).then((m) => { if (!cancelado) setMemoria(m) })
    }, 500)
    return () => { cancelado = true; clearTimeout(t) }
  }, [nicho])

  async function handleGenerate() {
    if (!nicho.trim()) return

    // Trial: consome 1 geração (o servidor valida os 7 dias + limite de 10).
    if (trial.isTrial) {
      const { error: trialErr } = await supabase.rpc('use_trial_generation')
      if (trialErr) {
        await refresh()
        setError('Seu trial acabou. Assine para continuar gerando.')
        return
      }
    }

    setIsGenerating(true)
    setError('')
    setEstrategia(null)
    setEstrategiaAberta(false)
    setPosts(null)
    setAudioBlobs({})
    setAudioErrors({})
    setAudioProgress({ done: 0, total: 0 })

    try {
      // MEMÓRIA DA MARCA: o que já foi gerado antes pra este mesmo nicho não pode
      // voltar reescrito. Sem isto, o mês 2 sai parecido com o mês 1 e o cliente
      // sente que a ferramenta não aprendeu nada sobre ele.
      const hooksAnteriores = await buscarHooksAnteriores(nicho)

      const response = await fetchWithRetry(
        '/api/gemini/generate-strategy',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nicho, tom, qtdPosts: qtdDias, instagram, servicos, tomMarca, cta, diferenciais, voz, hooksAnteriores, campanha }) // V1.6: voz forçada ('' = automático)
        },
        { onWait: (s) => setRateNotice(`⏳ Muita procura agora — tentando de novo em ${s}s...`) },
      )
      setRateNotice('')

      // Ver agente.tsx: checa o erro antes de parsear, senão um 504 em HTML (não-JSON) faz
      // o safeJson estourar com a mensagem crua em vez da amigável.
      if (!response.ok) {
        const errData = await response.json().catch(() => null)
        throw new Error(friendlyApiError(response.status, errData?.error))
      }

      const data = await safeJson(response)
      setEstrategia(data.estrategia)
      setPosts(data.posts)

      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { error: insertError } = await supabase
          .from('contents')
          .insert({ user_id: user.id, nicho, posts_json: data.posts })
        if (insertError) {
          console.error('Erro ao salvar conteúdo no Supabase:', insertError)
        }
      }

      // Acabou de nascer mais um kit pra esta marca: atualiza o painel de memória
      // pra a contagem subir na hora (o custo de troca cresce na frente do cliente).
      void carregarMemoriaMarca(nicho).then(setMemoria)

      // Atualiza a contagem do trial no banner do topo.
      if (trial.isTrial) void refresh()
    } catch (err) {
      console.error('=== ERRO ao gerar estratégia ===', err)
      // Não entregamos nada: a geração debitada lá em cima volta pra cota. Num
      // trial de 10, deixar erro de cota da Gemini comer o teste do cliente é
      // perder a venda por um problema que não é dele.
      if (trial.isTrial) {
        await devolverGeracaoTrial()
        void refresh()
      }
      setError(err instanceof Error ? err.message : 'Erro ao gerar estratégia')
    } finally {
      setIsGenerating(false)
    }
  }

  async function generateAudioFor(post: Post): Promise<Blob> {
    const response = await fetchWithRetry(
      '/api/gemini/text-to-speech',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `${post.hook} ${post.roteiro}`, voiceName: post.vozSugerida })
      },
      { onWait: (s) => setRateNotice(`⏳ Muita procura agora — tentando de novo em ${s}s...`) },
    )
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new Error(friendlyApiError(response.status, data?.error))
    }
    return response.blob()
  }

  async function handleGenerateAllAudio() {
    if (!posts) return
    setGeneratingAll(true)
    setAudioErrors({})
    setRateNotice('')
    setAudioProgress({ done: 0, total: posts.length })

    const blobs: Record<number, Blob> = { ...audioBlobs }
    const errs: Record<number, string> = {}

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i]
      if (blobs[i]) {
        setAudioProgress({ done: i + 1, total: posts.length })
        continue
      }
      try {
        blobs[i] = await generateAudioFor(post)
        setAudioBlobs({ ...blobs })
        setRateNotice('')
      } catch (err) {
        errs[i] = err instanceof Error ? err.message : 'Erro ao gerar áudio'
        setAudioErrors({ ...errs })
      }
      setAudioProgress({ done: i + 1, total: posts.length })
      // Throttle: espaça as chamadas p/ não estourar o limite/min (exceto na última).
      if (i < posts.length - 1) await sleep(VOICE_THROTTLE_MS)
    }

    setRateNotice('')
    setGeneratingAll(false)
  }

  function handlePlayAudio(index: number) {
    const blob = audioBlobs[index]
    if (!blob) return
    const audio = new Audio(URL.createObjectURL(blob))
    audio.play()
  }

  // Agente Guia: adiciona um serviço à lista (campo é uma lista separada por vírgula),
  // sem duplicar. Deixa o cliente ir "montando" a partir das sugestões da IA.
  function appendServico(servico: string) {
    const novo = servico.trim()
    if (!novo) return
    setServicos((prev) => {
      const parts = prev.split(',').map((s) => s.trim()).filter(Boolean)
      if (parts.some((p) => p.toLowerCase() === novo.toLowerCase())) return prev
      return [...parts, novo].join(', ')
    })
  }

  // Copia o texto pro clipboard e mostra "Copiado!" por ~1.5s.
  async function handleCopy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((k) => (k === key ? '' : k)), 1500)
    } catch {
      // navegador sem permissão de clipboard — ignora silenciosamente
    }
  }

  // Edição inline dos textos gerados (pedido de cliente): atualiza um campo do post.
  function updatePostField(index: number, field: 'hook' | 'roteiro' | 'legenda', value: string) {
    setPosts((prev) =>
      prev ? prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)) : prev
    )
  }

  // Sobe a imagem/logo do cliente pra um card (fica só no navegador até baixar o ZIP).
  function handleImageUpload(index: number, file: File | undefined) {
    if (!file || !file.type.startsWith('image/')) return
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
    setPostImages((prev) => {
      if (prev[index]) URL.revokeObjectURL(prev[index].url)
      return { ...prev, [index]: { url: URL.createObjectURL(file), blob: file, ext } }
    })
  }

  function handleRemoveImage(index: number) {
    setPostImages((prev) => {
      const next = { ...prev }
      if (next[index]) URL.revokeObjectURL(next[index].url)
      delete next[index]
      return next
    })
  }

  // Logo enviada 1x: valida (png/jpg/svg, máx 2MB) e guarda em base64 p/ embutir no PNG.
  function handleLogoUpload(file: File | undefined) {
    setLogoError('')
    if (!file) return
    const ok = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml']
    if (!ok.includes(file.type)) {
      setLogoError('Formato inválido. Use PNG, JPG ou SVG.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoError('Logo muito grande (máx 2MB).')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setBrandLogo(typeof reader.result === 'string' ? reader.result : null)
    reader.readAsDataURL(file)
  }

  function slidesFor(index: number): SlideKey[] {
    const slides: SlideKey[] = ['hook', 'roteiro', 'legenda']
    if (postImages[index]) slides.push('imagem')
    return slides
  }

  // Exporta os templates ocultos (1080x1350 fixo cada) — um PNG por bloco (Hook, Roteiro,
  // Legenda, Imagem), prontos pra virar um carrossel no Instagram. Nunca o card da tela,
  // que tem altura variável e é o que causava o corte ao publicar.
  async function handleDownloadPng(index: number, dia: number, periodo: string, horario: string) {
    const slides = slidesFor(index)
    setExportingIndex(index)
    try {
      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i]
        const node = exportRefs.current[slideRefKey(index, slide)]
        if (!node) continue
        const dataUrl = await toPng(node, {
          pixelRatio: 2,
          width: EXPORT_W,
          height: EXPORT_H,
          backgroundColor: '#111111',
        })
        const a = document.createElement('a')
        a.href = dataUrl
        a.download = `card-${diaTag(dia, periodo, horario)}-${i + 1}-${slide}.png`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        // Pequeno intervalo entre downloads pro navegador não engasgar com vários de uma vez.
        if (i < slides.length - 1) await sleep(200)
      }
    } catch (err) {
      console.error('Erro ao exportar PNG:', err)
    } finally {
      setExportingIndex(null)
    }
  }

  async function handleDownloadKit() {
    if (!estrategia || !posts) return
    setIsZipping(true)
    try {
      const zip = new JSZip()
      zip.file('estrategia.md', buildEstrategiaMarkdown(nicho, tom, estrategia))

      const roteiros = zip.folder('roteiros')
      const audios = zip.folder('audios')
      const imagens = zip.folder('imagens')
      // Áudio vai como OGG/Opus no ZIP — único formato que o WhatsApp reconhece como "áudio
      // de voz" (player embutido); WAV chega lá como anexo genérico ("arquivo").
      for (let index = 0; index < posts.length; index++) {
        const p = posts[index]
        roteiros?.file(`${diaTag(p.dia, p.periodo, p.horario)}.txt`, buildPostText(p))
        const blob = audioBlobs[index]
        if (blob) {
          const oggBlob = await convertToWhatsAppOgg(blob, 'wav')
          audios?.file(`${diaTag(p.dia, p.periodo, p.horario)}.ogg`, oggBlob)
        }
        const img = postImages[index]
        if (img) imagens?.file(`${diaTag(p.dia, p.periodo, p.horario)}.${img.ext}`, img.blob)
      }

      // Renderiza os 4 slides (Hook/Roteiro/Legenda/Imagem) de cada dia e inclui no ZIP.
      const cards = zip.folder('cards')
      for (let index = 0; index < posts.length; index++) {
        const p = posts[index]
        const slides = slidesFor(index)
        for (let i = 0; i < slides.length; i++) {
          const slide = slides[i]
          const node = exportRefs.current[slideRefKey(index, slide)]
          if (!node) continue
          try {
            const dataUrl = await toPng(node, {
              pixelRatio: 2,
              width: EXPORT_W,
              height: EXPORT_H,
              backgroundColor: '#111111',
            })
            cards?.file(`${diaTag(p.dia, p.periodo, p.horario)}-${i + 1}-${slide}.png`, dataUrl.split(',')[1], { base64: true })
          } catch (err) {
            console.error(`Erro ao renderizar slide ${slide} do dia ${p.dia}:`, err)
          }
        }
      }

      const content = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(content)
      const a = document.createElement('a')
      a.href = url
      a.download = `kit-${nicho.trim().toLowerCase().replace(/\s+/g, '-') || 'conteudo'}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setIsZipping(false)
    }
  }

  // Exporta todo o calendário gerado como .ics — abre no Google Agenda (ou qualquer app de
  // calendário) já com data e horário certos pra cada post, um evento de 15min por post.
  function handleExportGoogleAgenda() {
    if (!posts) return
    const start = new Date(`${dataInicio}T00:00:00`)
    const events = posts.map((post, index) => ({
      uid: `voiceflowia-${dataInicio}-dia${post.dia}-${post.periodo}-${index}@voiceflowia.app`,
      start: postDateTime(start, post.dia, post.horario),
      durationMinutes: 15,
      summary: `VoiceFlow IA - Dia ${post.dia} · ${post.periodo} - ${post.hook}`,
      description: `HOOK: ${post.hook}\n\nROTEIRO: ${post.roteiro}\n\nLEGENDA: ${post.legenda}`,
    }))
    const ics = buildIcsCalendar(events)
    downloadIcsFile(`calendario-${nicho.trim().toLowerCase().replace(/\s+/g, '-') || 'conteudo'}.ics`, ics)
  }

  const audioCount = Object.keys(audioBlobs).length
  const errorCount = Object.keys(audioErrors).length

  if (loadingSubscription) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A]">
        <Loader2 className="w-8 h-8 animate-spin text-[#8B5CF6]" />
      </div>
    )
  }

  if (!hasAccess) {
    // Quem nunca teve trial não é um caso de upgrade — é alguém que ainda não
    // conheceu o produto. Mandar essa pessoa pra página de preços é onde o funil
    // perdia gente: ela nem chegou a gerar o primeiro conteúdo.
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] relative">
        <BackButton to="/dashboard" label="Voltar ao Painel" className="absolute top-6 left-6" />
        <div className="text-center p-8 bg-[#111111] border border-gray-800 rounded-2xl max-w-md">
          <Lock className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Acesso Restrito</h2>
          <p className="text-gray-400 mb-6">
            O Super Agente está disponível apenas nos planos{' '}
            <span className="text-[#8B5CF6] font-bold">Crescimento</span> e{' '}
            <span className="text-[#22C55E] font-bold">Dominação</span>.
          </p>
          {canStartTrial && <AtivarTrial onAtivar={startTrial} className="mb-4" />}
          <Button className="bg-[#8B5CF6] hover:bg-[#7C3AED]" onClick={() => (window.location.href = '/precos')}>
            Ver Planos
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] p-6">
      <div className="max-w-5xl mx-auto">
        <BackButton to="/dashboard" label="Voltar ao Painel" className="mb-6" />
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-2">
            <Rocket className="w-8 h-8 text-[#8B5CF6]" />
            Super Agente
          </h1>
          <p className="text-gray-400">
            Estratégia completa + roteiros + todas as vozes geradas de uma vez. Baixe o mês inteiro em um clique.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <span className="text-red-300">{error}</span>
          </div>
        )}

        {rateNotice && (
          <div className="mb-6 p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-xl flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-yellow-400 shrink-0 animate-spin" />
            <span className="text-yellow-300">{rateNotice}</span>
          </div>
        )}

        {/* Formulário */}
        <div className="bg-[#111111] border border-gray-800 rounded-2xl p-6 space-y-6 mb-8">
          {/* Atalho de entrada: cola o material bruto e a IA preenche os campos abaixo.
              Existe pra tirar o cliente da tela em branco — tudo continua editável. */}
          <div className="bg-[#8B5CF6]/5 border border-[#8B5CF6]/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-[#8B5CF6]" />
              <h3 className="text-sm font-bold text-white">Comece rápido <span className="text-gray-500 font-normal">(opcional)</span></h3>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Cole qualquer coisa sobre a marca — o site do cliente, a bio do Instagram, o que ele te mandou no WhatsApp — e a IA preenche o briefing abaixo pra você conferir.
            </p>
            <textarea
              value={briefingBruto}
              onChange={(e) => setBriefingBruto(e.target.value)}
              rows={4}
              placeholder="Ex: Somos a OtoBel, trabalhamos com aparelhos auditivos há 12 anos em Belo Horizonte. Fazemos adaptação, manutenção e teste de audição. Todo cliente tem acompanhamento com fonoaudióloga e retorno gratuito..."
              className="w-full p-3 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#8B5CF6] resize-none"
            />
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <Button
                onClick={handleExtrairBriefing}
                disabled={!briefingBruto.trim() || extraindo}
                className="bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40"
              >
                {extraindo ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Lendo o material...</>
                ) : (
                  <><Sparkles className="w-4 h-4" /> Preencher com IA</>
                )}
              </Button>
              <span className="text-xs text-gray-600">Não gasta geração do seu plano.</span>
            </div>

            {extrairErro && (
              <div className="mt-3 flex items-start gap-2 text-sm text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{extrairErro}</span>
              </div>
            )}

            {extracao && (
              <div className="mt-3 space-y-1 text-xs">
                {extracao.preenchidos.length > 0 ? (
                  <p className="text-green-400 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />
                    <span>Preenchi: <strong>{extracao.preenchidos.join(', ')}</strong>. Confira abaixo e ajuste o que quiser.</span>
                  </p>
                ) : (
                  <p className="text-yellow-400 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                    <span>Não consegui tirar nada desse material. Tente colar algo mais descritivo sobre a marca.</span>
                  </p>
                )}
                {extracao.vazios.length > 0 && (
                  <p className="text-gray-500 pl-6">
                    Não estava no material: {extracao.vazios.join(', ')} — deixei em branco de propósito, preencha na mão se for importante.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Nicho da Agência</label>
              <input
                type="text"
                value={nicho}
                onChange={(e) => setNicho(e.target.value)}
                placeholder="Ex: Barbearia"
                className="w-full p-3 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Tom de Voz</label>
              <select
                value={tom}
                onChange={(e) => setTom(e.target.value)}
                className="w-full p-3 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#8B5CF6]"
              >
                {TONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.value} [{t.dica}]</option>
                ))}
              </select>
              <p className="text-xs text-gray-600 mt-1">Como o texto fala. Se você preencher "Tom da Marca" abaixo, ele manda neste.</p>
            </div>
            {/* V1.6 Seletor manual de voz. Automático = IA decide. */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Voz da IA</label>
              <select
                value={voz}
                onChange={(e) => setVoz(e.target.value)}
                className="w-full p-3 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#8B5CF6]"
              >
                <option value="">Automático [IA Decide]</option>
                <option value="Zephyr">Zephyr [Firme/Autoridade]</option>
                <option value="Puck">Puck [Leve/Animado]</option>
                <option value="Kore">Kore [Feminina/Profissional]</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Qtd. Dias</label>
              <input
                type="number"
                min={1}
                max={30}
                value={qtdDias}
                onChange={(e) => setQtdDias(Math.min(Math.max(Number(e.target.value) || 1, 1), 30))}
                className="w-full p-3 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#8B5CF6]"
              />
              <p className="text-xs text-gray-600 mt-1">Cada dia gera 2 cards: Manhã + Tarde. A IA já sugere o melhor horário pra postar de cada um.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Data de Início</label>
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="w-full p-3 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#8B5CF6]"
              />
              <p className="text-xs text-gray-600 mt-1">Em que dia "Dia 1" cai de verdade — usado no export pro Google Agenda.</p>
            </div>
          </div>

          {/* Memória da Marca (Fase 1) VISÍVEL — custo de troca com dado real. Só aparece
              quando há nicho digitado; o texto muda se já existe histórico ou é a 1ª vez. */}
          {memoria && (
            memoria.kits > 0 ? (
              <div className="border border-[#8B5CF6]/40 bg-gradient-to-r from-[#8B5CF6]/10 to-transparent rounded-xl p-4 flex gap-3">
                <Brain className="w-6 h-6 text-[#8B5CF6] shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="text-white font-semibold">A IA já conhece {nicho.trim()} 🧠</p>
                  <p className="text-gray-300 mt-1">
                    {memoria.kits} {memoria.kits === 1 ? 'kit já gerado' : 'kits já gerados'} pra esta marca
                    {memoria.hooks > 0 && <> · {memoria.hooks} ganchos memorizados</>}
                    {memoria.ultima && formatarDataMemoria(memoria.ultima) && <> · último em {formatarDataMemoria(memoria.ultima)}</>}.
                    {' '}Neste kit ela evita repetir os ângulos que você já usou — <b className="text-white">quanto mais meses, mais afiada</b>.
                  </p>
                  <p className="text-gray-500 text-xs mt-1.5">
                    Esse aprendizado é da sua conta. Se cancelar, a IA esquece a sua marca e volta à estaca zero.
                  </p>
                </div>
              </div>
            ) : (
              <div className="border border-gray-800 bg-[#141414] rounded-xl p-4 flex gap-3">
                <Brain className="w-6 h-6 text-gray-500 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="text-white font-semibold">Primeira vez com {nicho.trim()} ✨</p>
                  <p className="text-gray-400 mt-1">
                    A partir deste kit, a IA começa a memorizar os ângulos da sua marca pra{' '}
                    <b className="text-gray-200">nunca repetir</b> nos próximos meses. Quanto mais você gera, mais ela te conhece.
                  </p>
                </div>
              </div>
            )
          )}

          {/* Ganchos sazonais (opcional) — datas comerciais chegando. Clicar numa data
              injeta a campanha na geração; parte do mês fica temática. Motivo pra o
              cliente voltar no meio do ciclo. As datas são calculadas de verdade. */}
          <div className="border border-gray-800 rounded-xl p-4 bg-[#141414]">
            <div className="flex items-center gap-2 mb-1">
              <CalendarDays className="w-4 h-4 text-[#8B5CF6]" />
              <h3 className="text-sm font-bold text-white">Ganchos sazonais <span className="text-gray-500 font-normal">(opcional)</span></h3>
            </div>
            <p className="text-xs text-gray-500 mb-3">Datas que vendem chegando. Clique numa pra a IA dedicar parte do mês a ela.</p>
            {datasProximas.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {datasProximas.map((d) => {
                  const ativo = campanha.trim() === d.nome
                  return (
                    <button
                      key={d.nome}
                      type="button"
                      onClick={() => setCampanha(ativo ? '' : d.nome)}
                      className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${ativo ? 'bg-[#8B5CF6] border-[#8B5CF6] text-white' : 'bg-[#1A1A1A] border-gray-700 text-gray-300 hover:border-[#8B5CF6]'}`}
                    >
                      {d.emoji} {d.nome} <span className="opacity-70">· {textoContagem(d.diasFaltando)}</span>
                    </button>
                  )
                })}
              </div>
            )}
            <input
              type="text"
              value={campanha}
              onChange={(e) => setCampanha(e.target.value)}
              placeholder="Ou escreva a sua: Aniversário da loja, Liquidação de inverno..."
              className="w-full p-3 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#8B5CF6] text-sm"
            />
            {campanha.trim() && (
              <p className="text-xs text-[#8B5CF6] mt-2">✨ A IA vai dedicar parte do mês a "{campanha.trim()}".</p>
            )}
          </div>

          {/* V1.5 — Estudo de Marca (opcional). Deixa o output na cara do cliente. */}
          <div className="border-t border-gray-800 pt-6">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-[#8B5CF6]" />
              <h3 className="text-sm font-bold text-white">Estudo de Marca <span className="text-gray-500 font-normal">(opcional)</span></h3>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Preencha olhando o Instagram do cliente. Quanto mais completo, mais os roteiros saem na cara da marca. Vazio = gera pelo nicho.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">@ Instagram da Marca</label>
                <input
                  type="text"
                  value={instagram}
                  onChange={(e) => setInstagram(e.target.value)}
                  placeholder="@clinicasim"
                  className="w-full p-3 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#8B5CF6]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Serviços Principais</label>
                <input
                  type="text"
                  value={servicos}
                  onChange={(e) => setServicos(e.target.value)}
                  placeholder="Botox, Fios, Peelings"
                  className="w-full p-3 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#8B5CF6]"
                />
                <p className="text-xs text-gray-600 mt-1">Só os nomes, separados por vírgula. Não cole texto de descrição aqui.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Tom da Marca</label>
                <input
                  type="text"
                  value={tomMarca}
                  onChange={(e) => setTomMarca(e.target.value)}
                  placeholder="Autoridade médica, sofisticado"
                  className="w-full p-3 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#8B5CF6]"
                />
                <p className="text-xs text-gray-600 mt-1">Duas ou três palavras de estilo (ex: "descontraído", "técnico"). Descrição da empresa vai no campo Diferenciais abaixo.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">CTA Principal</label>
                <input
                  type="text"
                  value={cta}
                  onChange={(e) => setCta(e.target.value)}
                  placeholder="Agende sua Avaliação"
                  className="w-full p-3 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#8B5CF6]"
                />
              </div>
            </div>

            {/* Texto livre p/ diferenciais/regras do negócio (a IA usa fiel ao escrito). */}
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Diferenciais / Informações importantes <span className="text-gray-500 font-normal">(opcional)</span>
              </label>
              <textarea
                value={diferenciais}
                onChange={(e) => setDiferenciais(e.target.value)}
                rows={3}
                placeholder="Ex: Acompanhamento com fonoaudióloga no pós-venda. Retornos de consulta gratuitos para quem comprou o aparelho. O agendamento é feito pela própria empresa."
                className="w-full p-3 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#8B5CF6] resize-none"
              />
              <p className="text-xs text-gray-600 mt-1">
                Regras, garantias, pós-venda, condições... A IA inclui isso nos roteiros, fiel ao que você escrever.
              </p>
            </div>
          </div>

          {/* Logo da marca: envia 1x, aparece em todos os cards automaticamente. */}
          <div className="border-t border-gray-800 pt-6">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Envie a Logo da sua Marca <span className="text-gray-500 font-normal">[PNG, JPG, SVG]</span>
            </label>
            {brandLogo ? (
              <div className="flex items-center gap-3">
                <img
                  src={brandLogo}
                  alt="Logo da marca"
                  className="w-12 h-12 object-contain rounded-lg border border-gray-700 bg-white p-1"
                />
                <button
                  onClick={() => { setBrandLogo(null); setLogoError('') }}
                  className="flex items-center gap-1 text-sm text-gray-400 hover:text-red-400"
                >
                  <X className="w-4 h-4" /> Remover
                </button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 w-full md:w-auto md:inline-flex px-4 py-3 border border-dashed border-gray-700 rounded-lg text-gray-400 text-sm cursor-pointer hover:border-[#8B5CF6] hover:text-[#8B5CF6] transition-colors">
                <ImagePlus className="w-4 h-4" />
                Escolher logo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  className="hidden"
                  onChange={(e) => handleLogoUpload(e.target.files?.[0])}
                />
              </label>
            )}
            {logoError && <p className="text-xs text-red-400 mt-2">{logoError}</p>}
            <p className="text-xs text-gray-600 mt-2">
              Sua logo vai aparecer automaticamente em todos os cards. É só enviar 1 vez.
            </p>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={isGenerating || !nicho.trim()}
            className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-lg py-6 font-bold"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Gerando Estratégia e Roteiros...
              </>
            ) : (
              'Gerar Estratégia + Conteúdo 🚀'
            )}
          </Button>
        </div>

        {/* Estratégia — vem recolhida: cliente vê o resumo e abre os detalhes só se quiser. */}
        {estrategia && (
          <div className="bg-[#111111] border border-[#8B5CF6]/40 rounded-2xl p-6 mb-8 space-y-4">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Target className="w-6 h-6 text-[#8B5CF6]" />
              Estratégia do Mês
            </h2>
            <p className="text-gray-300">{estrategia.resumo}</p>

            <button
              onClick={() => setEstrategiaAberta((v) => !v)}
              className="flex items-center gap-2 text-sm font-medium text-[#8B5CF6] hover:text-[#A78BFA] transition-colors"
            >
              {estrategiaAberta ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {estrategiaAberta ? 'Ocultar detalhes' : 'Ver detalhes completos (personas, pilares, hashtags...)'}
            </button>

            {estrategiaAberta && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              <StrategyBlock icon={<Users className="w-5 h-5" />} title="Personas">
                <ul className="space-y-2">
                  {estrategia.personas.map((p, i) => (
                    <li key={i} className="text-sm">
                      <span className="text-white font-semibold">{p.nome}:</span>{' '}
                      <span className="text-gray-400">{p.descricao}</span>
                    </li>
                  ))}
                </ul>
              </StrategyBlock>

              <StrategyBlock icon={<Target className="w-5 h-5" />} title="Pilares de Conteúdo">
                <ul className="list-disc list-inside text-sm text-gray-400 space-y-1">
                  {estrategia.pilares.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </StrategyBlock>

              <StrategyBlock icon={<Hash className="w-5 h-5" />} title="Hashtags">
                <div className="flex flex-wrap gap-2">
                  {estrategia.hashtags.map((h, i) => (
                    <span key={i} className="text-xs px-2 py-1 rounded-full bg-[#1A1A1A] border border-gray-700 text-[#8B5CF6]">
                      {h}
                    </span>
                  ))}
                </div>
              </StrategyBlock>

              <StrategyBlock icon={<Clock className="w-5 h-5" />} title="Melhores Horários">
                <ul className="list-disc list-inside text-sm text-gray-400 space-y-1">
                  {estrategia.melhoresHorarios.map((h, i) => <li key={i}>{h}</li>)}
                </ul>
              </StrategyBlock>

              <StrategyBlock icon={<Megaphone className="w-5 h-5" />} title="Ideias de CTA">
                <ul className="list-disc list-inside text-sm text-gray-400 space-y-1">
                  {estrategia.ctas.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </StrategyBlock>
            </div>
            )}
          </div>
        )}

        {/* Ações do Kit */}
        {posts && (
          <div className="bg-[#111111] border border-gray-800 rounded-2xl p-6 mb-8 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="text-lg font-bold text-white">Kit Completo</h3>
                <p className="text-sm text-gray-400">
                  {audioCount}/{posts.length} áudios gerados
                  {errorCount > 0 && <span className="text-yellow-500"> · {errorCount} falharam (cota da API)</span>}
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={handleGenerateAllAudio}
                  disabled={generatingAll}
                  className="bg-[#22C55E] hover:bg-[#16A34A] disabled:opacity-50 flex items-center gap-2"
                >
                  {generatingAll ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Gerando vozes... {audioProgress.done}/{audioProgress.total}
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-4 h-4" />
                      Gerar Todas as Vozes
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleDownloadKit}
                  disabled={isZipping}
                  className="bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 flex items-center gap-2"
                >
                  {isZipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                  Baixar Kit (ZIP)
                </Button>
                <Button
                  onClick={handleExportGoogleAgenda}
                  className="bg-[#22C55E] hover:bg-[#16A34A] flex items-center gap-2"
                >
                  <CalendarDays className="w-4 h-4" />
                  Exportar para Google Agenda
                </Button>
              </div>
            </div>
            {generatingAll && (
              <div className="w-full bg-[#1A1A1A] rounded-full h-2 overflow-hidden">
                <div
                  className="bg-[#22C55E] h-2 transition-all"
                  style={{ width: `${audioProgress.total ? (audioProgress.done / audioProgress.total) * 100 : 0}%` }}
                />
              </div>
            )}
            {rateNotice && <p className="text-xs text-yellow-400">{rateNotice}</p>}
            <p className="text-xs text-gray-600">
              Observação: o plano gratuito das APIs de voz limita a quantidade de áudios por dia. Se alguns falharem,
              habilite o faturamento no Google/ElevenLabs para gerar todos.
            </p>
          </div>
        )}

        {/* Posts */}
        {posts && (
          <Fragment>
          {/* Redes sociais do cliente: postar o conteúdo em 1 clique, sem sair do app. */}
          <RedesSociais
            links={socialLinks}
            onSave={(l) => {
              setSocialLinks(l)
              saveSocialLinks(socialStoreKey, l)
            }}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {posts.map((post, index) => (
              <div
                key={index}
                className="relative bg-[#111111] border border-gray-800 rounded-2xl p-5 space-y-3"
              >
                {/* Logo da marca aplicada automaticamente (fallback: nada se não houver). */}
                {brandLogo && (
                  <img
                    src={brandLogo}
                    alt="Logo da marca"
                    className="absolute top-4 right-4 w-20 h-20 object-contain bg-white rounded-lg p-2 shadow-lg z-10"
                  />
                )}
                <div className={`flex items-center justify-between ${brandLogo ? 'pr-24' : ''}`}>
                  <span className="text-[#8B5CF6] font-bold">Dia {post.dia} · {post.periodo}</span>
                  {audioBlobs[index] ? (
                    <span className="text-xs text-[#22C55E] flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> áudio pronto
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-1 rounded-full bg-[#1A1A1A] border border-gray-700 text-gray-400">
                      Voz: {post.vozSugerida}
                    </span>
                  )}
                </div>
                {post.horario && (
                  <span className="inline-block text-xs px-2 py-1 rounded-full bg-gray-700/50 text-gray-300">
                    📅 Melhor horário: {post.horario}
                  </span>
                )}
                <div className={brandLogo ? 'pr-24' : ''}>
                  <PostField
                    label="🎙️ Hook (3s)"
                    value={post.hook}
                    copyKey={`${index}-hook`}
                    copiedKey={copied}
                    onCopy={() => handleCopy(`${index}-hook`, post.hook)}
                    onSave={(v) => updatePostField(index, 'hook', v)}
                    displayClassName="text-white font-medium"
                  />
                </div>
                <div>
                  <PostField
                    label="🎙️ Roteiro (20s)"
                    value={post.roteiro}
                    copyKey={`${index}-roteiro`}
                    copiedKey={copied}
                    onCopy={() => handleCopy(`${index}-roteiro`, post.roteiro)}
                    onSave={(v) => updatePostField(index, 'roteiro', v)}
                    displayClassName="text-gray-300 text-sm"
                  />
                </div>
                <div>
                  <PostField
                    label="📝 Legenda · não vira áudio"
                    value={post.legenda}
                    copyKey={`${index}-legenda`}
                    copiedKey={copied}
                    onCopy={() => handleCopy(`${index}-legenda`, post.legenda)}
                    onSave={(v) => updatePostField(index, 'legenda', v)}
                    displayClassName="text-gray-300 text-sm"
                  />
                </div>
                <span className="inline-block text-xs px-2 py-1 rounded-full bg-gray-700/50 text-gray-300">
                  {post.periodo === 'Manhã' ? '🎯 Objetivo: Relacionamento' : '💰 Objetivo: Conversão/Venda'}
                </span>

                {/* Upload de imagem/logo do cliente por card (client-side, entra no ZIP). */}
                <div>
                  <p className="text-xs uppercase text-gray-500 mb-1">Imagem / Logo</p>
                  {postImages[index] ? (
                    <div className="relative">
                      <img
                        src={postImages[index].url}
                        alt={`Imagem do dia ${post.dia}`}
                        className="w-full max-h-40 object-contain rounded-lg border border-gray-700 bg-[#0A0A0A]"
                      />
                      <button
                        onClick={() => handleRemoveImage(index)}
                        title="Remover imagem"
                        className="no-export absolute top-2 right-2 bg-black/70 hover:bg-red-600 text-white rounded-full p-1"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <label className="no-export flex items-center justify-center gap-2 w-full py-3 border border-dashed border-gray-700 rounded-lg text-gray-400 text-sm cursor-pointer hover:border-[#8B5CF6] hover:text-[#8B5CF6] transition-colors">
                      <ImagePlus className="w-4 h-4" />
                      Subir imagem/logo
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleImageUpload(index, e.target.files?.[0])}
                      />
                    </label>
                  )}
                </div>

                {audioErrors[index] && (
                  <p className="text-yellow-500 text-xs">{audioErrors[index]}</p>
                )}

                <div className="no-export flex gap-2">
                  {audioBlobs[index] && (
                    <Button
                      onClick={() => handlePlayAudio(index)}
                      className="flex-1 bg-[#1A1A1A] hover:bg-[#252525] flex items-center justify-center gap-2"
                    >
                      <Play className="w-4 h-4" />
                      Ouvir
                    </Button>
                  )}
                  <Button
                    onClick={() => handleDownloadPng(index, post.dia, post.periodo, post.horario)}
                    disabled={exportingIndex === index}
                    className="flex-1 bg-[#1A1A1A] hover:bg-[#252525] disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {exportingIndex === index ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    Baixar Cards ({slidesFor(index).length})
                  </Button>
                </div>

                {/* Postar em: copia a legenda deste post e abre a rede pra colar. Só mostra
                    as redes que o cliente configurou no painel "Suas Redes Sociais". */}
                {(() => {
                  const configured = SOCIAL_NETWORKS.filter((net) => (socialLinks[net.key] ?? '').trim())
                  if (configured.length === 0) return null
                  return (
                    <div className="no-export space-y-1 pt-1">
                      <p className="text-xs text-gray-500">Postar em (copia a legenda e abre a rede):</p>
                      <div className="flex flex-wrap gap-2">
                        {configured.map((net) => {
                          const url = (socialLinks[net.key] ?? '').trim()
                          const copyKey = `postar-${index}-${net.key}`
                          const isCopied = copied === copyKey
                          return (
                            <button
                              key={net.key}
                              onClick={async () => {
                                await handleCopy(copyKey, `${post.hook}\n\n${post.legenda}`)
                                window.open(url, '_blank', 'noopener')
                              }}
                              title={`Copia a legenda e abre o ${net.label}`}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-[#1A1A1A] border border-gray-700 text-gray-300 hover:border-[#8B5CF6] hover:text-[#8B5CF6] transition-colors"
                            >
                              {isCopied ? (
                                <><Check className="w-3.5 h-3.5" /> Copiado!</>
                              ) : (
                                <><Share2 className="w-3.5 h-3.5" /> {net.label}</>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}
              </div>
            ))}
          </div>

          {/* Slides ocultos de exportação (um por bloco: Hook, Roteiro, Legenda, Imagem) — o que de
              fato vira PNG, pronto pra publicar como carrossel no Instagram. Ficam fora do grid pra
              não entrar no auto-placement do CSS Grid e empurrar os cards visíveis. */}
          {posts.map((post, index) => (
            <Fragment key={index}>
              {slidesFor(index).map((slide) => (
                <ExportSlide
                  key={slide}
                  innerRef={(el) => { exportRefs.current[slideRefKey(index, slide)] = el }}
                  brandLogo={brandLogo}
                >
                  {slide === 'hook' && (
                    <p style={{ margin: 0, fontWeight: 700, lineHeight: 1.25, fontSize: hookFontSize(post.hook) }}>
                      {post.hook}
                    </p>
                  )}
                  {slide === 'roteiro' && (
                    <p style={{ margin: 0, lineHeight: 1.45, fontSize: bodyFontSize(post.roteiro) }}>
                      {post.roteiro}
                    </p>
                  )}
                  {slide === 'legenda' && (
                    <p style={{ margin: 0, lineHeight: 1.45, fontSize: bodyFontSize(post.legenda) }}>
                      {post.legenda}
                    </p>
                  )}
                  {slide === 'imagem' && postImages[index] && (
                    <img
                      src={postImages[index].url}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 16 }}
                    />
                  )}
                </ExportSlide>
              ))}
            </Fragment>
          ))}
          </Fragment>
        )}
      </div>

      {/* Agente Guia flutuante: ensina o passo a passo e sugere frases pela IA. */}
      <SuperAgenteGuia
        nicho={nicho}
        servicos={servicos}
        onAppendServico={appendServico}
        onSetTomMarca={setTomMarca}
        onSetCta={setCta}
      />
    </div>
  )
}

// Texto de um post: rótulo + Copiar + Editar (lápis) e edição inline.
// O textarea de edição é `no-export` p/ não vazar na exportação PNG do card.
function PostField({
  label,
  value,
  copyKey,
  copiedKey,
  onCopy,
  onSave,
  displayClassName,
}: {
  label: string
  value: string
  copyKey: string
  copiedKey: string
  onCopy: () => void
  onSave: (next: string) => void
  displayClassName: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isCopied = copiedKey === copyKey

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  function startEditing() {
    setDraft(value)
    setEditing(true)
    // Foca e ajusta a altura no próximo tick, quando o textarea já existe.
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        autoGrow(el)
        el.setSelectionRange(el.value.length, el.value.length)
      }
    })
  }

  function save() {
    onSave(draft.trim())
    setEditing(false)
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs uppercase text-gray-500 leading-snug">{label}</p>
        {!editing && (
          <div className="no-export flex items-center gap-3 shrink-0">
            <button
              onClick={startEditing}
              title="Editar texto"
              aria-label={`Editar ${label}`}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-[#8B5CF6] transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" /> Editar
            </button>
            <button
              onClick={onCopy}
              title="Copiar texto"
              className={`flex items-center gap-1 text-xs transition-colors ${isCopied ? 'text-[#22C55E]' : 'text-gray-500 hover:text-[#8B5CF6]'}`}
            >
              {isCopied ? <><Check className="w-3.5 h-3.5" /> Copiado!</> : <><Copy className="w-3.5 h-3.5" /> Copiar</>}
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              autoGrow(e.target)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
              if (e.key === 'Escape') cancel()
            }}
            rows={2}
            className="no-export w-full p-2 bg-[#1A1A1A] border border-[#8B5CF6] rounded-lg text-white text-sm leading-relaxed focus:outline-none resize-none overflow-hidden"
          />
          <div className="no-export flex gap-2">
            <button
              onClick={save}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] text-white font-medium transition-colors"
            >
              <Check className="w-3.5 h-3.5" /> Salvar
            </button>
            <button
              onClick={cancel}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-[#1A1A1A] border border-gray-700 hover:bg-[#252525] text-gray-300 transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Cancelar
            </button>
          </div>
        </div>
      ) : (
        <p className={displayClassName}>{value}</p>
      )}
    </div>
  )
}

function StrategyBlock({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#0A0A0A] border border-gray-800 rounded-xl p-4">
      <h4 className="text-sm font-bold text-gray-300 mb-3 flex items-center gap-2">
        <span className="text-[#8B5CF6]">{icon}</span>
        {title}
      </h4>
      {children}
    </div>
  )
}
