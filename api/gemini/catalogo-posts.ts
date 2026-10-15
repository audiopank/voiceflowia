// Runtime EDGE de propósito: o projeto está no teto de 12 funções Node do plano Hobby
// (ver memória "Vercel produção") — Edge não conta. O teto rígido do Edge é ~25s e
// IGNORA maxDuration, por isso a chamada é de UM produto por vez (o texto é curto) e o
// orçamento total abaixo fica em 22s.
import { gerarComReserva, respostaDeFalha } from '../_lib/geminiReserva.js'

export const config = {
  runtime: 'edge'
}

// CATÁLOGO → POSTS (06/10/2026), Degrau 1 do VoiceFlow-agente. Este endpoint só
// ESCREVE; quem confere é o código em src/lib/conferirCatalogo.ts (na tela). O ciclo:
//   1. a tela pede o post de um produto;
//   2. o conferidor checa preço, números e promessas contra o catálogo e os fatos;
//   3. se falhou, a tela chama de novo com `falhas` + `anterior` → a IA reescreve só o
//      que estava errado (até 2 reescritas). Nada é aprovado sem passar na conferência.
// Regra de ouro da casa: a IA só afirma o que o catálogo e os FATOS DA MARCA dizem.
//
// Modelo reserva: api/_lib/geminiReserva (perfil curto, 22s — Edge). Fila e cota são POR
// MODELO; em fila/tempo/formato, o mesmo prompt vai pro próximo da cadeia.

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    gancho: { type: 'STRING', description: 'Frase curta de abertura que para o dedo (até 12 palavras)' },
    legenda: { type: 'STRING', description: 'Legenda completa do post, com chamada para ação e 3 a 5 hashtags no fim' },
    locucao: { type: 'STRING', description: 'Texto para ser FALADO em áudio (30 a 60 palavras), sem hashtags, sem emoji' }
  },
  required: ['gancho', 'legenda', 'locucao']
}

interface Pedido {
  nicho: string
  tom: string
  fatos: string
  cta: string
  item: { nome: string; preco: string; detalhes: string }
  ganchosUsados: string[]
  falhas: string[]
  anterior: { gancho: string; legenda: string; locucao: string } | null
}

