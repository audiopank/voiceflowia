// Tons de voz do conteúdo (não confundir com a VOZ da locução — Zephyr/Puck/Kore).
// O `value` vai direto pro prompt como "Tom de voz obrigatório", então é ele que a IA
// lê; a `dica` existe só pro cliente saber o que está escolhendo.
//
// Fonte única: Agente e Super Agente leem daqui. Antes a lista estava duplicada nas duas
// telas e já tinha começado a divergir.
export interface TomOption {
  value: string
  dica: string
  /** Ícone do card clicável (Card Mágico); telas com <select> simplesmente ignoram. */
  emoji: string
}

export const TONS: TomOption[] = [
  { value: 'Profissional', dica: 'Sério e confiável', emoji: '💼' },
  { value: 'Divertido', dica: 'Leve e descontraído', emoji: '😄' },
  { value: 'Vendedor', dica: 'Direto, foco em conversão', emoji: '💰' },
  { value: 'Inspirador', dica: 'Motivacional, fala com a emoção', emoji: '✨' },
  { value: 'Técnico', dica: 'Autoridade, explica o porquê', emoji: '🎓' },
]

// Padrão das duas telas. Os endpoints usam o mesmo fallback quando `tom` vem vazio.
export const TOM_PADRAO = 'Profissional'

// Valores aceitos — usado pelo extrair-briefing pra não devolver um tom que o select
// não tem (select com value fora das options renderiza em branco).
export const TONS_VALIDOS = TONS.map((t) => t.value)
