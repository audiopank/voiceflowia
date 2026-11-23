// 🎬 Vídeo dos cards (23/11/2026, "ideia ouro" do Mestre): os cards do carrossel passando, com a
// locução e a trilha, num MP4 vertical 9:16 (Reels, Status, TikTok). NÃO é vídeo gerado por IA:
// é uma apresentação dos cards que o cliente já tem.
//
// Tudo no NAVEGADOR (a Vercel está no teto de funções e não aguenta arquivo grande):
// canvas 1080×1920 → WebCodecs (H.264 + AAC, usa a placa de vídeo, mais rápido que o tempo real)
// → mp4-muxer. Mesmo motor do "vídeo do episódio" do Locutores IA (static/video-episodio.js),
// que o Mestre já usa de verdade.
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'

export const VIDEO_W = 1080
export const VIDEO_H = 1920
const FPS = 30
const FADE_CARD = 0.6 // segundos de transição suave entre um card e o próximo

// ── PARTE PURA (testada em Node) ─────────────────────────────────────────
// Cada card fica uma fatia IGUAL do áudio; perto de cada troca, mistura o card que sai com o
// que entra. → {de, para, alfa}: alfa 0 = só `de`; 1 = só `para`.
export function trocaDeCard(t: number, duracao: number, n: number, fade = FADE_CARD): { de: number; para: number; alfa: number } {
  if (!(n > 1) || !(duracao > 0)) return { de: 0, para: 0, alfa: 0 }
  const fatia = duracao / n
  const i = Math.min(n - 1, Math.max(0, Math.floor(t / fatia)))
  const k = Math.round(t / fatia) // troca mais próxima (1..n-1 são trocas de verdade)
  const d = t - k * fatia
  if (k < 1 || k > n - 1 || Math.abs(d) >= fade / 2) return { de: i, para: i, alfa: 0 }
  return { de: k - 1, para: k, alfa: (d + fade / 2) / fade }
}

// Card (4:5) centralizado e inteiro no quadro 9:16, sem cortar nem esticar.
export function caixaDoCard(iw: number, ih: number): { x: number; y: number; w: number; h: number } {
  const e = Math.min(VIDEO_W / iw, VIDEO_H / ih)
  const w = iw * e, h = ih * e
  return { x: (VIDEO_W - w) / 2, y: (VIDEO_H - h) / 2, w, h }
}

// ── MONTAGEM ─────────────────────────────────────────────────────────────
export function navegadorMontaVideo(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'AudioEncoder' in window
}

async function codecDeVideo(): Promise<string | null> {
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028']) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec, width: VIDEO_W, height: VIDEO_H, bitrate: 4_000_000, framerate: FPS })
      if (s?.supported) return codec
    } catch { /* tenta o próximo */ }
  }
  return null
}

