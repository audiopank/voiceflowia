import { useState, useEffect, useRef, useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Lock, Loader2, Volume2, Play, Pause, Heart, AlertCircle, Sparkles, Crown } from 'lucide-react'
import { useSubscription } from '../lib/useSubscription'
import { supabase } from '../lib/supabase'
import { fetchWithRetry, friendlyApiError } from '../lib/apiRetry'
import { Button } from '../components/ui/button'
import { BackButton } from '../components/BackButton'
import { ALL_VOICES, GEMINI_VOICES, ELEVENLABS_VOICES, type CatalogVoice } from '../lib/voices'

export const Route = createFileRoute('/biblioteca')({
  component: Biblioteca,
})

const DEFAULT_SAMPLE = 'Olá! Esta é uma amostra da minha voz para o seu projeto.'
const FAV_KEY_PREFIX = 'vfia:voz-favoritas'

function Biblioteca() {
  const { hasAccess, loading: loadingSubscription } = useSubscription()

  const [sampleText, setSampleText] = useState(DEFAULT_SAMPLE)
  const [favorites, setFavorites] = useState<string[]>([])
  const [favKey, setFavKey] = useState<string | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [rateNotice, setRateNotice] = useState('')

  // Cache de prévias já geradas (voice_id -> objectURL) p/ não repetir chamada à API.
  // A chave inclui o texto de amostra: se o texto muda, gera de novo.
  const cacheRef = useRef<Record<string, string>>({})
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Carrega favoritas do localStorage (por usuário) na montagem.
  useEffect(() => {
    let active = true
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      const key = `${FAV_KEY_PREFIX}:${user?.id ?? 'anon'}`
      if (!active) return
      setFavKey(key)
      try {
        const raw = localStorage.getItem(key)
        if (raw) setFavorites(JSON.parse(raw))
      } catch {
        // localStorage indisponível/JSON inválido — ignora.
      }
    })()
    return () => { active = false }
  }, [])

  // Prepara o elemento de áudio uma vez e limpa os objectURLs ao sair.
  useEffect(() => {
    const audio = new Audio()
    audioRef.current = audio
    const onEnded = () => setPlayingId(null)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('ended', onEnded)
      audio.pause()
      Object.values(cacheRef.current).forEach((url) => URL.revokeObjectURL(url))
      cacheRef.current = {}
    }
  }, [])

  // Se o texto de amostra muda, invalida o cache (as prévias eram do texto antigo).
  useEffect(() => {
    Object.values(cacheRef.current).forEach((url) => URL.revokeObjectURL(url))
    cacheRef.current = {}
  }, [sampleText])

  function persistFavorites(next: string[]) {
    setFavorites(next)
    if (favKey) {
      try { localStorage.setItem(favKey, JSON.stringify(next)) } catch { /* ignora */ }
    }
  }

  function toggleFavorite(voiceId: string) {
    persistFavorites(
      favorites.includes(voiceId)
        ? favorites.filter((id) => id !== voiceId)
        : [...favorites, voiceId],
    )
  }

  const play = useCallback(async (voice: CatalogVoice) => {
    const audio = audioRef.current
    if (!audio || voice.premium) return

    // Clicar na voz que já toca = pausar.
    if (playingId === voice.voice_id) {
      audio.pause()
      setPlayingId(null)
      return
    }

    audio.pause()
    setError('')

    // Já temos a prévia em cache: toca na hora.
    const cached = cacheRef.current[voice.voice_id]
    if (cached) {
      audio.src = cached
      audio.play().catch(() => {})
      setPlayingId(voice.voice_id)
      return
    }

    // Gera a prévia via TTS (mesmo endpoint do Editor).
    setLoadingId(voice.voice_id)
    try {
      const response = await fetchWithRetry(
        '/api/gemini/text-to-speech',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: sampleText.trim() || DEFAULT_SAMPLE, voiceName: voice.voice_id }),
        },
        { onWait: (s) => setRateNotice(`⏳ Muita procura agora — tentando de novo em ${s}s...`) },
      )
      setRateNotice('')

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(friendlyApiError(response.status, data?.error))
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      cacheRef.current[voice.voice_id] = url
      audio.src = url
      audio.play().catch(() => {})
      setPlayingId(voice.voice_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao gerar a prévia da voz')
    } finally {
      setLoadingId(null)
    }
  }, [playingId, sampleText])

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
            A Biblioteca de Vozes está disponível apenas nos planos <span className="text-[#8B5CF6] font-bold">Crescimento</span> e <span className="text-[#22C55E] font-bold">Dominação</span>.
          </p>
          <Button className="bg-[#8B5CF6] hover:bg-[#7C3AED]" onClick={() => (window.location.href = '/precos')}>
            Ver Planos
          </Button>
        </div>
      </div>
    )
  }

  const favoriteVoices = favorites
    .map((id) => ALL_VOICES.find((v) => v.voice_id === id))
    .filter((v): v is CatalogVoice => Boolean(v))

  const renderCard = (voice: CatalogVoice) => (
    <VoiceCard
      key={voice.voice_id}
      voice={voice}
      isPlaying={playingId === voice.voice_id}
      isLoading={loadingId === voice.voice_id}
      isFavorite={favorites.includes(voice.voice_id)}
      onPlay={() => play(voice)}
      onToggleFavorite={() => toggleFavorite(voice.voice_id)}
    />
  )

  return (
    <div className="min-h-screen bg-[#0A0A0A] p-6">
      <div className="max-w-5xl mx-auto">
        <BackButton to="/dashboard" label="Voltar ao Painel" className="mb-6" />

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-2">
            <Volume2 className="w-8 h-8 text-[#8B5CF6]" />
            Biblioteca de Vozes
          </h1>
          <p className="text-gray-400">Ouça, compare e favorite as vozes para usar nos seus projetos.</p>
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

        {/* Texto de amostra: a voz vai falar isto na prévia. */}
        <div className="bg-[#111111] border border-gray-800 rounded-2xl p-5 mb-8">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Texto de amostra <span className="text-gray-500 font-normal">— o que as vozes vão falar</span>
          </label>
          <input
            type="text"
            value={sampleText}
            maxLength={200}
            onChange={(e) => setSampleText(e.target.value)}
            placeholder={DEFAULT_SAMPLE}
            className="w-full p-3 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#8B5CF6]"
          />
        </div>

        {/* Favoritas fixadas no topo. */}
        {favoriteVoices.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
              <Heart className="w-5 h-5 text-[#EC4899] fill-[#EC4899]" />
              Minhas Favoritas
              <span className="text-sm font-normal text-gray-500">({favoriteVoices.length})</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {favoriteVoices.map(renderCard)}
            </div>
          </section>
        )}

        {/* Vozes que tocam na hora (Gemini). */}
        <section className="mb-8">
          <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#8B5CF6]" />
            Vozes Inclusas
            <span className="text-sm font-normal text-gray-500">tocam na hora</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {GEMINI_VOICES.map(renderCard)}
          </div>
        </section>

        {/* Vozes premium (ElevenLabs) — entram com plano pago. */}
        <section>
          <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
            <Crown className="w-5 h-5 text-[#F59E0B]" />
            Vozes Premium
            <span className="text-sm font-normal text-gray-500">requer plano pago da ElevenLabs</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {ELEVENLABS_VOICES.map(renderCard)}
          </div>
        </section>
      </div>
    </div>
  )
}

