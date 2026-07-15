// Mini-mixer do Editor de Voz: soma a locução gerada (voz) com uma trilha que o cliente
// sobe, cada uma com seu próprio volume, e devolve um único áudio pronto pra baixar.
//
// Roda 100% no navegador via Web Audio API (OfflineAudioContext): decodifica os dois blobs,
// aplica ganho independente em cada faixa, renderiza a soma e serializa em WAV. Depois o
// editor passa esse WAV pro FFmpeg.wasm (mesmo que já usamos pro OGG) e vira MP3 320k.
//
// Master = duração da VOZ (+ pequena cauda): a trilha entra como cama embaixo da locução e é
// aparada no fim da fala. Se a trilha for mais curta que a voz, ela simplesmente termina antes
// (sem loop). Intro/arranjo na linha do tempo é escopo de Fase 2 (timeline com waveform).

// AudioContext único por sessão só pra decodificar (decodeAudioData). Criado sob demanda
// porque só existe depois de um gesto do usuário (clique em gerar/mixar).
let decodeCtx: AudioContext | null = null

function getDecodeCtx(): AudioContext {
  if (!decodeCtx) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    decodeCtx = new Ctx()
  }
  return decodeCtx
}

// decodeAudioData consome o ArrayBuffer que recebe; passamos uma cópia (slice) pra poder
// decodificar o mesmo blob mais de uma vez (ex: reusar a trilha em várias prévias).
export async function blobToAudioBuffer(blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer()
  return getDecodeCtx().decodeAudioData(arrayBuffer.slice(0))
}

function getOfflineCtx(channels: number, length: number, sampleRate: number): OfflineAudioContext {
  const OfflineCtx =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext
  return new OfflineCtx(channels, length, sampleRate)
}

// Fade-out da trilha ao fim da locução (pedido do Mestre): quando a voz termina, a música
// não corta seca — desce até o silêncio ao longo de FADE_OUT_SECONDS. A cauda do master é
// dimensionada pra caber esse fade inteiro.
const FADE_OUT_SECONDS = 1.1

// Renderiza voz + trilha num único AudioBuffer estéreo.
// voiceGain/trackGain são multiplicadores lineares (1 = 100%). A trilha costuma entrar
// bem abaixo (~0.25) pra não competir com a locução.
export async function renderMix(
  voice: AudioBuffer,
  track: AudioBuffer | null,
  voiceGain: number,
  trackGain: number,
): Promise<AudioBuffer> {
  const sampleRate = 44100
  // Cauda = fade completo + folga. Sem trilha, uma cauda mínima já basta.
  const tail = track ? FADE_OUT_SECONDS + 0.1 : 0.3
  const length = Math.ceil((voice.duration + tail) * sampleRate)
  const ctx = getOfflineCtx(2, length, sampleRate)

  const voiceSrc = ctx.createBufferSource()
  voiceSrc.buffer = voice
  const voiceGainNode = ctx.createGain()
  voiceGainNode.gain.value = voiceGain
  voiceSrc.connect(voiceGainNode).connect(ctx.destination)
  voiceSrc.start(0)

  if (track) {
    const trackSrc = ctx.createBufferSource()
    trackSrc.buffer = track
    const trackGainNode = ctx.createGain()
    // Mantém o volume da trilha até a voz acabar; a partir daí, rampa linear até zero
    // em FADE_OUT_SECONDS. (setValueAtTime "ancora" o valor antes da rampa começar.)
    trackGainNode.gain.setValueAtTime(trackGain, 0)
    trackGainNode.gain.setValueAtTime(trackGain, voice.duration)
    trackGainNode.gain.linearRampToValueAtTime(0, voice.duration + FADE_OUT_SECONDS)
    trackSrc.connect(trackGainNode).connect(ctx.destination)
    trackSrc.start(0)
  }

  return ctx.startRendering()
}

// ===== Realce Profissional da Voz (masterização) =====
// Cadeia aplicada à locução crua pra dar "brilho de estúdio" sem soar amador:
//   trim de silêncio -> passa-alta (tira ronco) -> corte leve de médio-grave (des-embarra)
//   -> high-shelf de presença (brilho) -> compressor (firmeza/constância) -> reverb sutil.
// Roda offline e devolve um AudioBuffer mono 44.1kHz, pronto pra virar WAV/OGG/mixagem.

// Impulso sintético (ruído decaindo) pra um reverb curto de sala. Barato e sem asset externo.
function makeImpulseResponse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate
  const len = Math.floor(rate * seconds)
  const impulse = ctx.createBuffer(2, len, rate)
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c)
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return impulse
}

