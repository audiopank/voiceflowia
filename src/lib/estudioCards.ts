// Estúdio nos cards: leva o Realce Profissional e a trilha de fundo do Editor de Voz
// (src/lib/audioMix.ts) pros áudios gerados no Agente e no Super Agente — onde os
// clientes realmente produzem conteúdo todo dia (trial incluso).
//
// Filosofia: o estúdio é BÔNUS em cima da locução. Toda função aqui degrada pra
// entregar a voz original quando algo falha (decode raro, memória, codec exótico) —
// nunca vale a pena derrubar a entrega principal por causa do polimento.

import { blobToAudioBuffer, enhanceVoiceBuffer, renderMix, audioBufferToWav } from './audioMix'

// Volume padrão da trilha em % — cama discreta embaixo da voz, sem competir com ela
// (mesma referência ~0.25 usada no Estúdio de Mixagem do Editor).
export const TRILHA_VOL_PADRAO = 25

// Masteriza a locução crua (trim + EQ + compressor + reverb sutil) e devolve WAV.
// Falhou? Devolve o blob original — o cliente recebe a voz crua, nunca nada.
export async function realcarVoz(blob: Blob): Promise<Blob> {
  try {
    const raw = await blobToAudioBuffer(blob)
    const enhanced = await enhanceVoiceBuffer(raw)
    return audioBufferToWav(enhanced)
  } catch (err) {
    console.error('Realce de voz falhou, usando áudio cru:', err)
    return blob
  }
}

// Soma a trilha (cama de fundo com fade-out quando a voz termina) e devolve WAV.
// Sem trilha carregada, é passthrough. Falhou a mixagem? Devolve só a voz.
export async function aplicarTrilha(
  voiceBlob: Blob,
  trilha: AudioBuffer | null,
  trilhaVolPct: number,
): Promise<Blob> {
  if (!trilha) return voiceBlob
  try {
    const voice = await blobToAudioBuffer(voiceBlob)
    const mixed = await renderMix(voice, trilha, 1, trilhaVolPct / 100)
    return audioBufferToWav(mixed)
  } catch (err) {
    console.error('Mixagem com trilha falhou, usando só a voz:', err)
    return voiceBlob
  }
}
