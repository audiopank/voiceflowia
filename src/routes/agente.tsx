import { Fragment, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Lock, Loader2, AlertCircle, Sparkles, Volume2, Download, Play, CalendarDays, RefreshCw } from 'lucide-react'
import { useSubscription, devolverGeracaoTrial } from '../lib/useSubscription'
import { supabase } from '../lib/supabase'
import { fetchWithRetry, safeJson, friendlyApiError } from '../lib/apiRetry'
import { textoLongoDemais, avisoTextoLongo } from '../lib/limites'
import { Button } from '../components/ui/button'
import { PublicarNewPost } from '../components/PublicarNewPost'
import {
  ExportSlide, hookFontSize, bodyFontSize, slideRefKey, renderSlidesToBlobs,
} from '../components/CardExport'
import { convertVoiceToMp3 } from '../lib/audioConvert'
import { BackButton } from '../components/BackButton'
import { AtivarTrial } from '../components/AtivarTrial'
import { EditableText } from '../components/EditableText'
import { CtaObjetivo } from '../components/CtaObjetivo'
import { FeedPreview } from '../components/FeedPreview'
import { HumanizarButton } from '../components/HumanizarButton'
import { buildIcsCalendar, downloadIcsFile, postDateTime } from '../lib/ics'
import { convertToWhatsAppOgg } from '../lib/audioConvert'
import { TONS, TOM_PADRAO } from '../lib/tons'
import { realcarVoz, aplicarTrilha, carregarTrilhaDialogo } from '../lib/estudioCards'
import { useTrilhaFundo, TrilhaFundoPanel } from '../components/TrilhaFundo'
import { ModoDialogo } from '../components/ModoDialogo'
import { montarTranscricao, falantesParaApi, type Dialogo } from '../lib/dialogo'

// Data de hoje em yyyy-mm-dd, pro input type="date" (padrão: "Dia 1" = hoje).
function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const Route = createFileRoute('/agente')({
  component: Agente,
})

interface Post {
  dia: number
  periodo: 'Manhã' | 'Tarde'
  horario: string
  hook: string
  roteiro: string
  legenda: string
  vozSugerida: string
}