// Corta silêncio no começo e no fim da locução, deixando uma pequena folga pra não "engolir"
// o ataque/solta das palavras. Se a faixa for toda silêncio (nada acima do limiar), devolve
// o buffer original.
function trimSilence(buffer: AudioBuffer): AudioBuffer {
  const threshold = 0.005 // ~ -46 dBFS
  const data = buffer.getChannelData(0)
  const n = data.length

  let first = -1
  let last = -1
  for (let i = 0; i < n; i++) {
    if (Math.abs(data[i]) > threshold) {
      if (first === -1) first = i
      last = i
    }
  }
  if (first === -1) return buffer // faixa muda

  const rate = buffer.sampleRate
  const start = Math.max(0, first - Math.floor(0.03 * rate)) // 30ms de respiro antes
  const end = Math.min(n, last + Math.floor(0.08 * rate)) // 80ms de cauda depois
  const newLen = end - start

  const out = getDecodeCtx().createBuffer(buffer.numberOfChannels, newLen, rate)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.getChannelData(c).set(buffer.getChannelData(c).subarray(start, end))
  }
  return out
}

export async function enhanceVoiceBuffer(
  input: AudioBuffer,
  opts: { reverb?: boolean } = {},
): Promise<AudioBuffer> {
  const reverb = opts.reverb ?? true
  const trimmed = trimSilence(input)
  const sampleRate = 44100
  const reverbTail = reverb ? 0.6 : 0.05
  const length = Math.ceil(trimmed.duration * sampleRate) + Math.ceil(reverbTail * sampleRate)
  const ctx = getOfflineCtx(1, length, sampleRate)

  const src = ctx.createBufferSource()
  src.buffer = trimmed

  // Passa-alta: remove ronco/pop abaixo de 85Hz (não existe voz útil aí).
  const highpass = ctx.createBiquadFilter()
  highpass.type = 'highpass'
  highpass.frequency.value = 85

  // Corte leve nos médios-graves: tira o "abafado/barro" que deixa a voz sem definição.
  const mud = ctx.createBiquadFilter()
  mud.type = 'peaking'
  mud.frequency.value = 300
  mud.Q.value = 1
  mud.gain.value = -2

  // High-shelf de presença: o "brilho" pedido — realça agudos a partir de 5kHz.
  const presence = ctx.createBiquadFilter()
  presence.type = 'highshelf'
  presence.frequency.value = 5000
  presence.gain.value = 3.5

  // Compressor: nivela a locução (partes baixas sobem, picos são contidos) = voz firme e
  // constante, típica de rádio.
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -20
  comp.knee.value = 25
  comp.ratio.value = 3
  comp.attack.value = 0.005
  comp.release.value = 0.18

  // Ganho de make-up conservador: recupera volume pós-compressão sem estourar (0dBFS).
  const makeup = ctx.createGain()
  makeup.gain.value = 1.2

  src.connect(highpass)
  highpass.connect(mud)
  mud.connect(presence)
  presence.connect(comp)
  comp.connect(makeup)

  if (reverb) {
    const convolver = ctx.createConvolver()
    convolver.buffer = makeImpulseResponse(ctx, 0.5, 2.2)
    const wet = ctx.createGain()
    wet.gain.value = 0.1 // reverb bem sutil — só dá "corpo", sem soar num banheiro
    const dry = ctx.createGain()
    dry.gain.value = 1.0
    makeup.connect(dry).connect(ctx.destination)
    makeup.connect(convolver).connect(wet).connect(ctx.destination)
  } else {
    makeup.connect(ctx.destination)
  }

  src.start(0)
  return ctx.startRendering()
}

// Serializa um AudioBuffer em WAV PCM 16-bit (formato universal, sem dependência externa).
// Base pra depois converter em MP3 no FFmpeg.
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const numFrames = buffer.length
  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const dataSize = numFrames * blockAlign
  const bufferSize = 44 + dataSize

  const arrayBuffer = new ArrayBuffer(bufferSize)
  const view = new DataView(arrayBuffer)

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  // Cabeçalho RIFF/WAVE
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // tamanho do chunk fmt
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 8 * bytesPerSample, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  // Intercala os canais e converte float [-1,1] pra PCM 16-bit
  const channels: Float32Array[] = []
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c))

  let offset = 44
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channels[c][i]
      // Clamp pra evitar estouro (wrap) quando a soma das faixas passa de 1.0
      sample = Math.max(-1, Math.min(1, sample))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' })
}
