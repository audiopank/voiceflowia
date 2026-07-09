import { Fragment, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import JSZip from 'jszip'
import { toPng } from 'html-to-image'
import {
  Lock, Loader2, AlertCircle, Rocket, Volume2, Download, Play, Package,
  Users, Target, Hash, Clock, Megaphone, CheckCircle2, Copy, Check, ImagePlus, X, Pencil,
  ChevronDown, ChevronUp, CalendarDays
} from 'lucide-react'
import { useSubscription } from '../lib/useSubscription'
import { supabase } from '../lib/supabase'
import { fetchWithRetry, sleep } from '../lib/apiRetry'
import { Button } from '../components/ui/button'
import { BackButton } from '../components/BackButton'
import { SuperAgenteGuia } from '../components/SuperAgenteGuia'
import { buildIcsCalendar, downloadIcsFile, postDateTime } from '../lib/ics'

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
const SLIDE_LABEL: Record<SlideKey, string> = {
  hook: 'HOOK',
  roteiro: 'ROTEIRO (20s)',
  legenda: 'LEGENDA',
  imagem: 'IMAGEM',
}

// Tamanho fixo dos slides do carrossel: 1080x1350 (4:5), o retrato mais alto que o Instagram
// aceita sem cortar/recomprimir no feed.
const EXPORT_W = 540
const EXPORT_H = 675

// Um slide do carrossel — chrome comum (dia, contador, logo, rótulo do bloco) + conteúdo
// específico do bloco. Fica oculto (height:0/overflow:hidden na wrapper) até ser exportado.
// "dia" aqui é só de exibição (rótulo "Dia N"); a chave de estado é sempre a posição na lista.
function ExportSlide({
  innerRef, dia, periodo, horario, slide, index, total, brandLogo, children,
}: {
  innerRef: (el: HTMLDivElement | null) => void
  dia: number
  periodo: string
  horario: string
  slide: SlideKey
  index: number
  total: number
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <span style={{ color: '#8B5CF6', fontWeight: 700, fontSize: 18 }}>Dia {dia} · {periodo}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: '#6B7280', fontWeight: 600 }}>{index}/{total}</span>
            {brandLogo && (
              <img
                src={brandLogo}
                alt=""
                style={{ width: 40, height: 40, objectFit: 'contain', background: '#FFFFFF', borderRadius: 8, padding: 4 }}
              />
            )}
          </div>
        </div>
        <p style={{ margin: '16px 0 0', fontSize: 13, letterSpacing: 1, color: '#8B5CF6', fontWeight: 700 }}>
          {SLIDE_LABEL[slide]}
        </p>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', marginTop: 8 }}>
          {children}
        </div>
        {horario && (
          <p style={{ margin: 0, fontSize: 13, color: '#6B7280', textAlign: 'center' }}>
            Dia {dia} · {periodo} · 📅 {horario}
          </p>
        )}
      </div>
    </div>
  )
}

function SuperAgente() {
  const { hasAccess, loading: loadingSubscription, trial, refresh } = useSubscription()
  const [nicho, setNicho] = useState('')
  const [tom, setTom] = useState('Profissional')
  // Fluxo de 2 posts/dia (Manhã + Tarde): este campo é quantidade de DIAS, não de posts —
  // o total de cards gerados é o dobro.
  const [qtdDias, setQtdDias] = useState(4)
  // Data em que "Dia 1" cai de verdade — pro export do Google Agenda. Padrão: hoje.
  const [dataInicio, setDataInicio] = useState(todayIso)

  // V1.5 Estudo de Marca — opcionais. Vazios = gera igual hoje.
  const [instagram, setInstagram] = useState('')
  const [servicos, setServicos] = useState('')
  const [tomMarca, setTomMarca] = useState('')
  const [cta, setCta] = useState('')
  const [diferenciais, setDiferenciais] = useState('')

  // V1.6 Seletor de voz. '' = Automático (IA decide entre Zephyr/Puck).
  const [voz, setVoz] = useState('')

  // Copiar texto (pedido de cliente): guarda a chave do campo copiado p/ feedback.
  const [copied, setCopied] = useState('')

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
      const response = await fetchWithRetry(
        '/api/gemini/generate-strategy',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nicho, tom, qtdPosts: qtdDias, instagram, servicos, tomMarca, cta, diferenciais, voz }) // V1.6: voz forçada ('' = automático)
        },
        { onWait: (s) => setRateNotice(`⏳ Limite temporário da API. Aguardando ${s}s e tentando de novo...`) },
      )
      setRateNotice('')

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || `Erro na API: ${response.status}`)
      }

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

      // Atualiza a contagem do trial no banner do topo.
      if (trial.isTrial) void refresh()
    } catch (err) {
      console.error('=== ERRO ao gerar estratégia ===', err)
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
      { onWait: (s) => setRateNotice(`⏳ Limite temporário da API. Aguardando ${s}s e tentando de novo...`) },
    )
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new Error(data?.error || `Erro na API: ${response.status}`)
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
      posts.forEach((p, index) => {
        roteiros?.file(`${diaTag(p.dia, p.periodo, p.horario)}.txt`, buildPostText(p))
        const blob = audioBlobs[index]
        if (blob) audios?.file(`${diaTag(p.dia, p.periodo, p.horario)}.wav`, blob)
        const img = postImages[index]
        if (img) imagens?.file(`${diaTag(p.dia, p.periodo, p.horario)}.${img.ext}`, img.blob)
      })

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
                <option value="Profissional">Profissional</option>
                <option value="Divertido">Divertido</option>
                <option value="Vendedor">Vendedor</option>
              </select>
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
                    label="Hook (3s)"
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
                    label="Roteiro (20s)"
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
                    label="Legenda"
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
              </div>
            ))}
          </div>

          {/* Slides ocultos de exportação (um por bloco: Hook, Roteiro, Legenda, Imagem) — o que de
              fato vira PNG, pronto pra publicar como carrossel no Instagram. Ficam fora do grid pra
              não entrar no auto-placement do CSS Grid e empurrar os cards visíveis. */}
          {posts.map((post, index) => (
            <Fragment key={index}>
              {slidesFor(index).map((slide, i, arr) => (
                <ExportSlide
                  key={slide}
                  innerRef={(el) => { exportRefs.current[slideRefKey(index, slide)] = el }}
                  dia={post.dia}
                  periodo={post.periodo}
                  horario={post.horario}
                  slide={slide}
                  index={i + 1}
                  total={arr.length}
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
        <p className="text-xs uppercase text-gray-500">{label}</p>
        {!editing && (
          <div className="no-export flex items-center gap-3">
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
