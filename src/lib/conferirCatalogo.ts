// CATÁLOGO → POSTS (06/10/2026): o CONFERIDOR. É o "prova o que fez" do agente —
// e é CÓDIGO, não IA: a IA escreve, este arquivo confere cada post contra o catálogo e
// os fatos da marca antes de o cliente poder aprovar. IA conferindo IA erra junto;
// regex não inventa. Três checagens:
//   1. Preço: todo valor em R$ citado no post precisa existir no item ou nos fatos.
//   2. Números: todo número do post (%, parcelas, gramas, "3 sabores") precisa estar
//      no item ou nos fatos — número é a mentira mais fácil de passar despercebida.
//   3. Promessas: frete grátis, desconto, promoção, parcelamento, garantia, estoque,
//      urgência, brinde — só se a palavra tiver lastro no item ou nos fatos.
// O que falha volta pra IA como lista de correções (o ciclo do agente) e, se ainda
// falhar, o cartão fica vermelho e não pode ser aprovado até o cliente corrigir.

export interface ItemCatalogo {
  nome: string
  preco: string
  detalhes: string
}

export interface PostCatalogo {
  gancho: string
  legenda: string
  locucao: string
}

export interface Checagem {
  ok: boolean
  texto: string
}

export interface Conferencia {
  aprovado: boolean
  checagens: Checagem[]
  /** Frases curtas pra devolver à IA na reescrita (vazio = passou). */
  falhas: string[]
}

export const MAX_ITENS_CATALOGO = 6

// Sem acento e minúsculo: "Promoção" e "promocao" são a mesma promessa.
function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

// "1.299,90" / "49,9" / "49.90" / "49" → centavos. null se não for número.
function centavos(bruto: string): number | null {
  let s = bruto.trim()
  if (!s) return null
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '') // 1.299 = mil duzentos e noventa e nove
  }
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

