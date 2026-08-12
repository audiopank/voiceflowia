import { supabase } from './supabase'

// `founder_videos`/`founder-videos` e nao `videos`: ja existe uma tabela `videos`
// orfa no banco (schema antigo, zero linhas, nao referenciada por nada no repo).
const TABELA = 'founder_videos'
const BUCKET = 'founder-videos'

// Teto RIGIDO do plano Free da Supabase ("For Free projects, the limit can't
// exceed 50 MB") — nao adianta aumentar aqui, o servidor recusa. Video mais
// longo que ~1min nao cabe: nesse caso o caminho e o link do YouTube.
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024

export const TIPOS_VIDEO_ACEITOS = ['video/mp4', 'video/webm', 'video/quicktime']

export interface VideoFundador {
  id: string
  titulo: string
  frase: string | null
  /** Preenchido quando o video e do YouTube; nesse caso video_url/path vem null. */
  youtube_id: string | null
  video_url: string | null
  video_path: string | null
  poster_url: string | null
  poster_path: string | null
  sort_order: number
  active: boolean
  created_at: string
}

// Aceita as formas que o YouTube usa: watch?v=, youtu.be/, /shorts/, /embed/ e
// o proprio ID colado sozinho. Devolve null se nao reconhecer — dai a UI avisa
// em vez de gravar um ID quebrado que so apareceria como player cinza no ar.
export function extrairYoutubeId(entrada: string): string | null {
  const texto = entrada.trim()
  if (!texto) return null

  // ID puro (11 chars do alfabeto do YouTube)
  if (/^[\w-]{11}$/.test(texto)) return texto

  // O (?![\w-]) no fim recusa trecho MAIOR que 11 chars em vez de cortar nos
  // 11 primeiros: sem ele um link digitado errado virava "reconhecido" com um
  // ID truncado, e o erro so apareceria como player cinza na pagina publica.
  const padroes = [
    /[?&]v=([\w-]{11})(?![\w-])/,          // youtube.com/watch?v=ID
    /youtu\.be\/([\w-]{11})(?![\w-])/,     // youtu.be/ID
    /\/shorts\/([\w-]{11})(?![\w-])/,      // youtube.com/shorts/ID
    /\/embed\/([\w-]{11})(?![\w-])/,       // youtube.com/embed/ID
    /\/live\/([\w-]{11})(?![\w-])/,        // youtube.com/live/ID
  ]
  for (const padrao of padroes) {
    const achou = texto.match(padrao)
    if (achou) return achou[1]
  }
  return null
}

// Todo ID gravado pelo painel passa por extrairYoutubeId, entao ja vem limitado
// a [\w-]{11}. O encodeURIComponent aqui e cinto de seguranca pro caso de uma
// linha inserida na mao pelo painel do Supabase: sem ele, um "ID" com ? ou &
// grudaria parametro extra na URL do embed. ID valido nao muda em nada (todos
// os caracteres do alfabeto do YouTube sao unreserved).
// Thumbnail servida pelo proprio YouTube — nao gasta nada da nossa Storage.
export function youtubeThumb(id: string): string {
  return `https://img.youtube.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`
}

// nocookie: nao planta cookie de rastreio do Google em quem so abriu a pagina.
export function youtubeEmbed(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`
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

// Video do YouTube: nada sobe pra Storage, so grava a linha apontando pro ID.
// E como o YouTube ja serve a thumbnail, nem poster precisamos guardar.
export async function criarVideoYoutube(
  titulo: string,
  frase: string,
  youtubeId: string,
  sortOrder: number,
): Promise<void> {
  const { error } = await supabase.from(TABELA).insert({
    titulo,
    frase: frase.trim() || null,
    youtube_id: youtubeId,
    sort_order: sortOrder,
    active: true,
  })
  if (error) throw error
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

  // Video do YouTube nao tem arquivo nosso pra remover.
  const paths = [video.video_path, video.poster_path].filter((p): p is string => !!p)
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
}
