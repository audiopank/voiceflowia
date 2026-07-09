import { useState, useEffect } from 'react'
import { createFileRoute } from "@tanstack/react-router"
import { Lock, Download, Volume2, Loader2, AlertCircle } from 'lucide-react'
import { useSubscription } from '../lib/useSubscription'
import { fetchWithRetry } from '../lib/apiRetry'
import { Button } from '../components/ui/button'
import { BackButton } from '../components/BackButton'
import { ELEVENLABS_VOICES, GEMINI_VOICES_TEXTO_LONGO, type Voice, type Provider } from '../lib/voices'
import { convertToWhatsAppOgg } from '../lib/audioConvert'

export const Route = createFileRoute("/editor")({
  component: Editor,
})

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
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [loadingVoices, setLoadingVoices] = useState(true)
  const [isConverting, setIsConverting] = useState(false)


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

  async function handleGenerateVoice() {
    console.log(`=== Iniciando geração de voz (${provider}) ===`)

    setIsGenerating(true)
    setAudioReady(false)
    setError('')
    setAudioBlob(null)

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
      setAudioReady(true)
      console.log(`Áudio ${provider} pronto!`)
    } catch (err) {
      console.error('=== ERRO ===', err)
      setError(err instanceof Error ? err.message : 'Erro ao gerar áudio')
    } finally {
      setIsGenerating(false)
    }
  }

  // Baixa como OGG/Opus — é o único formato que o WhatsApp reconhece como "áudio de voz"
  // (player embutido); MP3/WAV chegam lá como anexo genérico ("arquivo").
  async function handleDownload() {
    if (!audioBlob) return
    setIsConverting(true)
    try {
      const originalExt = provider === 'elevenlabs' ? 'mp3' : 'wav'
      const oggBlob = await convertToWhatsAppOgg(audioBlob, originalExt)
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
    if (!audioBlob) return
    const url = URL.createObjectURL(audioBlob)
    const audio = new Audio(url)
    audio.play()
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
                <Button
                  onClick={() => setAudioReady(false)}
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
