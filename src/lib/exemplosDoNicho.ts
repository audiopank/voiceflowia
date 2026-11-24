// Parte PURA do 👍 "Esse funcionou" (sem Supabase — testada em tests/funcionou.test.mts).

export interface ExemploQueFuncionou { hook: string; roteiro: string; legenda: string }
const MAX_EXEMPLOS = 3

// Nicho é texto livre: "Estética", "estetica" e "Estética " são o mesmo. Usada também pela
// Memória da Marca do Super Agente — uma comparação só pras duas.
export function chaveNicho(v: string): string {
  return v.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Nichos já usados (24/11): sugestões do campo Nicho, pra memória e 👍 baterem — "Produtora de
// áudio" e "produtora de audio" viram um só; fica a grafia mais recente; até 20.
export function nichosUnicos(nichos: unknown[]): string[] {
  const vistos = new Set<string>()
  const saida: string[] = []
  for (const n of nichos) {
    if (typeof n !== 'string' || !n.trim()) continue
    const chave = chaveNicho(n)
    if (vistos.has(chave)) continue
    vistos.add(chave)
    saida.push(n.trim())
    if (saida.length >= 20) break
  }
  return saida
}

// Dos marcados (mais recentes primeiro), os do nicho, até 3.
export function exemplosDoNicho(linhas: { nicho?: unknown; hook?: unknown; roteiro?: unknown; legenda?: unknown }[], nicho: string): ExemploQueFuncionou[] {
  const alvo = chaveNicho(nicho)
  const t = (v: unknown) => (typeof v === 'string' ? v : '')
  return linhas
    .filter((l) => typeof l?.nicho === 'string' && chaveNicho(l.nicho) === alvo)
    .map((l) => ({ hook: t(l.hook), roteiro: t(l.roteiro), legenda: t(l.legenda) }))
    .filter((e) => e.hook || e.roteiro || e.legenda)
    .slice(0, MAX_EXEMPLOS)
}
