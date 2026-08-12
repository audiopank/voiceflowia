import { useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import { listarVideosPublicos, youtubeThumb, youtubeEmbed, type VideoFundador } from '../lib/videos'

// Cada card so carrega o video quando a pessoa clica no play — vale tanto pro
// arquivo proprio (senao a cota de banda da Storage ia embora sem ninguem
// assistir) quanto pro iframe do YouTube (que sozinho ja pesa centenas de KB
// por card e planta script de terceiro em quem so passou pela pagina).
function VideoCard({ video }: { video: VideoFundador }) {
  const [tocando, setTocando] = useState(false)

  const ehYoutube = !!video.youtube_id
  const thumb = ehYoutube ? youtubeThumb(video.youtube_id!) : video.poster_url

  return (
    <div className="bg-[#111111] border border-gray-800 rounded-2xl overflow-hidden">
      <div className={`relative bg-black ${ehYoutube ? 'aspect-video' : 'aspect-[4/5]'}`}>
        {tocando ? (
          ehYoutube ? (
            <iframe
              src={youtubeEmbed(video.youtube_id!)}
              title={video.titulo}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="w-full h-full border-0"
            />
          ) : (
            <video
              src={video.video_url ?? undefined}
              poster={video.poster_url || undefined}
              controls
              autoPlay
              playsInline
              className="w-full h-full object-contain"
            />
          )
        ) : (
          <button
            type="button"
            onClick={() => setTocando(true)}
            aria-label={`Assistir: ${video.titulo}`}
            className="group w-full h-full relative"
          >
            {thumb && <img src={thumb} alt="" loading="lazy" className="w-full h-full object-cover" />}
            <span className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/20 transition-colors">
              <span className="w-14 h-14 rounded-full bg-white/90 group-hover:bg-white flex items-center justify-center transition-colors">
                <Play className="w-6 h-6 text-[#111111] ml-0.5" fill="currentColor" />
              </span>
            </span>
          </button>
        )}
      </div>

      <div className="p-4">
        {video.frase && <p className="text-gray-300 text-sm leading-snug">“{video.frase}”</p>}
        <p className={`text-white font-medium text-sm ${video.frase ? 'mt-2' : ''}`}>{video.titulo}</p>
        <p className="text-xs text-gray-500 mt-1">Eudes · criador do VoiceFlow IA</p>
      </div>
    </div>
  )
}

interface VideosSectionProps {
  titulo?: string
  subtitulo?: string
  /** Na /videos a secao E a pagina: sumir deixaria um titulo prometendo video
   *  e nada embaixo. Ali mostramos um aviso honesto em vez de sumir. */
  avisarSeVazio?: boolean
}

/**
 * Secao publica com os videos do fundador. Se nao houver nenhum video ativo
 * (ou a consulta falhar), por padrao NAO renderiza nada — melhor a pagina
 * seguir sem a secao do que exibir um bloco vazio prometendo conteudo.
 */
export function VideosSection({
  titulo = 'Veja o VoiceFlow IA funcionando',
  subtitulo = 'Eu mesmo mostrando o que a ferramenta faz, sem enrolação.',
  avisarSeVazio = false,
}: VideosSectionProps) {
  const [videos, setVideos] = useState<VideoFundador[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let cancelado = false
    listarVideosPublicos()
      .then((lista) => {
        if (!cancelado) setVideos(lista)
      })
      .catch((err) => {
        console.error('Erro ao carregar vídeos:', err)
      })
      .finally(() => {
        if (!cancelado) setCarregando(false)
      })
    return () => {
      cancelado = true
    }
  }, [])

  if (videos.length === 0) {
    if (!avisarSeVazio || carregando) return null
    return (
      <section className="container mx-auto px-6 pb-16">
        <p className="text-center text-gray-500">
          Os vídeos estão sendo gravados e entram aqui em breve. Enquanto isso, você pode testar a
          ferramenta você mesmo — é grátis por 7 dias.
        </p>
      </section>
    )
  }

  return (
    <section className="container mx-auto px-6 pb-20">
      {/* Título vazio = a página que usa a seção já tem o próprio cabeçalho (ex: /videos). */}
      {(titulo || subtitulo) && (
        <div className="text-center mb-8">
          {titulo && <h3 className="text-2xl md:text-3xl font-bold text-white">{titulo}</h3>}
          {subtitulo && <p className="text-gray-400 mt-2">{subtitulo}</p>}
        </div>
      )}

      {/* Flex centralizado em vez de grid de 4 colunas: com 1 ou 2 vídeos a grade
          deixava tudo espremido na esquerda. Assim fica centrado em qualquer qtd. */}
      <div className="flex flex-wrap justify-center gap-4 max-w-6xl mx-auto">
        {videos.map((video) => (
          <div key={video.id} className="w-full sm:w-[340px]">
            <VideoCard video={video} />
          </div>
        ))}
      </div>
    </section>
  )
}
