import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Lock, Loader2, AlertCircle, Sparkles, Volume2, Download, Play } from 'lucide-react'
import { useSubscription } from '../lib/useSubscription'
import { supabase } from '../lib/supabase'
import { fetchWithRetry } from '../lib/apiRetry'
import { Button } from '../components/ui/button'
import { BackButton } from '../components/BackButton'

export const Route = createFileRoute('/agente')({
  component: Agente,
})

interface Post {
  dia: number
  hook: string
  roteiro: string
  legenda: string
  vozSugerida: string
}

function Agente() {
  const { hasAccess, loading: loadingSubscription, trial, refresh } = useSubscription()
  const [nicho, setNicho] = useState('')
  const [tom, setTom] = useState('Profissional')
  const [qtdPosts, setQtdPosts] = useState(30)
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState('')

  const [audioBlobs, setAudioBlobs] = useState<Record<number, Blob>>({})
  const [audioErrors, setAudioErrors] = useState<Record<number, string>>({})
  const [generatingAudioFor, setGeneratingAudioFor] = useState<number | null>(null)
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

    try {
      const response = await fetchWithRetry(
        '/api/gemini/generate-content',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nicho, tom, qtdPosts })
        },
        { onWait: (s) => setRateNotice(`⏳ Limite temporário da API. Aguardando ${s}s e tentando de novo...`) },
      )
      setRateNotice('')

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error || `Erro na API: ${response.status}`)
      }

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
      setError(err instanceof Error ? err.message : 'Erro ao gerar conteúdo')
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleGenerateAudio(post: Post) {
    setGeneratingAudioFor(post.dia)
    setAudioErrors((prev) => ({ ...prev, [post.dia]: '' }))

    try {
      const response = await fetchWithRetry(
        '/api/gemini/text-to-speech',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `${post.hook} ${post.roteiro}`,
            voiceName: post.vozSugerida
          })
        },
        { onWait: (s) => setRateNotice(`⏳ Limite temporário da API. Aguardando ${s}s e tentando de novo...`) },
      )
      setRateNotice('')

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || `Erro na API: ${response.status}`)
      }

      const blob = await response.blob()
      setAudioBlobs((prev) => ({ ...prev, [post.dia]: blob }))
    } catch (err) {
      console.error('=== ERRO ao gerar áudio ===', err)
      setAudioErrors((prev) => ({
        ...prev,
        [post.dia]: err instanceof Error ? err.message : 'Erro ao gerar áudio'
      }))
    } finally {
      setGeneratingAudioFor(null)
    }
  }

  function handlePlayAudio(dia: number) {
    const blob = audioBlobs[dia]
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.play()
  }

  function handleDownloadAudio(dia: number) {
    const blob = audioBlobs[dia]
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reel-dia-${dia}.wav`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
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
          <p className="text-gray-400">Gere o mês inteiro de Reels em segundos, com roteiro, legenda e voz prontos.</p>
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
                <option value="Profissional">Profissional</option>
                <option value="Divertido">Divertido</option>
                <option value="Vendedor">Vendedor</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Qtd. Posts</label>
              <input
                type="number"
                min={1}
                max={30}
                value={qtdPosts}
                onChange={(e) => setQtdPosts(Math.min(Math.max(Number(e.target.value) || 1, 1), 30))}
                className="w-full p-3 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#8B5CF6]"
              />
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {posts.map((post) => (
              <div key={post.dia} className="bg-[#111111] border border-gray-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[#8B5CF6] font-bold">Dia {post.dia}</span>
                  <span className="text-xs px-2 py-1 rounded-full bg-[#1A1A1A] border border-gray-700 text-gray-400">
                    Voz: {post.vozSugerida}
                  </span>
                </div>
                <div>
                  <p className="text-xs uppercase text-gray-500 mb-1">Hook (3s)</p>
                  <p className="text-white font-medium">{post.hook}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-gray-500 mb-1">Roteiro (20s)</p>
                  <p className="text-gray-300 text-sm">{post.roteiro}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-gray-500 mb-1">Legenda</p>
                  <p className="text-gray-300 text-sm">{post.legenda}</p>
                </div>

                {audioErrors[post.dia] && (
                  <p className="text-red-400 text-xs">{audioErrors[post.dia]}</p>
                )}

                {audioBlobs[post.dia] ? (
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handlePlayAudio(post.dia)}
                      className="flex-1 bg-[#1A1A1A] hover:bg-[#252525] flex items-center justify-center gap-2"
                    >
                      <Play className="w-4 h-4" />
                      Ouvir
                    </Button>
                    <Button
                      onClick={() => handleDownloadAudio(post.dia)}
                      className="flex-1 bg-[#8B5CF6] hover:bg-[#7C3AED] flex items-center justify-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Baixar
                    </Button>
                  </div>
                ) : (
                  <Button
                    onClick={() => handleGenerateAudio(post)}
                    disabled={generatingAudioFor === post.dia}
                    className="w-full bg-[#22C55E] hover:bg-[#16A34A] disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {generatingAudioFor === post.dia ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Gerando Áudio...
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-4 h-4" />
                        Gerar Áudio com 1 Clique
                      </>
                    )}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