// AAC só aceita algumas taxas: 44,1 e 48 kHz passam direto; o resto vira 48 kHz.
async function audioPronto(buf: AudioBuffer): Promise<AudioBuffer> {
  const canais = Math.min(2, buf.numberOfChannels)
  if ((buf.sampleRate === 44100 || buf.sampleRate === 48000) && buf.numberOfChannels <= 2) return buf
  const ctx = new OfflineAudioContext(canais, Math.ceil(buf.duration * 48000), 48000)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(ctx.destination)
  src.start()
  return ctx.startRendering()
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function gerarVideoDosCards(opc: {
  cards: Blob[] // PNGs dos cards, na ordem do carrossel
  audio: Blob // locução já com a trilha (WAV)
  fundo: string // cor de fundo dos cards — preenche o quadro 9:16
  aoProgresso?: (p: number) => void
}): Promise<Blob> {
  if (!navegadorMontaVideo()) throw new Error('Este navegador não monta vídeo. Use o Chrome ou o Edge atualizados.')
  if (!opc.cards.length) throw new Error('Não há cards para montar o vídeo.')

  const ac = new AudioContext()
  let audio: AudioBuffer
  try {
    audio = await audioPronto(await ac.decodeAudioData(await opc.audio.arrayBuffer()))
  } finally {
    void ac.close()
  }
  const canais = Math.min(2, audio.numberOfChannels)
  const taxa = audio.sampleRate

  // Confere os codificadores ANTES de alocar imagens e encoders (Firefox não tem AAC; Safari varia).
  const codec = await codecDeVideo()
  if (!codec) throw new Error('O codificador de vídeo (H.264) deste navegador não está disponível. Use o Chrome ou o Edge atualizados.')
  const audioCfg: AudioEncoderConfig = { codec: 'mp4a.40.2', sampleRate: taxa, numberOfChannels: canais, bitrate: 160_000 }
  const sa = await AudioEncoder.isConfigSupported(audioCfg).catch(() => null)
  if (!sa?.supported) throw new Error('O codificador de áudio (AAC) deste navegador não está disponível. Use o Chrome ou o Edge atualizados.')

  const alvo = new ArrayBufferTarget()
  const muxer = new Muxer({
    target: alvo,
    video: { codec: 'avc', width: VIDEO_W, height: VIDEO_H, frameRate: FPS },
    audio: { codec: 'aac', numberOfChannels: canais, sampleRate: taxa },
    fastStart: 'in-memory',
  })
  let erro: unknown = null
  let ve: VideoEncoder | undefined
  let ae: AudioEncoder | undefined
  const imgs: ImageBitmap[] = []

  try {
    for (const b of opc.cards) imgs.push(await createImageBitmap(b))
    ve = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { erro = e } })
    ve.configure({ codec, width: VIDEO_W, height: VIDEO_H, bitrate: 4_000_000, framerate: FPS, avc: { format: 'avc' } })
    ae = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { erro = e } })
    ae.configure(audioCfg)

    // Áudio em blocos de 1 s, planar.
    for (let i = 0; i < audio.length; i += taxa) {
      const n = Math.min(taxa, audio.length - i)
      const dados = new Float32Array(n * canais)
      for (let c = 0; c < canais; c++) dados.set(audio.getChannelData(c).subarray(i, i + n), c * n)
      const ad = new AudioData({ format: 'f32-planar', sampleRate: taxa, numberOfFrames: n, numberOfChannels: canais, timestamp: Math.round((i / taxa) * 1e6), data: dados })
      try { ae.encode(ad) } finally { ad.close() }
    }

    // Vídeo: um quadro a cada 1/30 s; quadro-chave a cada 2 s.
    const canvas = new OffscreenCanvas(VIDEO_W, VIDEO_H)
    const ctx = canvas.getContext('2d')!
    const dur = audio.duration
    const total = Math.ceil(dur * FPS)
    for (let f = 0; f < total; f++) {
      if (erro) throw erro
      const t = f / FPS
      const tr = trocaDeCard(t, dur, imgs.length)
      ctx.globalAlpha = 1
      ctx.fillStyle = opc.fundo
      ctx.fillRect(0, 0, VIDEO_W, VIDEO_H)
      const a = imgs[tr.de], ca = caixaDoCard(a.width, a.height)
      ctx.drawImage(a, ca.x, ca.y, ca.w, ca.h)
      if (tr.alfa > 0) {
        const b = imgs[tr.para], cb = caixaDoCard(b.width, b.height)
        ctx.globalAlpha = tr.alfa
        ctx.drawImage(b, cb.x, cb.y, cb.w, cb.h)
      }
      const vf = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / FPS) })
      try { ve.encode(vf, { keyFrame: f % (FPS * 2) === 0 }) } finally { vf.close() }
      while (ve.encodeQueueSize > 12) await espera(2)
      if (opc.aoProgresso && f % 15 === 0) opc.aoProgresso(f / total)
    }
    await ve.flush()
    await ae.flush()
    if (erro) throw erro
  } catch (e) {
    throw erro ?? e // o erro do encoder é o motivo real; o "codec fechado" que vem depois é consequência
  } finally {
    if (ve && ve.state !== 'closed') ve.close()
    if (ae && ae.state !== 'closed') ae.close()
    imgs.forEach((im) => im.close())
  }
  muxer.finalize()
  opc.aoProgresso?.(1)
  return new Blob([alvo.buffer], { type: 'video/mp4' })
}
