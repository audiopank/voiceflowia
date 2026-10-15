// TRAVA DE ACENTO (15/10/2026) — 1ª peça do "checklist de qualidade por código".
//
// Por quê: quando a fila da Gemini lota, quem responde é um modelo "lite" de reserva, que às
// vezes devolve o texto inteiro SEM ACENTO ("voce", "agencia", "locucoes", "estrategia do
// mes"). Em 15/10 isso foi PUBLICADO na NewPost-IA pelo Super Agente sem nada avisar.
//
// Regra da casa: régua, não opinião. Aqui não tem IA — só palavras e terminações que em
// português NÃO existem sem acento. Palavras que existem das duas formas ("esta"/"está",
// "e"/"é", "pais"/"país", "sabia"/"sábia") ficam DE FORA de propósito: melhor deixar passar
// uma do que "corrigir" o que estava certo. A correção é a mesma lista ao contrário, então
// o que a trava aponta é exatamente o que o botão corrige.

// palavra sem acento → com acento (minúsculas). Só formas que NÃO existem sem acento.
const PALAVRAS: Record<string, string> = {
  voce: 'você', voces: 'vocês', nao: 'não', entao: 'então', tambem: 'também', ate: 'até',
  ja: 'já', so: 'só', alem: 'além', porem: 'porém', atraves: 'através', apos: 'após',
  mes: 'mês', tres: 'três', ninguem: 'ninguém', alguem: 'alguém', acao: 'ação', acoes: 'ações',
  audio: 'áudio', audios: 'áudios', video: 'vídeo', videos: 'vídeos',
  // Exceção consciente: "agencia" também é verbo (agenciar), mas é raríssimo em post e
  // "agência" é a palavra do público do VoiceFlow — foi a que saiu errada em 15/10.
  agencia: 'agência', agencias: 'agências',
  estrategia: 'estratégia', estrategias: 'estratégias',
  estrategico: 'estratégico', estrategicos: 'estratégicos', estrategica: 'estratégica',
  estrategicas: 'estratégicas', conteudo: 'conteúdo', conteudos: 'conteúdos',
  negocios: 'negócios', servico: 'serviço', servicos: 'serviços', preco: 'preço',
  precos: 'preços', comentario: 'comentário', comentarios: 'comentários',
  unico: 'único', unica: 'única', unicos: 'únicos', unicas: 'únicas', proximo: 'próximo',
  proxima: 'próxima', rapido: 'rápido', rapida: 'rápida',
  facil: 'fácil', faceis: 'fáceis', otimo: 'ótimo', otima: 'ótima', musica: 'música',
  familia: 'família', cafe: 'café', presenca: 'presença', comecar: 'começar',
  comeca: 'começa', facam: 'façam', dificil: 'difícil', util: 'útil', uteis: 'úteis',
  automatico: 'automático', automatica: 'automática', tecnico: 'técnico',
  basico: 'básico', basica: 'básica', classico: 'clássico', magico: 'mágico',
  logico: 'lógico', historia: 'história', nivel: 'nível', niveis: 'níveis',
  // -ência: SÓ substantivos que nunca são verbo. Regra genérica "-encia" ficou de fora porque
  // pega verbo certo: "diferencia", "influencia", "potencia", "silencia", "evidencia" (guard 15/10).
  experiencia: 'experiência', experiencias: 'experiências', frequencia: 'frequência',
  consequencia: 'consequência', tendencia: 'tendência', tendencias: 'tendências',
  paciencia: 'paciência', ciencia: 'ciência', excelencia: 'excelência', essencia: 'essência',
  transparencia: 'transparência', competencia: 'competência', eficiencia: 'eficiência',
  urgencia: 'urgência', emergencia: 'emergência', audiencia: 'audiência',
  conveniencia: 'conveniência', referencia: 'referência', referencias: 'referências',
  independencia: 'independência'
}
// FORA de propósito (existem sem acento, quase sempre como verbo): faca (o objeto), peca
// (pecar), publico/pratico/pratica/numero/pagina/negocio (eu publico, eu pratico…), esta, e,
// pais, diferencia/influencia/potencia (verbos).

