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
  { id: 'business', label: 'Business', emoji: '🏢', file: 'business.mp3' },
  { id: 'global', label: 'Global', emoji: '🌎', file: 'global.mp3' },
  { id: 'pop', label: 'Pop', emoji: '🎵', file: 'pop.mp3' },
  { id: 'business-day', label: 'Business Day', emoji: '🏙️', file: 'business-day.mp3' },
  { id: 'movimento', label: 'Movimento', emoji: '🚀', file: 'movimento.mp3' },
  { id: 'business-02', label: 'Business 02', emoji: '📈', file: 'business-02.mp3' },
  { id: 'industrial', label: 'Industrial', emoji: '🏭', file: 'industrial.mp3' },
] as const
export type TrilhaPronta = (typeof TRILHAS_PRONTAS)[number]

// ===== Camas exclusivas do Modo Diálogo =====
//
// Ficam FORA de TRILHAS_PRONTAS de propósito, e é essa separação que faz a regra valer:
// não estando naquela lista, elas não têm como aparecer como chip no Editor de Voz nem
// no painel de trilha do kit. Uma cama de conversa nunca sonoriza um spot de rádio —
// não por disciplina de quem edita o código, por construção.
//
// Por que DUAS e não uma: "conversa" cobre desde a padaria brincando com o cliente até a
// oficina respondendo a alguém com medo de ser passado pra trás. Cama alegre embaixo de
// um diálogo sobre desconfiança soa como deboche do cliente — e metade dos nichos do
// produto (oficina, saúde, contábil, jurídico) cai nesse segundo caso.
//
// Requisito extra em relação às trilhas normais: duas vozes alternando ocupam muito mais
// do meio do espectro que um narrador só, então a cama tem que ser MAIS rala — percussão
// leve e notas soltas, nada de acorde sustentado. Ver public/trilhas/README.md.
// Os rótulos vieram do que o Mestre OUVIU, não do que o arquivo parecia pela medição —
// eu tinha lido a primeira como a séria pelo espectro (ela quase não tem agudo) e estava
// errado. Ela é neutra. "Leve" viraria promessa de alegria que a faixa não entrega.
//
// Nível: as duas são entregues em -16,4 LUFS, ~7,5 dB abaixo da trilha comum típica
// (as 7 comuns vão de -7,4 a -13,7 LUFS, mediana -8,9). Isso é de propósito e é o que
// faz o MESMO controle de volume servir pros dois casos: no mesmo ponto do slider, a
// cama de conversa entra mais discreta que uma trilha de spot. Cama sob DIÁLOGO precisa
// de mais folga que sob narração — nas pausas entre as falas ela fica exposta, e a 25%
// sem atenuar ficava a 2,7 dB da voz.
//
// O -16,4 foi calibrado em DUAS rodadas de escuta, e a primeira errou por um motivo que
// vale registrar: eu ajustei contra uma prévia onde o Realce Profissional era simulado no
// ffmpeg, e essa simulação deixou a voz 5,3 dB mais baixa que a real. A cama ficou certa
// contra a voz simulada e baixa demais contra a voz do produto. Lição: calibrar nível de
// cama SÓ no áudio que sai da tela, nunca numa prévia montada fora do navegador.
export const TRILHAS_DIALOGO = [
  { id: 'conversa-neutra', label: 'Conversa neutra', emoji: '💬', file: 'conversa-neutra.mp3' },
  { id: 'conversa-seria', label: 'Conversa séria', emoji: '🤔', file: 'conversa-seria.mp3' },
] as const
export type TrilhaDialogo = (typeof TRILHAS_DIALOGO)[number]

// Cache por id: são só 2 arquivos e o cliente troca de cama várias vezes comparando.
// Decodificar de novo a cada clique desperdiçaria segundos e memória à toa.
const cacheDialogo: Record<string, AudioBuffer> = {}

// Carrega (e decodifica) uma cama de diálogo. Devolve null quando o arquivo ainda não
// existe ou não decodifica — quem chama trata como "sem cama", NUNCA caindo na trilha do
// kit: substituir calado a cama de conversa por uma trilha corporativa é exatamente o que
// a separação acima existe pra impedir.
export async function carregarTrilhaDialogo(id: string): Promise<AudioBuffer | null> {
  if (cacheDialogo[id]) return cacheDialogo[id]

  const preset = TRILHAS_DIALOGO.find((t) => t.id === id)
  if (!preset) return null

  try {
    // Timeout obrigatório: esta chamada acontece DENTRO do "Baixar OGG" e do publicar na
    // NewPost-IA, que ligam o spinner antes e só desligam no finally. Sem teto, uma
    // conexão pendurada segurava a promise pra sempre e o botão ficava girando e
    // desabilitado até o cliente recarregar a página — mesmo estrago do bug do texto
    // longo. Estourando o tempo, cai no catch e vira "sem cama" + aviso, que é a
    // degradação já desenhada.
    const res = await fetch(`/trilhas/${preset.file}`, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    // Em SPA com fallback pra index.html, arquivo faltando volta como HTML 200 — sem esta
    // checagem o decode receberia HTML achando que é áudio (mesmo padrão do TrilhaFundo).
    if (!blob.type.startsWith('audio')) throw new Error('não é áudio')
    const buffer = await blobToAudioBuffer(blob)
    cacheDialogo[id] = buffer
    return buffer
  } catch (err) {
    console.error(`Cama de diálogo "${id}" indisponível:`, err)
    return null
  }
}

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