function VoiceCard({
  voice,
  isPlaying,
  isLoading,
  isFavorite,
  onPlay,
  onToggleFavorite,
}: {
  voice: CatalogVoice
  isPlaying: boolean
  isLoading: boolean
  isFavorite: boolean
  onPlay: () => void
  onToggleFavorite: () => void
}) {
  const tags = [voice.genero, voice.sotaque, voice.vibe].filter(Boolean) as string[]

  return (
    <div
      className={`relative bg-[#111111] border rounded-2xl p-4 flex items-center gap-4 transition-colors ${
        isPlaying ? 'border-[#8B5CF6]' : 'border-gray-800'
      }`}
    >
      {/* Botão de play/prévia */}
      <button
        type="button"
        onClick={onPlay}
        disabled={voice.premium || isLoading}
        title={voice.premium ? 'Requer plano pago da ElevenLabs' : isPlaying ? 'Pausar' : 'Ouvir prévia'}
        aria-label={voice.premium ? `${voice.name} (premium)` : isPlaying ? `Pausar ${voice.name}` : `Ouvir ${voice.name}`}
        className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
          voice.premium
            ? 'bg-[#1A1A1A] text-gray-600 cursor-not-allowed'
            : 'bg-[#8B5CF6] hover:bg-[#7C3AED] text-white'
        }`}
      >
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : voice.premium ? (
          <Lock className="w-5 h-5" />
        ) : isPlaying ? (
          <Pause className="w-5 h-5" />
        ) : (
          <Play className="w-5 h-5 ml-0.5" />
        )}
      </button>

      {/* Nome + tags */}
      <div className="min-w-0 flex-1">
        <p className="text-white font-semibold truncate">{voice.name}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {tags.map((t) => (
            <span key={t} className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#1A1A1A] border border-gray-700 text-gray-400">
              {t}
            </span>
          ))}
          {isPlaying && (
            <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#8B5CF6]/20 border border-[#8B5CF6]/40 text-[#a78bfa]">
              tocando
            </span>
          )}
        </div>
      </div>

      {/* Favoritar */}
      <button
        type="button"
        onClick={onToggleFavorite}
        title={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
        aria-label={isFavorite ? `Remover ${voice.name} dos favoritos` : `Adicionar ${voice.name} aos favoritos`}
        className="shrink-0 p-2 text-gray-500 hover:text-[#EC4899] transition-colors"
      >
        <Heart className={`w-5 h-5 ${isFavorite ? 'text-[#EC4899] fill-[#EC4899]' : ''}`} />
      </button>
    </div>
  )
}