// Terminações que em português sempre têm acento/til/cedilha: -cao/-coes (locução, locuções),
// -ao/-oes (padrão, botões), -avel/-ivel (confiável, incrível). Mínimo de 3 letras antes pra
// não pegar sigla, nome curto nem palavra estrangeira curta ("ciao", "shoes").
// -cao/-coes valem até em palavra com maiúscula no meio da frase ("Producao de Audio" foi o
// caso real de 15/10); as outras não, porque aí costuma ser marca ou nome estrangeiro.
const TERMINACOES_SEMPRE: { re: RegExp; troca: (m: string) => string }[] = [
  { re: /^([a-z]{2,})cao$/, troca: (r) => `${r}ção` },
  { re: /^([a-z]{2,})coes$/, troca: (r) => `${r}ções` }
]
const TERMINACOES: { re: RegExp; troca: (m: string) => string }[] = [
  { re: /^([a-z]{3,})ao$/, troca: (r) => `${r}ão` },
  { re: /^([a-z]{3,})oes$/, troca: (r) => `${r}ões` },
  { re: /^([a-z]{3,})avel$/, troca: (r) => `${r}ável` },
  { re: /^([a-z]{3,})ivel$/, troca: (r) => `${r}ível` }
]

// `nomeProprio` = palavra com maiúscula no MEIO da frase (provável marca/nome: "Bilbao",
// "Unravel"). Nela vale a lista de palavras conhecidas e só as terminações -cao/-coes.
function corrigirMinuscula(p: string, nomeProprio: boolean): string | null {
  if (PALAVRAS[p]) return PALAVRAS[p]
  if (p === 'cacao') return null // virava "cação" (o peixe) — cacau em inglês/espanhol
  for (const t of nomeProprio ? TERMINACOES_SEMPRE : [...TERMINACOES_SEMPRE, ...TERMINACOES]) {
    const m = p.match(t.re)
    if (m) return t.troca(m[1])
  }
  return null
}

// Mantém o jeito que a palavra estava escrita: "VOCE" → "VOCÊ", "Voce" → "Você".
function manterCaixa(original: string, corrigida: string): string {
  if (original === original.toUpperCase()) return corrigida.toUpperCase()
  if (original[0] === original[0].toUpperCase()) return corrigida[0].toUpperCase() + corrigida.slice(1)
  return corrigida
}

// Link, e-mail e @perfil NUNCA são mexidos: "padaria-do-joao.com.br/promocao" virando
// "joão/promoção" seria link quebrado no CTA (guard 15/10). O texto é fatiado e esses
// pedaços passam intactos.
// Inclui domínio sem www/http ("loja.com.br/colecao-verao"), comum em post brasileiro.
const INTOCAVEL =
  /(https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|[\w-]+(?:\.[\w-]+)*\.(?:com|br|net|org|app|me|io|shop|store|site|online|link)\b(?:\/\S*)?|[@#][\w.]+)/gi

// Palavra = só letras SEM acento (a que tem acento já está certa).
const PALAVRA_SEM_ACENTO = /(^|[^\p{L}\p{N}_])([A-Za-z]+)(?=$|[^\p{L}\p{N}_])/gu

function percorrer(texto: string, aoAchar: (palavra: string, certa: string) => string): string {
  return (texto || '')
    .split(INTOCAVEL)
    .map((pedaco, k) => {
      if (k % 2 === 1) return pedaco // link/e-mail/@/# — intacto
      return pedaco.replace(PALAVRA_SEM_ACENTO, (inteiro, antes: string, palavra: string, pos: number) => {
        const anterior = (pedaco.slice(0, pos) + antes).trimEnd()
        const inicioDeFrase = anterior === '' || /[.!?:\n"“(]$/.test(anterior)
        const nomeProprio = !inicioDeFrase && /^[A-Z][a-z]/.test(palavra)
        const certa = corrigirMinuscula(palavra.toLowerCase(), nomeProprio)
        return certa ? antes + aoAchar(palavra, certa) : inteiro
      })
    })
    .join('')
}

/** Palavras do texto que precisam de acento (sem repetir), em minúsculas. */
export function palavrasSemAcento(texto: string): string[] {
  const achadas = new Set<string>()
  percorrer(texto, (palavra, certa) => {
    achadas.add(palavra.toLowerCase())
    return certa
  })
  return [...achadas]
}

/** O mesmo texto com os acentos que a trava sabe corrigir. O resto fica intacto. */
export function corrigirAcentos(texto: string): string {
  return percorrer(texto, (palavra, certa) => manterCaixa(palavra, certa))
}