function buildPrompt(p: Pedido): string {
  const usados = p.ganchosUsados.length
    ? `\nGANCHOS JÁ USADOS em outros posts deste catálogo (o seu precisa ser DIFERENTE, com outro ângulo):\n${p.ganchosUsados.map((g) => `- ${g}`).join('\n')}\n`
    : ''

  const correcao = p.anterior && p.falhas.length
    ? `
ESTA É UMA REESCRITA. A versão anterior foi REPROVADA pela conferência automática:
${p.falhas.map((f) => `- ${f}`).join('\n')}

Versão anterior (mantenha o que estava bom, corrija SÓ os problemas acima):
GANCHO: ${p.anterior.gancho}
LEGENDA: ${p.anterior.legenda}
LOCUÇÃO: ${p.anterior.locucao}
`
    : ''

  return `Você é o social media de um negócio brasileiro e vai escrever UM post para Instagram/Facebook
sobre UM produto do catálogo, em português do Brasil.

NEGÓCIO: ${p.nicho}
TOM DE VOZ: ${p.tom}
CHAMADA PARA AÇÃO preferida: ${p.cta || 'não informada (use algo simples como chamar no direct ou no WhatsApp)'}

PRODUTO (a fonte de verdade do post):
- Nome: ${p.item.nome}
- Preço: ${p.item.preco || '(não informado)'}
- Detalhes: ${p.item.detalhes || '(nenhum)'}

FATOS DA MARCA (também valem como fonte):
"""
${p.fatos || '(nenhum fato informado)'}
"""
${usados}${correcao}
REGRAS OBRIGATÓRIAS (o post passa por uma conferência automática antes de o dono aprovar):
- Só afirme o que está no PRODUTO ou nos FATOS DA MARCA. Nada de característica inventada.
- Preço: se citar, escreva EXATAMENTE como no catálogo, em algarismos com "R$" (ex.: R$ 12,00).
  Se o preço não foi informado, NÃO cite preço nenhum.
- Todo número que você escrever (quantidade, peso, %, parcelas, tempo) precisa estar no PRODUTO
  ou nos FATOS. Na locução também: números em algarismos, nunca por extenso.
- NUNCA prometa frete grátis, entrega, desconto, promoção, oferta, parcelamento, garantia,
  estoque, "últimas unidades", "só hoje", brinde ou "grátis" se isso não estiver escrito no
  PRODUTO ou nos FATOS.
- Nada de fama inventada: "o mais pedido", "o mais vendido", "o melhor da cidade", "famoso",
  "sucesso de vendas" só se estiver escrito no PRODUTO ou nos FATOS.
- GANCHO: até 12 palavras, sem preço, desperta curiosidade ou desejo.
- LEGENDA: 300 a 600 caracteres, frases curtas, no máximo 3 emojis, termina com a chamada para
  ação e depois 3 a 5 hashtags relevantes (hashtag sem número).
- LOCUÇÃO: 30 a 60 palavras para ser lida em voz alta como anúncio curto: natural, sem
  hashtag, sem emoji, sem "link na bio".
- Esta ferramenta entrega texto e locução (áudio). Nunca mencione vídeo.

Responda apenas o JSON.`
}

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function montarPost(texto: string): { gancho: string; legenda: string; locucao: string } | null {
  let parsed: any
  try {
    parsed = JSON.parse(texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
  } catch {
    return null
  }
  const t = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const post = { gancho: t(parsed?.gancho), legenda: t(parsed?.legenda), locucao: t(parsed?.locucao) }
  return post.legenda ? post : null
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Método não permitido' }, 405)
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return json({ error: 'GEMINI_API_KEY não configurada' }, 500)
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return json({ error: 'Pedido inválido' }, 400)
    }
    const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
    const lista = (v: unknown, maxItens: number, maxTam: number) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim().slice(0, maxTam)).slice(0, maxItens) : []

    const itemBruto = (body as any).item ?? {}
    const anteriorBruto = (body as any).anterior
    const pedido: Pedido = {
      nicho: texto((body as any).nicho, 200),
      tom: texto((body as any).tom, 80) || 'Profissional',
      fatos: texto((body as any).fatos, 2000),
      cta: texto((body as any).cta, 200),
      item: { nome: texto(itemBruto.nome, 120), preco: texto(itemBruto.preco, 40), detalhes: texto(itemBruto.detalhes, 400) },
      ganchosUsados: lista((body as any).ganchosUsados, 6, 160),
      falhas: lista((body as any).falhas, 6, 300),
      anterior: anteriorBruto && typeof anteriorBruto === 'object'
        ? { gancho: texto(anteriorBruto.gancho, 300), legenda: texto(anteriorBruto.legenda, 1500), locucao: texto(anteriorBruto.locucao, 800) }
        : null
    }

    if (!pedido.nicho) return json({ error: 'Informe o nome ou nicho do negócio' }, 400)
    if (!pedido.item.nome) return json({ error: 'Produto sem nome' }, 400)

    const r = await gerarComReserva({
      apiKey,
      rotulo: 'catalogo-posts',
      perfil: 'curto',
      corpo: {
        contents: [{ parts: [{ text: buildPrompt(pedido) }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA }
      },
      aceita: (texto) => montarPost(texto) !== null
    })
    if (!r.ok) return respostaDeFalha(r)
    return json({ post: montarPost(r.texto), modelo: r.modelo, reserva: r.reserva })
  } catch (error) {
    console.error('Erro em catalogo-posts:', error)
    return json({ error: 'Erro ao escrever o post' }, 500)
  }
}
