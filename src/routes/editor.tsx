import { useState, useEffect, useRef } from 'react'
import { createFileRoute } from "@tanstack/react-router"
import { Lock, Download, Volume2, Loader2, AlertCircle, Music, Mic, Upload, Play, Square, Sparkles, ArrowDown } from 'lucide-react'
import { useSubscription } from '../lib/useSubscription'
import { fetchWithRetry } from '../lib/apiRetry'
import { Button } from '../components/ui/button'
import { BackButton } from '../components/BackButton'
import { ELEVENLABS_VOICES, GEMINI_VOICES_TEXTO_LONGO, type Voice, type Provider } from '../lib/voices'
import { convertToWhatsAppOgg, convertMixToMp3 } from '../lib/audioConvert'
import { blobToAudioBuffer, renderMix, audioBufferToWav, enhanceVoiceBuffer } from '../lib/audioMix'

export const Route = createFileRoute("/editor")({
  component: Editor,
})

// Trilhas prontas ("camas" instrumentais royalty-free) servidas de public/trilhas/*.mp3.
// O cliente clica e a trilha entra direto no mixer, sem precisar ter música própria — é o
// que tira o atrito "cadê a música?" na hora de sonorizar. Os arquivos ficam em public/ pra
// serem servidos same-origin pela Vercel (sem CORS pro Web Audio decodificar).
const PRESET_TRACKS = [
  { id: 'corporativa', label: 'Corporativa', emoji: '💼', file: 'corporativa.mp3' },
  { id: 'business', label: 'Business', emoji: '🏢', file: 'business.mp3' },
  { id: 'global', label: 'Global', emoji: '🌎', file: 'global.mp3' },
  { id: 'pop', label: 'Pop', emoji: '🎵', file: 'pop.mp3' },
] as const

