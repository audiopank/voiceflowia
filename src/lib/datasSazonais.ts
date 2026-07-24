// Datas comemorativas do varejo/marketing BR — a base dos "ganchos sazonais".
// Servem pra: (1) empurrar o cliente de volta no meio do mês ("Dia dos Pais em X
// dias — gere posts") e (2) injetar a data na geração do Super Agente.
//
// Regra de ouro do projeto: nada de fake. As datas são reais e calculadas de
// verdade (inclusive as móveis: 2º domingo de maio, última sexta de novembro,
// Carnaval/Páscoa via Computus). "diasFaltando" sai da data real vs. hoje.

const DAY_MS = 24 * 60 * 60 * 1000

export interface DataSazonal {
  nome: string
  emoji: string
  // Como a data cai em um ano específico. Recebe o ano, devolve a Date (meia-noite local).
  quando: (ano: number) => Date
}

export interface DataProxima {
  nome: string
  emoji: string
  data: Date
  diasFaltando: number // 0 = é hoje
}

// Meia-noite local, pra contar dias inteiros sem o horário atrapalhar.
function meiaNoite(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// Data fixa: mês (1-based, pra leitura) e dia.
function fixa(mes1: number, dia: number) {
  return (ano: number) => new Date(ano, mes1 - 1, dia)
}

// N-ésimo dia-da-semana de um mês (ex: 2º domingo de maio). weekday: 0=domingo.
function nthDiaSemana(mes1: number, weekday: number, n: number) {
  return (ano: number) => {
    const primeiro = new Date(ano, mes1 - 1, 1)
    const offset = (weekday - primeiro.getDay() + 7) % 7
    return new Date(ano, mes1 - 1, 1 + offset + (n - 1) * 7)
  }
}

// Último dia-da-semana de um mês (ex: última sexta de novembro = Black Friday).
function ultimoDiaSemana(mes1: number, weekday: number) {
  return (ano: number) => {
    const ultimoDiaDoMes = new Date(ano, mes1, 0) // dia 0 do mês seguinte
    const offset = (ultimoDiaDoMes.getDay() - weekday + 7) % 7
    return new Date(ano, mes1 - 1, ultimoDiaDoMes.getDate() - offset)
  }
}

// Domingo de Páscoa (Computus / algoritmo de Meeus para o calendário gregoriano).
function pascoa(ano: number): Date {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31) // 3=março, 4=abril
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(ano, mes - 1, dia)
}

// Datas em dias relativos à Páscoa (Carnaval = terça, 47 dias antes).
function relativaPascoa(offsetDias: number) {
  return (ano: number) => new Date(pascoa(ano).getTime() + offsetDias * DAY_MS)
}

// Calendário comercial BR. Foco no que move venda pra PME/varejo local.
export const DATAS_SAZONAIS: DataSazonal[] = [
  { nome: 'Dia da Mulher', emoji: '💜', quando: fixa(3, 8) },
  { nome: 'Dia do Consumidor', emoji: '🛍️', quando: fixa(3, 15) },
  { nome: 'Carnaval', emoji: '🎉', quando: relativaPascoa(-47) },
  { nome: 'Páscoa', emoji: '🐰', quando: pascoa },
  { nome: 'Dia das Mães', emoji: '💐', quando: nthDiaSemana(5, 0, 2) },
  { nome: 'Dia dos Namorados', emoji: '❤️', quando: fixa(6, 12) },
  { nome: 'Dia dos Avós', emoji: '👵', quando: fixa(7, 26) },
  { nome: 'Dia dos Pais', emoji: '👔', quando: nthDiaSemana(8, 0, 2) },
  { nome: 'Independência do Brasil', emoji: '🇧🇷', quando: fixa(9, 7) },
  { nome: 'Dia do Cliente', emoji: '🤝', quando: fixa(9, 15) },
  { nome: 'Dia das Crianças', emoji: '🧸', quando: fixa(10, 12) },
  { nome: 'Dia dos Professores', emoji: '📚', quando: fixa(10, 15) },
  { nome: 'Halloween', emoji: '🎃', quando: fixa(10, 31) },
  { nome: 'Black Friday', emoji: '🖤', quando: ultimoDiaSemana(11, 5) },
  { nome: 'Natal', emoji: '🎄', quando: fixa(12, 25) },
  { nome: 'Réveillon / Ano Novo', emoji: '🎆', quando: fixa(12, 31) },
]

// Próximas datas dentro de `dentroDeDias`, ordenadas da mais próxima pra mais longe.
// `base` existe pra testes; em produção é o "hoje" do navegador.
export function proximasDatasSazonais(dentroDeDias = 45, base: Date = new Date()): DataProxima[] {
  const hoje = meiaNoite(base)
  const anoAtual = hoje.getFullYear()

  const out: DataProxima[] = []
  for (const d of DATAS_SAZONAIS) {
    // Ocorrência deste ano; se já passou, pega a do ano que vem.
    let data = meiaNoite(d.quando(anoAtual))
    if (data.getTime() < hoje.getTime()) data = meiaNoite(d.quando(anoAtual + 1))
    const diasFaltando = Math.round((data.getTime() - hoje.getTime()) / DAY_MS)
    if (diasFaltando >= 0 && diasFaltando <= dentroDeDias) {
      out.push({ nome: d.nome, emoji: d.emoji, data, diasFaltando })
    }
  }
  return out.sort((a, b) => a.diasFaltando - b.diasFaltando)
}

// "hoje", "amanhã", "em 12 dias" — texto curto pro selo de contagem.
export function textoContagem(diasFaltando: number): string {
  if (diasFaltando === 0) return 'é hoje'
  if (diasFaltando === 1) return 'amanhã'
  return `em ${diasFaltando} dias`
}