function Agente() {
  const { hasAccess, loading: loadingSubscription, trial, refresh, canStartTrial, startTrial } = useSubscription()
  const [nicho, setNicho] = useState('')
  const [tom, setTom] = useState(TOM_PADRAO)
  // Fluxo de 2 posts/dia (Manhã + Tarde): este campo é quantidade de DIAS, não de posts —
  // o total de cards gerados é o dobro.
  const [qtdDias, setQtdDias] = useState(15)
  // Data em que "Dia 1" cai de verdade — pro export do Google Agenda. Padrão: hoje.
  const [dataInicio, setDataInicio] = useState(todayIso)
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState('')

  const [audioBlobs, setAudioBlobs] = useState<Record<number, Blob>>({})
  const [audioErrors, setAudioErrors] = useState<Record<number, string>>({})
  // Aviso da cama de conversa em canal PRÓPRIO, separado de audioErrors: são coisas
  // diferentes (o áudio saiu, só veio sem cama) e dividir o mesmo canal apagava o erro de
  // geração do card — e, pior, o aviso ficava grudado na tela depois de resolvido, porque
  // quem limpa audioErrors é o "gerar áudio", não o download.
  const [camaAvisos, setCamaAvisos] = useState<Record<number, string>>({})
  // Modo Diálogo por card (índice da lista, mesma regra do áudio: nunca chavear por
  // campo que a IA devolve). Ausente = card usa a locução normal de uma voz só.
  const [dialogos, setDialogos] = useState<Record<number, Dialogo>>({})
  // Estúdio: trilha de fundo única do kit (aplicada em todas as locuções).
  const estudio = useTrilhaFundo()
  const exportRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [generatingAudioFor, setGeneratingAudioFor] = useState<number | null>(null)
  const [convertingIndex, setConvertingIndex] = useState<number | null>(null)
  // Card cujo "Ouvir" está preparando o áudio (baixando/decodificando a cama e mixando).
  const [preparandoPlay, setPreparandoPlay] = useState<number | null>(null)
  // Falha do "Ouvir" em canal PRÓPRIO, pelo mesmo motivo de camaAvisos: quem limpa
  // audioErrors é o "gerar áudio", então um erro de reprodução jogado lá ficaria grudado
  // na tela depois de o cliente conseguir ouvir. Este nasce e morre com a tentativa.
  const [playErros, setPlayErros] = useState<Record<number, string>>({})
  const [rateNotice, setRateNotice] = useState('')

  async function handleGenerateContent() {
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
    setPosts(null)
    setAudioBlobs({})
    setAudioErrors({})
    setCamaAvisos({})
    // Diálogos são de um calendário específico: sem limpar, o card 3 do calendário novo
    // herdaria a conversa do card 3 do anterior (o estado é chaveado por índice).
    setDialogos({})

    try {
      const response = await fetchWithRetry(
        '/api/gemini/generate-content',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nicho, tom, qtdPosts: qtdDias })
        },
        { onWait: (s) => setRateNotice(`⏳ Muita procura agora — tentando de novo em ${s}s...`) },
      )
      setRateNotice('')

      // Checa o erro ANTES de parsear como JSON: numa falha 504/erro de plataforma a Vercel
      // devolve HTML (não-JSON), e aí o safeJson estouraria com a mensagem crua em vez da
      // amigável. Lê o corpo só uma vez em cada ramo (ok x erro são mutuamente exclusivos).
      if (!response.ok) {
        const errData = await response.json().catch(() => null)
        throw new Error(friendlyApiError(response.status, errData?.error))
      }

      const data = await safeJson(response)
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
      console.error('=== ERRO ao gerar conteúdo ===', err)
      // Nada foi entregue: devolve a geração debitada antes da chamada à IA.
      if (trial.isTrial) {
        await devolverGeracaoTrial()
        void refresh()
      }
      setError(err instanceof Error ? err.message : 'Erro ao gerar conteúdo')
    } finally {
      setIsGenerating(false)
    }
  }

  // Chaveado pela posição na lista (index), não por post.dia: a IA às vezes não numera os
  // dias de forma única/sequencial (comum em respostas maiores), e dois posts com o mesmo
  // "dia" passavam a compartilhar o mesmo áudio/estado de botão entre si.
  async function handleGenerateAudio(post: Post, index: number) {
    // Com Modo Diálogo ativo, é a CONVERSA que vira locução (duas vozes numa chamada só,
    // ver src/lib/dialogo.ts) — o roteiro de uma voz fica de lado até o cliente descartar
    // o diálogo. O corpo da chamada é a única diferença; tudo depois daqui é igual.
    const dialogo = dialogos[index] ?? null
    const textoDaVoz = dialogo ? montarTranscricao(dialogo.falas) : `${post.hook} ${post.roteiro}`

    // Roteiro editado a mao pode passar do teto de tempo da sintese. Barrar aqui
    // poupa o cliente de esperar 50s por um erro — mesma orientacao do Editor.
    // Checado ANTES de ligar o spinner: este `return` nao passa pelo `finally` do
    // try abaixo, entao com o estado ja ligado o botao do card ficava girando e
    // desabilitado pra sempre (so voltava depois de outra geracao de audio).
    if (textoLongoDemais(textoDaVoz)) {
      setAudioErrors((prev) => ({ ...prev, [index]: avisoTextoLongo(textoDaVoz) }))
      return
    }

    setGeneratingAudioFor(index)
    setAudioErrors((prev) => ({ ...prev, [index]: '' }))

    try {
      const response = await fetchWithRetry(
        '/api/gemini/text-to-speech',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            dialogo
              ? { text: textoDaVoz, falantes: falantesParaApi(dialogo.vozes) }
              : { text: textoDaVoz, voiceName: post.vozSugerida }
          )
        },
        { onWait: (s) => setRateNotice(`⏳ Muita procura agora — tentando de novo em ${s}s...`) },
      )
      setRateNotice('')

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(friendlyApiError(response.status, data?.error))
      }

      const blob = await response.blob()
      // Estúdio: masteriza a locução (Realce Profissional) já na geração — prévia,
      // download e mixagem com trilha saem todos polidos. Falhou? Voz crua, nunca nada.
      const polida = await realcarVoz(blob)
      setAudioBlobs((prev) => ({ ...prev, [index]: polida }))
    } catch (err) {
      console.error('=== ERRO ao gerar áudio ===', err)
      setAudioErrors((prev) => ({
        ...prev,
        [index]: err instanceof Error ? err.message : 'Erro ao gerar áudio'
      }))
    } finally {
      setGeneratingAudioFor(null)
    }
  }

  function updatePostField(index: number, field: 'hook' | 'roteiro' | 'legenda', value: string) {
    setPosts((prev) =>
      prev ? prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)) : prev
    )
  }

  // Qual cama entra neste card. Com Modo Diálogo e uma cama de conversa marcada, é ELA —
  // nunca a trilha do kit. Se o arquivo ainda não estiver na pasta, sai SEM cama nenhuma e
  // o cliente é avisado: substituir calado a cama de conversa por uma trilha corporativa é
  // exatamente o que a separação em TRILHAS_DIALOGO existe pra impedir.
  async function camaDoCard(index: number): Promise<AudioBuffer | null> {
    // O aviso nasce e morre com a própria tentativa: limpo aqui, reposto só se a cama
    // faltar de novo. Assim ele nunca sobrevive ao cliente desmarcar a cama ou ao MP3
    // aparecer — a tela nunca afirma sobre este áudio algo que deixou de ser verdade.
    const limparAviso = () =>
      setCamaAvisos((prev) => {
        if (!prev[index]) return prev
        const proximo = { ...prev }
        delete proximo[index]
        return proximo
      })

    const id = dialogos[index]?.trilhaId
    if (!id) {
      limparAviso()
      return estudio.trilha.buffer
    }

    const buffer = await carregarTrilhaDialogo(id)
    if (buffer) limparAviso()
    else
      setCamaAvisos((prev) => ({
        ...prev,
        [index]: 'A cama de conversa ainda não está disponível — este áudio saiu só com as vozes.',
      }))
    return buffer
  }

  async function handlePlayAudio(index: number) {
    const blob = audioBlobs[index]
    if (!blob) return
    // Spinner obrigatório: na PRIMEIRA vez com cama de conversa marcada, este clique
    // baixa e decodifica um MP3 de ~2MB antes de tocar. Sem indicador, o cliente ficava
    // alguns segundos olhando um botão que não reagia e clicava de novo. O Baixar e o
    // Publicar já tinham spinner; só o Ouvir não tinha.
    setPreparandoPlay(index)
    setPlayErros((prev) => {
      if (!prev[index]) return prev
      const proximo = { ...prev }
      delete proximo[index]
      return proximo
    })
    // Declarada FORA do try pro catch conseguir revogar o blob: quando play() rejeita por
    // bloqueio do navegador (NotAllowedError) o elemento NÃO dispara 'error', e sem isto o
    // WAV ficava pendurado na memória da aba sem ninguém pra soltar.
    let url = ''
    try {
      // O "Ouvir" toca o resultado FINAL (voz + trilha no volume atual): o que o
      // cliente escuta é exatamente o que vai baixar — sem surpresa no export.
      const final = await aplicarTrilha(blob, await camaDoCard(index), estudio.trilha.volume)
      url = URL.createObjectURL(final)
      const audio = new Audio(url)
      // Libera o blob quando a locução acaba (ou falha). Sem isso, cada clique em Ouvir
      // deixava um WAV de alguns MB preso na memória da aba até recarregar a página —
      // num kit de 60 cards, ouvir tudo uma vez já pesava. Cada clique cria a SUA própria
      // URL e o SEU elemento, então revogar no 'ended' nunca atinge outra reprodução.
      const soltar = () => URL.revokeObjectURL(url)
      audio.addEventListener('ended', soltar, { once: true })
      audio.addEventListener('error', soltar, { once: true })
      await audio.play()
    } catch (err) {
      // O onClick do botão não tem .catch: sem este bloco, a rejeição de play() (gesto do
      // clique já expirado depois do preparo — iOS/Safari — ou formato recusado) ou de
      // aplicarTrilha subia como "unhandled rejection" no console do cliente, e a tela
      // apenas voltava pra "Ouvir" sem tocar nada e sem dizer por quê.
      console.error('=== ERRO ao tocar áudio ===', err)
      if (url) URL.revokeObjectURL(url)
      setPlayErros((prev) => ({
        ...prev,
        [index]: 'Não foi possível tocar o áudio agora. Tente de novo ou use o Baixar.',
      }))
    } finally {
      setPreparandoPlay(null)
    }
  }

  // Baixa como OGG/Opus — único formato que o WhatsApp reconhece como "áudio de voz"
  // (player embutido); WAV chega lá como anexo genérico ("arquivo").
  async function handleDownloadAudio(index: number, dia: number, periodo: string) {
    const blob = audioBlobs[index]
    if (!blob) return
    setConvertingIndex(index)
    setPlayErros((prev) => ({ ...prev, [index]: '' }))
    try {
      const comTrilha = await aplicarTrilha(blob, await camaDoCard(index), estudio.trilha.volume)
      const oggBlob = await convertToWhatsAppOgg(comTrilha, 'wav')
      const url = URL.createObjectURL(oggBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `reel-dia-${dia}-${periodo.toLowerCase()}.ogg`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      // Mesmo motivo do "Ouvir": o onClick não tem .catch, então uma falha do FFmpeg.wasm
      // (memória, codec) ou da mixagem virava unhandled rejection — o spinner sumia, nada
      // baixava e o cliente não recebia explicação nenhuma.
      console.error('=== ERRO ao baixar áudio ===', err)
      setPlayErros((prev) => ({
        ...prev,
        [index]: 'Não consegui preparar o arquivo pra baixar. Tente de novo.',
      }))
    } finally {
      setConvertingIndex(null)
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

  // Slides do carrossel deste card, como Blob PNG + a locução em MP3 — é o material
  // que sobe pro post na NewPost-IA. O Agente não tem upload de imagem por card
  // (isso é do Super Agente), então são sempre 3 slides: hook, roteiro e legenda.
  async function prepararMidiaNewPost(index: number): Promise<{ imagens: Blob[]; audio: Blob | null }> {
    const imagens = await renderSlidesToBlobs(exportRefs.current, index, ['hook', 'roteiro', 'legenda'])

    let audio: Blob | null = null
    const bruto = audioBlobs[index]
    if (bruto) {
      // Mesma cadeia do download (trilha do Estúdio por cima da locução), só que em MP3
      // mono — é o que a NewPost-IA guarda e o que toca em qualquer navegador. O OGG
      // fica reservado pro WhatsApp.
      const comTrilha = await aplicarTrilha(bruto, await camaDoCard(index), estudio.trilha.volume)
      const { blob } = await convertVoiceToMp3(comTrilha)
      audio = blob
    }
    return { imagens, audio }
  }

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
            O Agente de Conteúdo IA está disponível apenas nos planos <span className="text-[#8B5CF6] font-bold">Crescimento</span> e <span className="text-[#22C55E] font-bold">Dominação</span>.
          </p>
          {canStartTrial && <AtivarTrial onAtivar={startTrial} className="mb-4" />}
          <Button
            className="bg-[#8B5CF6] hover:bg-[#7C3AED]"
            onClick={() => (window.location.href = '/precos')}
          >
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
            <Sparkles className="w-8 h-8 text-[#8B5CF6]" />
            Agente de Conteúdo IA
          </h1>
          <p className="text-gray-400">Gere o mês inteiro de roteiros e áudios (locuções) com IA em segundos. Legenda e narração prontas — é só gravar por cima.</p>
          <p className="text-sm text-gray-500 mt-1">Você só precisa gravar 15s lendo o roteiro. Sem editar. Sem Canva. O áudio já vem pronto para WhatsApp.</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <span className="text-red-300">{error}</span>
          </div>
        )}

        {rateNotice && (
          <div className="mb-6 p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-xl flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-yellow-400 shrink-0 animate-spin" />
            <span className="text-yellow-300">{rateNotice}</span>
          </div>
        )}

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
                {TONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.value} [{t.dica}]</option>
                ))}
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
              <p className="text-xs text-gray-600 mt-1">Cada dia gera 2 posts: Manhã + Tarde. A IA já sugere o melhor horário pra postar de cada um.</p>
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

          <Button
            onClick={handleGenerateContent}
            disabled={isGenerating || !nicho.trim()}
            className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-lg py-6 font-bold"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Gerando Conteúdo do Mês...
              </>
            ) : (
              'Criar Conteúdo do Mês 🤖'
            )}
          </Button>
        </div>

        {posts && (
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <p className="text-sm text-gray-400">
              Calendário de {posts.length} posts, a partir de {new Date(`${dataInicio}T00:00:00`).toLocaleDateString('pt-BR')}.
            </p>
            <Button
              onClick={handleExportGoogleAgenda}
              className="bg-[#22C55E] hover:bg-[#16A34A] flex items-center gap-2"
            >
              <CalendarDays className="w-4 h-4" />
              Exportar para Google Agenda
            </Button>
          </div>
        )}

        {posts && <TrilhaFundoPanel estudio={estudio} />}

        {posts && (
          <Fragment>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {posts.map((post, index) => (
              <div key={index} className="bg-[#111111] border border-gray-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[#8B5CF6] font-bold">Dia {post.dia} · {post.periodo}</span>
                  <span className="text-xs px-2 py-1 rounded-full bg-[#1A1A1A] border border-gray-700 text-gray-400">
                    Voz: {post.vozSugerida}
                  </span>
                </div>
                {post.horario && (
                  <span className="inline-block text-xs px-2 py-1 rounded-full bg-gray-700/50 text-gray-300">
                    📅 Melhor horário: {post.horario}
                  </span>
                )}
                <div className="flex items-start gap-1">
                  <div className="flex-1 min-w-0">
                    <EditableText
                      label="Hook (3s)"
                      value={post.hook}
                      onChange={(v) => updatePostField(index, 'hook', v)}
                      displayClassName="text-white font-medium"
                    />
                  </div>
                  <HumanizarButton texto={post.hook} campo="hook" onHumanizado={(v) => updatePostField(index, 'hook', v)} />
                </div>
                <div className="flex items-start gap-1">
                  <div className="flex-1 min-w-0">
                    <EditableText
                      label="Roteiro (20s)"
                      value={post.roteiro}
                      onChange={(v) => updatePostField(index, 'roteiro', v)}
                    />
                  </div>
                  <HumanizarButton texto={post.roteiro} campo="roteiro" onHumanizado={(v) => updatePostField(index, 'roteiro', v)} />
                </div>
                <div className="flex items-start gap-1">
                  <div className="flex-1 min-w-0">
                    <EditableText
                      label="Legenda"
                      value={post.legenda}
                      onChange={(v) => updatePostField(index, 'legenda', v)}
                    />
                  </div>
                  <HumanizarButton texto={post.legenda} campo="legenda" onHumanizado={(v) => updatePostField(index, 'legenda', v)} />
                </div>
                <FeedPreview texto={post.legenda} />
                <CtaObjetivo
                  legenda={post.legenda}
                  tom={tom}
                  hook={post.hook}
                  onAplicar={(v) => updatePostField(index, 'legenda', v)}
                />
                <span className="inline-block text-xs px-2 py-1 rounded-full bg-gray-700/50 text-gray-300">
                  {post.periodo === 'Manhã' ? '🎯 Objetivo: Relacionamento' : '💰 Objetivo: Conversão/Venda'}
                </span>

                {/* Modo Diálogo: enquanto houver conversa montada aqui, é ELA que vira
                    locução — por isso o botão de áudio abaixo muda de rótulo. */}
                <ModoDialogo
                  hook={post.hook}
                  roteiro={post.roteiro}
                  nicho={nicho}
                  tom={tom}
                  dialogo={dialogos[index] ?? null}
                  onChange={(d) =>
                    setDialogos((prev) => {
                      const proximo = { ...prev }
                      if (d) proximo[index] = d
                      else delete proximo[index]
                      return proximo
                    })
                  }
                />

                {audioErrors[index] && (
                  <p className="text-red-400 text-xs">{audioErrors[index]}</p>
                )}

                {/* Amarelo, não vermelho: a locução saiu inteira, só veio sem a cama. */}
                {camaAvisos[index] && (
                  <p className="text-yellow-500 text-xs">{camaAvisos[index]}</p>
                )}

                {playErros[index] && (
                  <p className="text-red-400 text-xs">{playErros[index]}</p>
                )}

                {audioBlobs[index] ? (
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handlePlayAudio(index)}
                      disabled={preparandoPlay === index}
                      className="flex-1 bg-[#1A1A1A] hover:bg-[#252525] disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {preparandoPlay === index ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                      {preparandoPlay === index ? 'Preparando…' : 'Ouvir'}
                    </Button>
                    <Button
                      onClick={() => handleDownloadAudio(index, post.dia, post.periodo)}
                      disabled={convertingIndex === index}
                      className="flex-1 bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {convertingIndex === index ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                      Baixar
                    </Button>
                    {/* Refaz a locução por cima (ex.: cliente editou o roteiro). Voz não
                        consome geração do trial, então regerar é livre. */}
                    <Button
                      onClick={() => handleGenerateAudio(post, index)}
                      disabled={generatingAudioFor === index}
                      title="Gerar a locução de novo (ex.: depois de editar o roteiro)"
                      className="bg-[#1A1A1A] hover:bg-[#252525] disabled:opacity-50 flex items-center justify-center gap-2 px-3"
                    >
                      {generatingAudioFor === index ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                      Refazer
                    </Button>
                  </div>
                ) : (
                  <Button
                    onClick={() => handleGenerateAudio(post, index)}
                    disabled={generatingAudioFor === index}
                    className="w-full bg-[#22C55E] hover:bg-[#16A34A] disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {generatingAudioFor === index ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Gerando Áudio...
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-4 h-4" />
                        {dialogos[index] ? 'Gerar Áudio do Diálogo (2 vozes)' : 'Gerar Áudio com 1 Clique'}
                      </>
                    )}
                  </Button>
                )}

                {/* NewPost-IA é a rede do próprio Mestre: aqui a publicação é de verdade
                    (texto + cards + locução), não "copia e cola" como nas outras. É a
                    única que aceita áudio no post — ver src/lib/newpost.ts. */}
                <PublicarNewPost
                  texto={`${post.hook}\n\n${post.legenda}`}
                  marca={nicho.trim() || 'Minha marca'}
                  chaveUnica={`voiceflow-agente-${dataInicio}-dia${post.dia}-${post.periodo}-${index}`}
                  prepararMidia={() => prepararMidiaNewPost(index)}
                />
              </div>
            ))}
          </div>

          {/* Slides ocultos que viram os PNGs do carrossel ao publicar. Ficam FORA do
              .grid de propósito: elemento oculto dentro da grade entra no auto-placement
              do CSS Grid e empurra os cards visíveis — bug que já quebrou este layout. */}
          {posts.map((post, index) => (
            <Fragment key={index}>
              {(['hook', 'roteiro', 'legenda'] as const).map((slide) => (
                <ExportSlide
                  key={slide}
                  innerRef={(el) => { exportRefs.current[slideRefKey(index, slide)] = el }}
                  brandLogo={null}
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
                </ExportSlide>
              ))}
            </Fragment>
          ))}
          </Fragment>
        )}
      </div>
    </div>
  )
}
