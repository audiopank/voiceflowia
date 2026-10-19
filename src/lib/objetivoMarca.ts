// OBJETIVO DA MARCA (19/10/2026) — peça 1 da "camada de IA": o cliente diz o que quer do mês e
// o Super Agente muda o PAPEL de cada post (ver regrasCta em api/gemini/generate-strategy.ts).
// '' = Equilibrado = o comportamento de sempre (Manhã relacionamento, Tarde venda).
// O objetivo muda a ESCRITA; nunca prometemos resultado ("mais vendas", "viralizar").
export type ObjetivoMarca = '' | 'alcance' | 'leads' | 'vendas'

export const OBJETIVOS_MARCA: { valor: ObjetivoMarca; rotulo: string; explica: string }[] = [
  { valor: '', rotulo: '⚖️ Equilibrado', explica: 'Manhã aproxima, Tarde vende — o padrão de sempre.' },
  { valor: 'alcance', rotulo: '📣 Alcance', explica: 'Posts pra salvar e compartilhar; venda só no último post.' },
  { valor: 'leads', rotulo: '💬 Leads', explica: 'Cada post convida a chamar no direct/WhatsApp.' },
  { valor: 'vendas', rotulo: '💰 Vendas', explica: 'Manhã tira objeções, Tarde faz a oferta.' }
]

/** Selo do card: qual papel este post cumpre dentro do objetivo do mês. */
export function papelDoPost(periodo: string, objetivo: ObjetivoMarca): string {
  const manha = periodo === 'Manhã'
  switch (objetivo) {
    case 'alcance': return manha ? '📣 Alcance: feito pra salvar' : '📣 Alcance: feito pra compartilhar'
    case 'leads': return manha ? '💬 Leads: puxa a dúvida pros comentários' : '💬 Leads: convida pra conversar'
    case 'vendas': return manha ? '💰 Vendas: tira objeção' : '💰 Vendas: oferta'
    default: return manha ? '🎯 Objetivo: Relacionamento' : '💰 Objetivo: Conversão/Venda'
  }
}
