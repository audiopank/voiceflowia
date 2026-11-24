// 👍 "Esse funcionou" (24/11/2026): posts que o DONO marcou como "funcionou" viram referência de
// ESTILO no pedido à IA do Super Agente. Peça pura (sem rede) — testada em tests/funcionou.test.mts.
// Fica em _lib: a Vercel não transforma em função.

export interface ExemploQueFuncionou {
  hook: string
  roteiro: string
  legenda: string
}

export const MAX_EXEMPLOS = 3

// O corpo vem do navegador: só aceita texto, corta o tamanho e descarta exemplo vazio.
export function limparExemplos(bruto: unknown): ExemploQueFuncionou[] {
  if (!Array.isArray(bruto)) return []
  const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  return bruto
    .map((e: any) => ({ hook: txt(e?.hook, 200), roteiro: txt(e?.roteiro, 600), legenda: txt(e?.legenda, 600) }))
    .filter((e) => e.hook || e.roteiro || e.legenda)
    .slice(0, MAX_EXEMPLOS)
}

// Trecho do prompt. Os exemplos ensinam o JEITO, nunca o conteúdo: fatos, preços e promessas
// deles NÃO valem (só o briefing deste pedido), e os ganchos deles entram na regra de não repetir.
export function blocoExemplos(exemplos: ExemploQueFuncionou[]): string {
  if (!exemplos.length) return ''
  const lista = exemplos
    .map((e, i) => `${i + 1}) GANCHO: ${e.hook || '—'}\n   ROTEIRO: ${e.roteiro || '—'}\n   LEGENDA: ${e.legenda || '—'}`)
    .join('\n')
  return `\n\nPOSTS QUE O DONO MARCOU COMO "FUNCIONOU" PARA ESTA MARCA (${exemplos.length}) — referência de ESTILO:
${lista}

COMO USAR ESSES EXEMPLOS:
- Imite o TOM, o TAMANHO das frases, o TIPO de gancho e o jeito da chamada para ação desses posts.
- BORDÕES da marca (expressão curta que se repete nos exemplos: uma interjeição, um jeito de chamar o
  cliente, uma chamada de fechamento) PODEM e DEVEM voltar — são a assinatura da marca.
- Fora os bordões, NÃO copie frases, NÃO repita esses ganchos e NÃO repita os mesmos ângulos (vale a regra da memória).
- Preços, números, serviços e promessas desses exemplos NÃO são fatos deste pedido: só afirme o que
  está no briefing acima. Se o exemplo cita algo que o briefing não tem, deixe de fora.`
}
