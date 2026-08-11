import { supabase } from './supabase'

// `founder_videos`/`founder-videos` e nao `videos`: ja existe uma tabela `videos`
// orfa no banco (schema antigo, zero linhas, nao referenciada por nada no repo).
const TABELA = 'founder_videos'
const BUCKET = 'founder-videos'

// Teto por arquivo. O padrao do Supabase Storage tambem e 50MB — subir mais que
// isso falha no servidor, entao barramos antes pra dar mensagem decente.
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024

export const TIPOS_VIDEO_ACEITOS = ['video/mp4', 'video/webm', 'video/quicktime']

export interface VideoFundador {
  id: string
  titulo: string
  frase: string | null
  video_url: string
  video_path: string
  poster_url: string | null
  poster_path: string | null
  sort_order: number
  active: boolean
  created_at: string
}

// Lista publica: so os ativos, na ordem definida no painel. Usada pela /precos e
// pela /videos (visitante deslogado — a policy videos_public_read cobre isso).
export async function listarVideosPublicos(): Promise<VideoFundador[]> {
  const { data, error } = await supabase
    .from(TABELA)
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true })

  if (error) throw error
  return (data ?? []) as VideoFundador[]
}

// Lista do painel: traz TAMBEM os inativos, pro admin poder reativar.
export async function listarVideosAdmin(): Promise<VideoFundador[]> {
  const { data, error } = await supabase
    .from(TABELA)
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) throw error
  return (data ?? []) as VideoFundador[]
}

// Captura o primeiro frame legivel do video como JPEG, pra usar de poster.
// Sem poster o <video> aparece como um retangulo preto ate a pessoa clicar —
// com ele, a pagina mostra a cara do video sem baixar o arquivo inteiro.
// Falhou (codec que o navegador nao decodifica)? Devolve null: poster e bonus,
// nunca motivo pra impedir o upload.
export async function gerarPoster(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    let encerrado = false

    function encerrar(resultado: Blob | null) {
      if (encerrado) return
      encerrado = true
      URL.revokeObjectURL(url)
      resolve(resultado)
    }

    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true

    video.onloadeddata = () => {
      // 0.1s em vez de 0: o frame exato do inicio costuma vir preto.
      video.currentTime = Math.min(0.1, video.duration || 0.1)
    }

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (!ctx || !canvas.width || !canvas.height) return encerrar(null)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => encerrar(blob), 'image/jpeg', 0.8)
      } catch {
        encerrar(null)
      }
    }

    video.onerror = () => encerrar(null)
    // Rede/codec travado: nao deixa o upload pendurado esperando poster.
    setTimeout(() => encerrar(null), 10000)

    video.src = url
  })
}

function nomeUnico(prefixo: string, ext: string): string {
  const aleatorio = Math.random().toString(36).slice(2, 10)
  return `${prefixo}-${Date.now()}-${aleatorio}.${ext}`
}

export interface NovoVideo {
  titulo: string
  frase: string
  file: File
  poster: Blob | null
  sortOrder: number
}

// Sobe o arquivo (e o poster, se houver) pro Storage e grava a linha na tabela.
// Se a gravacao no banco falhar, apaga o que subiu — senao ficaria arquivo orfao
// ocupando cota sem nenhuma linha apontando pra ele.
export async function criarVideo({ titulo, frase, file, poster, sortOrder }: NovoVideo): Promise<void> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
  const videoPath = nomeUnico('video', ext)

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(videoPath, file, {
    contentType: file.type,
    upsert: false,
  })
  if (upErr) throw upErr

  let posterPath: string | null = null
  let posterUrl: string | null = null
  if (poster) {
    posterPath = nomeUnico('poster', 'jpg')
    const { error: posterErr } = await supabase.storage.from(BUCKET).upload(posterPath, poster, {
      contentType: 'image/jpeg',
      upsert: false,
    })
    if (posterErr) {
      // Poster e bonus: segue sem ele em vez de derrubar o upload do video.
      posterPath = null
    } else {
      posterUrl = supabase.storage.from(BUCKET).getPublicUrl(posterPath).data.publicUrl
    }
  }

  const videoUrl = supabase.storage.from(BUCKET).getPublicUrl(videoPath).data.publicUrl

  const { error: insErr } = await supabase.from(TABELA).insert({
    titulo,
    frase: frase.trim() || null,
    video_url: videoUrl,
    video_path: videoPath,
    poster_url: posterUrl,
    poster_path: posterPath,
    sort_order: sortOrder,
    active: true,
  })

  if (insErr) {
    const orfaos = posterPath ? [videoPath, posterPath] : [videoPath]
    await supabase.storage.from(BUCKET).remove(orfaos)
    throw insErr
  }
}

export async function alternarAtivo(id: string, active: boolean) {
  return supabase.from(TABELA).update({ active }).eq('id', id)
}

export async function atualizarOrdem(id: string, sortOrder: number) {
  return supabase.from(TABELA).update({ sort_order: sortOrder }).eq('id', id)
}

// Apaga a linha E os arquivos. A linha vai primeiro: se o Storage falhar, o que
// sobra e um arquivo orfao (invisivel, so ocupa cota) — o inverso deixaria um
// card quebrado na pagina publica apontando pra arquivo que nao existe mais.
export async function apagarVideo(video: VideoFundador) {
  const { error } = await supabase.from(TABELA).delete().eq('id', video.id)
  if (error) throw error

  const paths = video.poster_path ? [video.video_path, video.poster_path] : [video.video_path]
  await supabase.storage.from(BUCKET).remove(paths)
}
