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

const TAIL_SECONDS = 0.5

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
  const length = Math.ceil((voice.duration + TAIL_SECONDS) * sampleRate)

  const OfflineCtx =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext
  const ctx = new OfflineCtx(2, length, sampleRate)

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
    trackGainNode.gain.value = trackGain
    trackSrc.connect(trackGainNode).connect(ctx.destination)
    trackSrc.start(0)
  }

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
