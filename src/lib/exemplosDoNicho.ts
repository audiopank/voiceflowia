// Parte PURA do 👍 "Esse funcionou" (sem Supabase — testada em tests/funcionou.test.mts).

export interface ExemploQueFuncionou { hook: string; roteiro: string; legenda: string }
const MAX_EXEMPLOS = 3

// Nicho é texto livre: "Estética", "estetica" e "Estética " são o mesmo. Usada também pela
// Memória da Marca do Super Agente — uma comparação só pras duas.
export function chaveNicho(v: string): string {
  return v.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
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