function Editor() {
  const { hasAccess, loading: loadingSubscription } = useSubscription()
  const [text, setText] = useState('Olá, isso é um teste de voz.')
  // Padrao Gemini: as vozes da ElevenLabs sao de biblioteca e retornam 402
  // (paid_plan_required) em contas free. Gemini (Zephyr/Puck/...) funciona no free.
  const [provider, setProvider] = useState<Provider>('gemini')
  const [voices, setVoices] = useState<Voice[]>([])
  const [selectedVoice, setSelectedVoice] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [audioReady, setAudioReady] = useState(false)
  const [error, setError] = useState('')
  const [rateNotice, setRateNotice] = useState('')
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null) // locução crua da API
  const [enhancedBlob, setEnhancedBlob] = useState<Blob | null>(null) // locução com realce (WAV)
  const [enhanceOn, setEnhanceOn] = useState(true) // Realce Profissional ligado por padrão
  const [loadingVoices, setLoadingVoices] = useState(true)
  const [isConverting, setIsConverting] = useState(false)

  // --- Estúdio de Mixagem (mini-mixer): trilha de fundo + volumes independentes ---
  const [trackBlob, setTrackBlob] = useState<Blob | null>(null)
  const [trackName, setTrackName] = useState('')
  const [voiceVol, setVoiceVol] = useState(100) // % (100 = som original da locução)
  const [trackVol, setTrackVol] = useState(25) // % (trilha entra como cama, baixinha)
  const [isMixing, setIsMixing] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [mixError, setMixError] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [loadingPreset, setLoadingPreset] = useState<string | null>(null)
  const previewRef = useRef<HTMLAudioElement | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const mixerRef = useRef<HTMLDivElement | null>(null)


  // Carregar vozes do provedor selecionado.
  // Gemini: só o trio rápido (Zephyr/Puck/Kore) — as outras 5 vozes do catálogo são bem
  // mais lentas pra sintetizar e, com o texto livre/longo daqui, passavam até do limite de
  // execução e voltavam como "Erro na API: 504" (bug real reportado por cliente).
  useEffect(() => {
    if (!hasAccess) return

    setLoadingVoices(true)
    const providerVoices = provider === 'elevenlabs' ? ELEVENLABS_VOICES : GEMINI_VOICES_TEXTO_LONGO
    setVoices(providerVoices)
    setSelectedVoice(providerVoices[0].voice_id)
    setLoadingVoices(false)
  }, [hasAccess, provider])

  // Para qualquer prévia da mixagem em andamento ao desmontar a tela.
  useEffect(() => {
    return () => stopPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleGenerateVoice() {
    console.log(`=== Iniciando geração de voz (${provider}) ===`)

    stopPreview()
    setIsGenerating(true)
    setAudioReady(false)
    setError('')
    setMixError('')
    setAudioBlob(null)
    setEnhancedBlob(null)

    try {
      const endpoint =
        provider === 'elevenlabs'
          ? '/api/elevenlabs/text-to-speech'
          : '/api/gemini/text-to-speech'

      const body =
        provider === 'elevenlabs'
          ? { text, voiceId: selectedVoice }
          : { text, voiceName: selectedVoice }

      const response = await fetchWithRetry(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        },
        { onWait: (s) => setRateNotice(`⏳ Limite temporário da API. Aguardando ${s}s e tentando de novo...`) },
      )
      setRateNotice('')

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error(`Erro ${provider}:`, response.status, errorData)
        throw new Error(errorData?.error || `Erro na API: ${response.status}`)
      }

      const blob = await response.blob()
      setAudioBlob(blob)

      // Realce Profissional: masteriza a locução crua (trim + EQ + compressor + reverb) já
      // aqui, pra que prévia, OGG do WhatsApp e mixagem saiam todos polidos. Se falhar por
      // qualquer motivo, seguimos com a voz crua (enhancedBlob fica null) — nunca trava.
      try {
        const rawBuffer = await blobToAudioBuffer(blob)
        const enhanced = await enhanceVoiceBuffer(rawBuffer)
        setEnhancedBlob(audioBufferToWav(enhanced))
      } catch (enhanceErr) {
        console.error('Realce de voz falhou, usando áudio cru:', enhanceErr)
        setEnhancedBlob(null)
      }

      setAudioReady(true)
      console.log(`Áudio ${provider} pronto!`)
    } catch (err) {
      console.error('=== ERRO ===', err)
      setError(err instanceof Error ? err.message : 'Erro ao gerar áudio')
    } finally {
      setIsGenerating(false)
    }
  }

  // A voz "efetiva" que vai pra prévia/OGG/mixagem: com Realce ligado (e disponível), usa a
  // versão masterizada (WAV); senão, a locução crua da API.
  const usingEnhanced = enhanceOn && enhancedBlob !== null
  const effectiveVoiceBlob = usingEnhanced ? enhancedBlob : audioBlob
  // Extensão do container pra conversão: o realce sempre sai em WAV; a crua depende do provedor.
  const effectiveVoiceExt = usingEnhanced ? 'wav' : provider === 'elevenlabs' ? 'mp3' : 'wav'

  // Baixa como OGG/Opus — é o único formato que o WhatsApp reconhece como "áudio de voz"
  // (player embutido); MP3/WAV chegam lá como anexo genérico ("arquivo").
  async function handleDownload() {
    if (!effectiveVoiceBlob) return
    setIsConverting(true)
    try {
      const oggBlob = await convertToWhatsAppOgg(effectiveVoiceBlob, effectiveVoiceExt)
      const url = URL.createObjectURL(oggBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'voiceflow-ia-voiceover.ogg'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setIsConverting(false)
    }
  }

  function handlePlayPreview() {
    if (!effectiveVoiceBlob) return
    const url = URL.createObjectURL(effectiveVoiceBlob)
    const audio = new Audio(url)
    audio.play()
  }

  // --- Estúdio de Mixagem ---

  function handleTrackUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    stopPreview()
    setMixError('')
    setSelectedPresetId(null) // subiu a própria música: desmarca a trilha pronta
    setTrackBlob(file)
    setTrackName(file.name)
  }

  // Carrega uma trilha pronta de public/trilhas/ e joga direto no mixer.
  async function handlePresetTrack(preset: (typeof PRESET_TRACKS)[number]) {
    stopPreview()
    setMixError('')
    setLoadingPreset(preset.id)
    try {
      const res = await fetch(`/trilhas/${preset.file}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      // Em SPA/host com fallback pra index.html, um arquivo faltando volta como HTML 200 —
      // o check de tipo evita "carregar" um HTML achando que é áudio.
      if (!blob.type.startsWith('audio')) throw new Error('não é áudio')
      setTrackBlob(blob)
      setTrackName(`${preset.emoji} ${preset.label}`)
      setSelectedPresetId(preset.id)
    } catch (err) {
      console.error('Falha ao carregar trilha pronta:', err)
      setSelectedPresetId(null)
      setMixError('Essa trilha ainda não está disponível. Você pode subir a sua própria música.')
    } finally {
      setLoadingPreset(null)
    }
  }

  function stopPreview() {
    if (previewRef.current) {
      previewRef.current.pause()
      previewRef.current = null
    }
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    setIsPreviewing(false)
  }

  // Renderiza a mixagem atual (voz + trilha, com os volumes escolhidos) num WAV.
  // Usado tanto pela prévia quanto pelo download.
  async function buildMix(): Promise<Blob> {
    const voiceBuffer = await blobToAudioBuffer(effectiveVoiceBlob!)
    const trackBuffer = trackBlob ? await blobToAudioBuffer(trackBlob) : null
    const mixed = await renderMix(voiceBuffer, trackBuffer, voiceVol / 100, trackVol / 100)
    return audioBufferToWav(mixed)
  }

  async function handlePreviewMix() {
    if (isPreviewing) {
      stopPreview()
      return
    }
    if (!audioBlob) return
    setMixError('')
    setIsMixing(true)
    try {
      const wav = await buildMix()
      const url = URL.createObjectURL(wav)
      const audio = new Audio(url)
      audio.onended = stopPreview
      previewRef.current = audio
      previewUrlRef.current = url
      await audio.play()
      setIsPreviewing(true)
    } catch (err) {
      console.error('Erro na prévia da mixagem:', err)
      setMixError('Não consegui montar a prévia. A trilha pode estar num formato que o navegador não lê — tente MP3 ou WAV.')
    } finally {
      setIsMixing(false)
    }
  }

  async function handleDownloadMix() {
    if (!audioBlob) return
    stopPreview()
    setMixError('')
    setIsMixing(true)
    try {
      const wav = await buildMix()
      const { blob, ext } = await convertMixToMp3(wav)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `voiceflow-ia-mixagem.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Erro ao baixar a mixagem:', err)
      setMixError('Não consegui gerar a mixagem. A trilha pode estar num formato que o navegador não lê — tente MP3 ou WAV.')
    } finally {
      setIsMixing(false)
    }
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
            O Editor de Voz está disponível apenas nos planos <span className="text-[#8B5CF6] font-bold">Crescimento</span> e <span className="text-[#22C55E] font-bold">Dominação</span>.
          </p>
          <Button 
            className="bg-[#8B5CF6] hover:bg-[#7C3AED]"
            onClick={() => window.location.href = '/precos'}
          >
            Ver Planos
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] p-6">
      <div className="max-w-3xl mx-auto">
        <BackButton to="/dashboard" label="Voltar ao Painel" className="mb-6" />
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-2">
            <Volume2 className="w-8 h-8 text-[#8B5CF6]" />
            Editor de Voz
          </h1>
          <p className="text-gray-400">Crie voiceovers profissionais com vozes humanas realistas!</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <span className="text-red-300">{error}</span>
          </div>
        )}

        {rateNotice && (
          <div className="mb-6 p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-400 shrink-0 animate-pulse" />
            <span className="text-yellow-300">{rateNotice}</span>
          </div>
        )}

        <div className="bg-[#111111] border border-gray-800 rounded-2xl p-6 space-y-6">
          {/* Provedor de Voz */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Provedor
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setProvider('gemini')
                  setAudioReady(false)
                }}
                className={`p-3 rounded-lg border text-sm font-bold transition-colors ${
                  provider === 'gemini'
                    ? 'bg-[#8B5CF6] border-[#8B5CF6] text-white'
                    : 'bg-[#1A1A1A] border-gray-700 text-gray-300 hover:border-gray-500'
                }`}
              >
                Gemini
              </button>
              {/* ElevenLabs desabilitado: as vozes disponiveis sao de biblioteca e
                  exigem plano pago (402). Reabilitar quando houver assinatura. */}
              <button
                type="button"
                disabled
                title="Requer plano pago da ElevenLabs"
                className="p-3 rounded-lg border text-sm font-bold bg-[#1A1A1A] border-gray-800 text-gray-600 cursor-not-allowed"
              >
                ElevenLabs
                <span className="block text-[10px] font-normal text-gray-500">
                  requer plano pago
                </span>
              </button>
            </div>
          </div>

          {/* Caixa de Texto */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Seu Texto
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full h-48 p-4 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#8B5CF6] resize-none"
              placeholder="Digite ou cole o texto que você quer converter em voz..."
            />
          </div>

          {/* Dropdown de Vozes */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Escolha a Voz
            </label>
            <select
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
              disabled={loadingVoices}
              className="w-full p-3 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#8B5CF6]"
            >
              {loadingVoices ? (
                <option value="">Carregando vozes...</option>
              ) : (
                voices.map((voice) => (
                  <option key={voice.voice_id} value={voice.voice_id}>
                    {voice.name}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Botões */}
          <div className="flex flex-col gap-4">
            {!audioReady ? (
              <Button
                onClick={handleGenerateVoice}
                disabled={isGenerating || !text.trim() || loadingVoices}
                className="w-full bg-[#22C55E] hover:bg-[#16A34A] disabled:opacity-50 text-lg py-6 font-bold"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Gerando Voz...
                  </>
                ) : (
                  'Gerar Voz'
                )}
              </Button>
            ) : (
              <>
                <div className="flex gap-4">
                  <Button
                    onClick={handleDownload}
                    disabled={isConverting}
                    className="flex-1 bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-lg py-4 font-bold flex items-center justify-center gap-2"
                  >
                    {isConverting ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Convertendo pra WhatsApp...
                      </>
                    ) : (
                      <>
                        <Download className="w-5 h-5" />
                        Baixar OGG (WhatsApp)
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={handlePlayPreview}
                    className="flex-1 bg-[#1A1A1A] hover:bg-[#252525] text-lg py-4 font-bold flex items-center justify-center gap-2"
                  >
                    <Volume2 className="w-5 h-5" />
                    Ouvir Prévia
                  </Button>
                </div>

                {/* CTA de sonorização: puxa o olho do cliente pro mixer logo abaixo. */}
                <button
                  type="button"
                  onClick={() => mixerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="w-full flex items-center justify-center gap-2 p-3 rounded-lg bg-gradient-to-r from-[#8B5CF6]/20 to-[#22C55E]/20 border border-[#8B5CF6]/40 hover:border-[#8B5CF6] transition-colors text-sm font-bold text-white"
                >
                  <Sparkles className="w-4 h-4 text-[#8B5CF6]" />
                  Quer sonorizar seu áudio? Escolha uma trilha
                  <ArrowDown className="w-4 h-4 text-[#22C55E]" />
                </button>

                {/* Realce Profissional da Voz (masterização: trim + EQ + compressor + reverb) */}
                <button
                  type="button"
                  onClick={() => {
                    stopPreview()
                    setEnhanceOn((v) => !v)
                  }}
                  className={`w-full flex items-center justify-between gap-3 p-3 rounded-lg border transition-colors ${
                    enhanceOn
                      ? 'bg-[#8B5CF6]/10 border-[#8B5CF6]/60'
                      : 'bg-[#1A1A1A] border-gray-700 hover:border-gray-500'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-left">
                    <Sparkles className={`w-4 h-4 shrink-0 ${enhanceOn ? 'text-[#8B5CF6]' : 'text-gray-500'}`} />
                    <span className={enhanceOn ? 'text-white' : 'text-gray-400'}>
                      Realce Profissional da Voz
                      <span className="block text-[11px] font-normal text-gray-500">
                        Brilho de estúdio: equaliza, comprime e dá corpo à locução
                      </span>
                    </span>
                  </span>
                  {/* Switch visual */}
                  <span
                    className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${
                      enhanceOn ? 'bg-[#8B5CF6]' : 'bg-gray-600'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                        enhanceOn ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </span>
                </button>

                {/* ===== Estúdio de Mixagem (mini-mixer) ===== */}
                <div ref={mixerRef} className="mt-2 pt-6 border-t border-gray-800 space-y-5 scroll-mt-6">
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <Music className="w-5 h-5 text-[#8B5CF6]" />
                      Estúdio de Mixagem
                    </h3>
                    <p className="text-sm text-gray-400">
                      Suba uma trilha de fundo, ajuste os volumes e baixe a locução já sonorizada — pronta pra rádio e streaming.
                    </p>
                  </div>

                  {mixError && (
                    <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                      <span className="text-sm text-red-300">{mixError}</span>
                    </div>
                  )}

                  {/* Trilhas prontas: 1 clique carrega a cama no mixer */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Trilhas prontas <span className="text-gray-500 font-normal">— clique pra usar</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {PRESET_TRACKS.map((preset) => {
                        const active = selectedPresetId === preset.id
                        const loading = loadingPreset === preset.id
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => handlePresetTrack(preset)}
                            disabled={loading}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-full border text-sm font-medium transition-colors disabled:opacity-60 ${
                              active
                                ? 'bg-[#8B5CF6] border-[#8B5CF6] text-white'
                                : 'bg-[#1A1A1A] border-gray-700 text-gray-300 hover:border-[#8B5CF6]'
                            }`}
                          >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>{preset.emoji}</span>}
                            {preset.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Ou subir a própria trilha */}
                  <label className="flex items-center gap-3 p-4 bg-[#1A1A1A] border border-dashed border-gray-700 rounded-lg cursor-pointer hover:border-[#8B5CF6] transition-colors">
                    <Upload className="w-5 h-5 text-gray-400 shrink-0" />
                    <span className="text-sm text-gray-300 truncate">
                      {trackName || 'Ou suba a sua própria música (MP3, WAV, M4A)'}
                    </span>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={handleTrackUpload}
                      className="hidden"
                    />
                  </label>

                  {/* Fader da Voz */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
                        <Mic className="w-4 h-4 text-[#22C55E]" />
                        Volume da Voz
                      </label>
                      <span className="text-sm text-gray-400 tabular-nums">{voiceVol}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={150}
                      value={voiceVol}
                      onChange={(e) => setVoiceVol(Number(e.target.value))}
                      className="w-full accent-[#22C55E]"
                    />
                  </div>

                  {/* Fader da Trilha */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
                        <Music className="w-4 h-4 text-[#8B5CF6]" />
                        Volume da Trilha
                      </label>
                      <span className="text-sm text-gray-400 tabular-nums">{trackVol}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={trackVol}
                      onChange={(e) => setTrackVol(Number(e.target.value))}
                      disabled={!trackBlob}
                      className="w-full accent-[#8B5CF6] disabled:opacity-40"
                    />
                  </div>

                  {/* Ações da mixagem */}
                  <div className="flex gap-4">
                    <Button
                      onClick={handlePreviewMix}
                      disabled={isMixing}
                      className="flex-1 bg-[#1A1A1A] hover:bg-[#252525] py-4 font-bold flex items-center justify-center gap-2"
                    >
                      {isMixing && !isPreviewing ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : isPreviewing ? (
                        <>
                          <Square className="w-5 h-5" />
                          Parar
                        </>
                      ) : (
                        <>
                          <Play className="w-5 h-5" />
                          Ouvir Mixagem
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={handleDownloadMix}
                      disabled={isMixing}
                      className="flex-1 bg-[#22C55E] hover:bg-[#16A34A] disabled:opacity-50 py-4 font-bold flex items-center justify-center gap-2"
                    >
                      {isMixing && !isPreviewing ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Mixando...
                        </>
                      ) : (
                        <>
                          <Download className="w-5 h-5" />
                          Baixar Mixagem (MP3)
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                <Button
                  onClick={() => {
                    stopPreview()
                    setAudioReady(false)
                  }}
                  variant="secondary"
                  className="w-full bg-[#1A1A1A] hover:bg-[#252525] text-gray-300"
                >
                  Criar Novo Voiceover
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
