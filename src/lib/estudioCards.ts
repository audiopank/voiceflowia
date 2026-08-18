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

// Trilhas prontas ("camas" instrumentais royalty-free) servidas de public/trilhas/*.mp3.
// O cliente clica e a trilha entra direto no mixer, sem precisar ter música própria — é o
// que tira o atrito "cadê a música?" na hora de sonorizar. Os arquivos ficam em public/ pra
// serem servidos same-origin pela Vercel (sem CORS pro Web Audio decodificar).
//
// FONTE ÚNICA: o Editor de Voz e os cards do Agente/Super Agente leem daqui. Antes a lista
// era duplicada em editor.tsx com um comentário "mudou lá, mude aqui" — do jeito que estava,
// acrescentar uma trilha exigia editar dois arquivos e esquecer um deles era silencioso.
// Pra somar uma trilha nova: ponha o MP3 em public/trilhas/ e acrescente UMA linha abaixo.
// Requisitos do arquivo (licença, duração, peso) estão em public/trilhas/README.md.
export const TRILHAS_PRONTAS = [
  { id: 'corporativa', label: 'Corporativa', emoji: '💼', file: 'corporativa.mp3' },
  { id: 'business', label: 'Business', emoji: '🏢', file: 'business.mp3' },
  { id: 'global', label: 'Global', emoji: '🌎', file: 'global.mp3' },
  { id: 'pop', label: 'Pop', emoji: '🎵', file: 'pop.mp3' },
  { id: 'business-day', label: 'Business Day', emoji: '🏙️', file: 'business-day.mp3' },
  { id: 'movimento', label: 'Movimento', emoji: '🚀', file: 'movimento.mp3' },
  { id: 'business-02', label: 'Business 02', emoji: '📈', file: 'business-02.mp3' },
  { id: 'industrial', label: 'Industrial', emoji: '🏭', file: 'industrial.mp3' },
] as const
export type TrilhaPronta = (typeof TRILHAS_PRONTAS)[number]

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
