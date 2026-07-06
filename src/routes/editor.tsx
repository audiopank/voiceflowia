import { useState, useEffect } from 'react'
import { createFileRoute } from "@tanstack/react-router"
import { Lock, Download, Volume2, Loader2, AlertCircle } from 'lucide-react'
import { useSubscription } from '../lib/useSubscription'
import { Button } from '../components/ui/button'
import { BackButton } from '../components/BackButton'

export const Route = createFileRoute("/editor")({
  component: Editor,
})

interface Voice {
  voice_id: string
  name: string
}

type Provider = 'elevenlabs' | 'gemini'

// IDs conferidos contra GET /v1/voices desta conta — os IDs "clássicos" dos
// exemplos da ElevenLabs (Rachel, Domi, Bella...) são vozes de biblioteca e
// retornam 402 (payment_required) em contas free via API.
const ELEVENLABS_VOICES: Voice[] = [
  { voice_id: 'HOfBIVLhom4mc9WvXfyH', name: 'Andrea Lot - Feminino (PT-BR)' },
  { voice_id: '4za2kOXGgUd57HRSQ1fn', name: 'Lendário - Masculino (PT-BR)' },
  { voice_id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger - Masculino (Americano)' },
  { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah - Feminino (Americano)' },
  { voice_id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura - Feminino (Americano)' },
  { voice_id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie - Masculino (Australiano)' },
  { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George - Masculino (Britânico)' },
  { voice_id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice - Feminino (Britânico)' },
  { voice_id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda - Feminino (Americano)' },
  { voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel - Masculino (Britânico)' },
  { voice_id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily - Feminino (Britânico)' },
  { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam - Masculino (Americano)' }
]

const GEMINI_VOICES: Voice[] = [
  { voice_id: 'Zephyr', name: 'Zephyr' },
  { voice_id: 'Puck', name: 'Puck' },
  { voice_id: 'Charon', name: 'Charon' },
  { voice_id: 'Kore', name: 'Kore' },
  { voice_id: 'Fenrir', name: 'Fenrir' },
  { voice_id: 'Leda', name: 'Leda' },
  { voice_id: 'Orus', name: 'Orus' },
  { voice_id: 'Aoede', name: 'Aoede' }
]

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
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [loadingVoices, setLoadingVoices] = useState(true)


  // Carregar vozes do provedor selecionado
  useEffect(() => {
    if (!hasAccess) return

    setLoadingVoices(true)
    const providerVoices = provider === 'elevenlabs' ? ELEVENLABS_VOICES : GEMINI_VOICES
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

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

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

  function handleDownload() {
    if (!audioBlob) return
    const extension = provider === 'elevenlabs' ? 'mp3' : 'wav'
    const url = URL.createObjectURL(audioBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `voiceflow-ia-voiceover.${extension}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
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
                    className="flex-1 bg-[#8B5CF6] hover:bg-[#7C3AED] text-lg py-4 font-bold flex items-center justify-center gap-2"
                  >
                    <Download className="w-5 h-5" />
                    Baixar {provider === 'elevenlabs' ? 'MP3' : 'WAV'}
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
