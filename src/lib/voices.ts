// Catálogo único de vozes do VoiceFlow IA.
// Fonte da verdade usada pelo Editor de Voz e pela Biblioteca de Vozes.

export type Provider = 'elevenlabs' | 'gemini'

export interface Voice {
  voice_id: string
  name: string
}

export interface CatalogVoice extends Voice {
  provider: Provider
  genero?: 'Feminino' | 'Masculino' | 'Neutro'
  sotaque?: string
  /** Uma palavra sobre o timbre/estilo (ex: "Brilhante"). */
  vibe?: string
  /** true = requer plano pago (ElevenLabs hoje retorna 402 na conta free). */
  premium?: boolean
}

// IDs conferidos contra GET /v1/voices desta conta — os IDs "clássicos" dos
// exemplos da ElevenLabs (Rachel, Domi, Bella...) são vozes de biblioteca e
// retornam 402 (payment_required) em contas free via API. Marcadas como premium.
export const ELEVENLABS_VOICES: CatalogVoice[] = [
  { voice_id: 'HOfBIVLhom4mc9WvXfyH', name: 'Andrea Lot', provider: 'elevenlabs', genero: 'Feminino', sotaque: 'PT-BR', premium: true },
  { voice_id: '4za2kOXGgUd57HRSQ1fn', name: 'Lendário', provider: 'elevenlabs', genero: 'Masculino', sotaque: 'PT-BR', premium: true },
  { voice_id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', provider: 'elevenlabs', genero: 'Masculino', sotaque: 'Americano', premium: true },
  { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', provider: 'elevenlabs', genero: 'Feminino', sotaque: 'Americano', premium: true },
  { voice_id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', provider: 'elevenlabs', genero: 'Feminino', sotaque: 'Americano', premium: true },
  { voice_id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', provider: 'elevenlabs', genero: 'Masculino', sotaque: 'Australiano', premium: true },
  { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', provider: 'elevenlabs', genero: 'Masculino', sotaque: 'Britânico', premium: true },
  { voice_id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', provider: 'elevenlabs', genero: 'Feminino', sotaque: 'Britânico', premium: true },
  { voice_id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', provider: 'elevenlabs', genero: 'Feminino', sotaque: 'Americano', premium: true },
  { voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', provider: 'elevenlabs', genero: 'Masculino', sotaque: 'Britânico', premium: true },
  { voice_id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', provider: 'elevenlabs', genero: 'Feminino', sotaque: 'Britânico', premium: true },
  { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', provider: 'elevenlabs', genero: 'Masculino', sotaque: 'Americano', premium: true },
]

// Vozes prebuilt do Gemini TTS — funcionam no plano atual (free) e tocam na hora.
// "vibe" segue as características documentadas pelo Google para cada voz.
export const GEMINI_VOICES: CatalogVoice[] = [
  { voice_id: 'Zephyr', name: 'Zephyr', provider: 'gemini', vibe: 'Brilhante' },
  { voice_id: 'Puck', name: 'Puck', provider: 'gemini', vibe: 'Animada' },
  { voice_id: 'Charon', name: 'Charon', provider: 'gemini', vibe: 'Informativa' },
  { voice_id: 'Kore', name: 'Kore', provider: 'gemini', vibe: 'Firme' },
  { voice_id: 'Fenrir', name: 'Fenrir', provider: 'gemini', vibe: 'Empolgada' },
  { voice_id: 'Leda', name: 'Leda', provider: 'gemini', vibe: 'Jovem' },
  { voice_id: 'Orus', name: 'Orus', provider: 'gemini', vibe: 'Firme' },
  { voice_id: 'Aoede', name: 'Aoede', provider: 'gemini', vibe: 'Descontraída' },
]

// Subconjunto comprovadamente rápido pra texto LONGO (roteiro/legenda real, não amostra
// curta) com o modelo de TTS atual — é o que o Agente de Conteúdo IA e o Super Agente já
// usam. As outras 5 vozes (Charon, Fenrir, Leda, Orus, Aoede) são bem mais lentas pra
// sintetizar e, com texto longo, passam até de um maxDuration de 60s e viram 504 — únicas
// seguras pro Editor de Voz, que aceita texto livre e mais extenso que a amostra da
// Biblioteca de Vozes.
export const GEMINI_VOICES_TEXTO_LONGO: CatalogVoice[] = GEMINI_VOICES.filter((v) =>
  ['Zephyr', 'Puck', 'Kore'].includes(v.voice_id)
)

// Todas as vozes, na ordem: as que tocam na hora (Gemini) primeiro.
export const ALL_VOICES: CatalogVoice[] = [...GEMINI_VOICES, ...ELEVENLABS_VOICES]

export function findVoice(voiceId: string): CatalogVoice | undefined {
  return ALL_VOICES.find((v) => v.voice_id === voiceId)
}