function formatarReais(c: number): string {
  return 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const RE_DINHEIRO = /r\$\s*(\d[\d.]*(?:,\d{1,2})?)|(\d[\d.]*(?:,\d{1,2})?)\s*reais/gi

function valoresEmReais(texto: string): number[] {
  const out: number[] = []
  for (const m of texto.matchAll(RE_DINHEIRO)) {
    const c = centavos(m[1] ?? m[2] ?? '')
    if (c != null) out.push(c)
  }
  return out
}

// Números por extenso (teste real 06/10: a locução escreveu "serve dez pessoas" — era
// verdade, mas um número inventado por extenso passaria batido). "um/uma" ficam de
// fora: são artigo na maioria das frases. Compostos com "e" somam ("vinte e cinco").
const EXTENSO: Record<string, number> = {
  dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16,
  dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
  sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200,
  trezentos: 300, quinhentos: 500, mil: 1000,
}

function numerosPorExtenso(texto: string): number[] {
  const palavras = normalizar(texto).split(/[^a-z]+/).filter(Boolean)
  const out: number[] = []
  let soma: number | null = null
  for (let i = 0; i < palavras.length; i++) {
    const v = EXTENSO[palavras[i]]
    if (v != null) {
      soma = (soma ?? 0) + v
      continue
    }
    if (palavras[i] === 'e' && soma != null && EXTENSO[palavras[i + 1]] != null) continue
    if (soma != null) out.push(soma)
    soma = null
  }
  if (soma != null) out.push(soma)
  return out
}

// Todos os números "soltos" de um texto, normalizados ("49,90" e "49.90" → "49.9";
// "dez" → "10"). Dinheiro sai antes (checagem própria); hashtag não conta.
function numerosSoltos(texto: string): string[] {
  const semDinheiro = texto.replace(RE_DINHEIRO, ' ').replace(/#[\p{L}\p{N}_]+/gu, ' ')
  const out: string[] = []
  for (const m of semDinheiro.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const c = centavos(m[0])
    out.push(c == null ? m[0] : String(c / 100))
  }
  for (const n of numerosPorExtenso(semDinheiro)) out.push(String(n))
  return out
}

// Promessas que só podem aparecer com lastro. `re` roda sobre texto normalizado.
const PROMESSAS: { rotulo: string; re: RegExp }[] = [
  { rotulo: 'frete grátis', re: /frete\s+gratis/ },
  { rotulo: 'entrega', re: /\bentreg/ },
  { rotulo: 'desconto', re: /\bdescont/ },
  { rotulo: 'promoção / oferta', re: /\bpromo|\boferta/ },
  { rotulo: 'parcelamento', re: /\bparcel|sem juros/ },
  { rotulo: 'garantia', re: /\bgaranti/ },
  { rotulo: 'estoque / últimas unidades', re: /\bestoque|ultimas unidades|pronta entrega/ },
  { rotulo: 'urgência (só hoje, último dia…)', re: /so hoje|ultimo dia|ultimos dias|tempo limitado|corre que acaba|enquanto durar/ },
  { rotulo: 'brinde / grátis', re: /\bbrinde|(?<!frete )\bgratis/ },
  // Prova social sem lastro (teste real 06/10: "a torta mais pedida da cidade", "o nosso
  // famoso bolo de pote" — a IA inventa fama com a mesma facilidade que inventa preço).
  { rotulo: 'fama / superlativo (mais pedido, o melhor, famoso…)', re: /mais (pedid|vendid|procurad|amad|famos)|\bo melhor\b|\ba melhor\b|\bfamos[oa]s?\b|numero 1\b|\bcampe[aã]o|\blider\b|sucesso de vendas/ },
]

export function conferirPost(post: PostCatalogo, item: ItemCatalogo, indice: number, fatos: string): Conferencia {
  const textoPost = [post.gancho, post.legenda, post.locucao].join('\n')
  const fonte = [item.nome, item.preco, item.detalhes, fatos].join('\n')
  const fonteNorm = normalizar(fonte)
  const postNorm = normalizar(textoPost)
  const checagens: Checagem[] = []
  const falhas: string[] = []
  const rotuloItem = `item ${indice + 1} do catálogo`

  // 1. Preço. O campo "preço" vale mesmo sem "R$" escrito ("49,90").
  const precosFonte = new Set<number>(valoresEmReais(fonte))
  const precoDoCampo = centavos(item.preco.replace(/r\$\s*/i, '').trim())
  if (precoDoCampo != null) precosFonte.add(precoDoCampo)
  const precosPost = [...new Set(valoresEmReais(textoPost))]
  const precosForaDoCatalogo = precosPost.filter((p) => !precosFonte.has(p))
  if (precosForaDoCatalogo.length > 0) {
    const certo = precoDoCampo != null ? ` O preço do catálogo é ${formatarReais(precoDoCampo)}.` : ' O catálogo não traz esse valor.'
    const lista = precosForaDoCatalogo.map(formatarReais).join(', ')
    checagens.push({ ok: false, texto: `Preço ${lista} não está no catálogo nem nos fatos.${certo}` })
    falhas.push(`O texto cita ${lista}, que não existe no catálogo.${certo} Use só o preço do catálogo, escrito igual.`)
  } else if (precosPost.length > 0) {
    checagens.push({ ok: true, texto: `Preço ${precosPost.map(formatarReais).join(', ')} confere com o ${rotuloItem}` })
  } else {
    checagens.push({ ok: true, texto: precoDoCampo != null ? 'O post não cita preço (nada a conferir)' : 'Sem preço no catálogo e o post não inventou um' })
  }

  // 2. Números soltos.
  const numerosFonte = new Set(numerosSoltos(fonte))
  for (const c of precosFonte) numerosFonte.add(String(c / 100))
  const numerosFora = [...new Set(numerosSoltos(textoPost))].filter((n) => !numerosFonte.has(n))
  if (numerosFora.length > 0) {
    checagens.push({ ok: false, texto: `Número sem lastro: ${numerosFora.join(', ')}` })
    falhas.push(`O texto usa o(s) número(s) ${numerosFora.join(', ')}, que não aparecem no catálogo nem nos fatos. Tire ou troque por algo que esteja lá.`)
  } else {
    checagens.push({ ok: true, texto: 'Nenhum número fora do catálogo e dos fatos' })
  }

  // 3. Promessas sem lastro.
  const semLastro = PROMESSAS.filter((p) => p.re.test(postNorm) && !p.re.test(fonteNorm)).map((p) => p.rotulo)
  if (semLastro.length > 0) {
    checagens.push({ ok: false, texto: `Promessa sem lastro: ${semLastro.join(', ')}` })
    falhas.push(`O texto promete ${semLastro.join(', ')}, mas isso não está no catálogo nem nos fatos da marca. Remova essa promessa.`)
  } else {
    checagens.push({ ok: true, texto: 'Nenhuma promessa sem lastro (frete, desconto, parcelamento, garantia, estoque, urgência)' })
  }

  // Post vazio nunca é aprovável.
  if (!post.legenda.trim()) {
    checagens.push({ ok: false, texto: 'Legenda vazia' })
    falhas.push('A legenda veio vazia.')
  }

  return { aprovado: falhas.length === 0, checagens, falhas }
}

// "Bolo de pote — R$ 12,00 — 4 sabores" → item. Aceita tab, ;, |, " - ", " — ", " – ".
// A parte que parece preço vira `preco`; o resto (depois do nome) vira `detalhes`.
//
// LEITURA ESPERTA (21/10/2026 — caso real do Mestre: colou o catálogo do Locutores com o nome
// numa linha e o preço na de baixo, misturado com o texto de "como funciona" → virou 22
// "produtos" e o post nº 1 saiu sobre "Você preenche o briefing"). Regras fixas, sem IA:
//   1. linha que é SÓ preço ("R$ 127,00") gruda no produto de cima, se ele ainda não tem preço;
//   2. linha sem nenhuma letra ("2", emoji, "---") é ignorada;
//   3. frase de texto corrido (termina em . ! ? : ou passa de 10 palavras) sem preço é ignorada;
//   4. preço no fim da linha sem separador ("Spot 30s R$ 127,00") é reconhecido.
// O que foi ignorado volta em `ignoradas` pra tela MOSTRAR — nada some escondido.
const PRECO = /^(r\$\s*)?\d[\d.]*(,\d{1,2})?(\s*reais)?$/i
const PRECO_NO_FIM = /\s+(r\$\s*\d[\d.]*(?:,\d{1,2})?)$/i
// Preço numa linha SOZINHA precisa parecer dinheiro (R$, centavos ou "reais"): um "2" solto é
// número de passo de lista, não preço (caso real: grudou "2" no item "Você preenche o briefing").
const PRECO_SOZINHO = /^(r\$\s*\d[\d.]*(,\d{1,2})?|\d[\d.]*,\d{2}|\d[\d.]*(,\d{1,2})?\s*reais)$/i

export interface LeituraCatalogo {
  itens: ItemCatalogo[]
  ignoradas: string[]
}

export function lerCatalogoDetalhado(texto: string): LeituraCatalogo {
  const itens: ItemCatalogo[] = []
  const ignoradas: string[] = []
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  // Guard 21/10: o preço só gruda no produto IMEDIATAMENTE acima. Se a linha de cima foi
  // ignorada, o preço não pode "pular" pro produto anterior — a conferência aprovaria o preço
  // errado ("Pão de mel / Brigadeiro gourmet! / R$ 5,00" dava R$ 5,00 ao Pão de mel).
  let anteriorFoiItem = false
  const ignorar = (l: string) => { ignoradas.push(l); anteriorFoiItem = false }
  for (let n = 0; n < linhas.length; n++) {
    const linha = linhas[n]
    // 1. só preço → gruda no produto logo acima
    if (PRECO_SOZINHO.test(linha)) {
      const anterior = itens[itens.length - 1]
      if (anteriorFoiItem && anterior && !anterior.preco) { anterior.preco = linha.slice(0, 40); anteriorFoiItem = false }
      else ignorar(linha)
      continue
    }
    // 2. sem letra nenhuma
    if (!/\p{L}/u.test(linha)) { ignorar(linha); continue }
    // A linha de baixo é um preço sozinho? Então esta é o nome do produto (não é texto corrido).
    const precoNaProxima = n + 1 < linhas.length && PRECO_SOZINHO.test(linhas[n + 1])
    const partes = linha.split(/\t|;|\||\s[-—–]\s/).map((p) => p.trim()).filter(Boolean)
    if (partes.length === 0) continue
    let [nome, ...resto] = partes
    // numeração de lista ("1. ", "2) ") não faz parte do nome
    nome = nome.replace(/^\d{1,2}[.)]\s+/, '')
    // 4. preço colado no fim do nome, sem separador
    const fim = resto.length === 0 ? nome.match(PRECO_NO_FIM) : null
    if (fim && fim.index !== undefined) { resto = [fim[1]]; nome = nome.slice(0, fim.index).trim() }
    const iPreco = resto.findIndex((p) => PRECO.test(p))
    const preco = iPreco >= 0 ? resto[iPreco] : ''
    // 3. frase de texto corrido, sem preço e sem separador → não é produto
    if (!preco && !precoNaProxima && resto.length === 0 && (/[.!?…:]$/.test(nome) || nome.split(/\s+/).length > 10)) { ignorar(linha); continue }
    const detalhes = resto.filter((_, i) => i !== iPreco).join(' · ')
    itens.push({ nome: nome.slice(0, 120), preco: preco.slice(0, 40), detalhes: detalhes.slice(0, 400) })
    anteriorFoiItem = true
  }
  return { itens, ignoradas }
}

export function lerCatalogo(texto: string): ItemCatalogo[] {
  return lerCatalogoDetalhado(texto).itens
}
