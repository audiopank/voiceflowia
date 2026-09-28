// Runtime Node.js (NÃO Edge): mesmo molde do gerar-kit-whatsapp — resposta longa +
// cadeia de modelos precisa de mais que o teto de ~25s do Edge.
export const maxDuration = 60

// NEWSLETTER SEMANAL — FATIA 1 (28/09): GERA a newsletter da semana a partir do que a
// marca JÁ publicou (Memória da Marca = posts gerados no VoiceFlow) + os fatos que o
// dono informou. Não envia nada (envio = F2, com consentimento/LGPD).
//
// Regra de ouro (a mesma do Kit): só o que a marca publicou ou informou. Oferta,
// preço, data, evento, promoção, depoimento ou número NUNCA são inventados — a
// newsletter chega na caixa de entrada do cliente do cliente, é promessa por escrito.
//
// MODELO RESERVA: cota e fila da Gemini são por modelo — principal → lites.

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    assunto: { type: 'STRING', description: 'Linha de assunto do e-mail, até 60 caracteres, sem clickbait' },
    preheader: { type: 'STRING', description: 'Texto de pré-visualização, até 90 caracteres' },
    abertura: { type: 'STRING', description: 'Parágrafo de abertura, 2 a 3 frases' },
    blocos: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          titulo: { type: 'STRING' },
          texto: { type: 'STRING' },
        },
        required: ['titulo', 'texto'],
      },
      description: '3 a 5 blocos, cada um nascido de um post publicado (ou de um fato informado)',
    },
    fechamento: { type: 'STRING', description: 'Fechamento com a chamada para ação, 1 a 2 frases' },
  },
  required: ['assunto', 'preheader', 'abertura', 'blocos', 'fechamento'],
}

const MODELOS: { id: string; tetoMs: number }[] = [
  { id: 'gemini-3.5-flash', tetoMs: 28_000 },
  { id: 'gemini-3.5-flash-lite', tetoMs: 20_000 },
  { id: 'gemini-3.1-flash-lite', tetoMs: 20_000 },
]
const ORCAMENTO_MS = 54_000
const MINIMO_TENTATIVA_MS = 8_000
const MAX_POSTS = 15

interface PostMemoria {
  gancho: string
  texto: string
}

interface Pedido {
  nicho: string
  tom: string
  fatos: string
  cta: string
  semanas: number
  posts: PostMemoria[]
}

type Tentativa =
  | { ok: true; texto: string; modelo: string }
  | { ok: false; status: number; motivo: string; modelo: string; demorou: boolean }

function buildPrompt(p: Pedido): string {
  const lista = p.posts.length
    ? p.posts.map((post, i) => `${i + 1}) GANCHO: ${post.gancho}\n   TEXTO: ${post.texto}`).join('\n')
    : '(nenhum post publicado no período)'

  return `Você escreve a NEWSLETTER SEMANAL de um negócio brasileiro, para a lista de clientes dele.
Ela vai por e-mail para pessoas REAIS: precisa soar como o dono falando e só pode afirmar o que é verdade.

NEGÓCIO: ${p.nicho}
TOM DE VOZ: ${p.tom}
PERÍODO: últimas ${p.semanas} semana(s)

FATOS DA MARCA (fonte de verdade junto com os posts — só afirme o que está aqui):
"""
${p.fatos || '(nenhum fato informado)'}
"""

POSTS QUE A MARCA PUBLICOU NO PERÍODO (a matéria-prima da newsletter):
${lista}

CHAMADA PARA AÇÃO preferida: ${p.cta || 'não informada — convide a pessoa a responder o e-mail'}

REGRAS OBRIGATÓRIAS:
- Português do Brasil, no tom pedido. Direto, caloroso, sem jargão de marketing.
- Cada BLOCO nasce de um post publicado (ou, se não houver posts, de um fato informado).
  Reescreva para e-mail — não copie a legenda inteira —, mas mantenha o que o post diz.
- 3 a 5 blocos. Agrupe posts parecidos num bloco só. Títulos curtos (até 8 palavras).
- NUNCA invente oferta, preço, desconto, data, evento, prazo, estoque, promoção,
  depoimento, número ou resultado. Se não está nos posts nem nos fatos, não existe.
- Sem posts no período: faça uma newsletter curta (2 a 3 blocos) só com os fatos, sem
  fingir novidades.
- A chamada para ação aparece UMA vez, no fechamento.
- Assunto até 60 caracteres, sem caixa alta e sem clickbait. Pré-visualização até 90.
- Sem hashtags, sem emojis em excesso (no máximo 1 no assunto e 2 no corpo).
- Esta ferramenta entrega texto + locução; nunca prometa vídeo.
- Nunca use "automação", "automatize", "automático", "robô", "bot" nem "atendimento
  automatizado" — nem em título. Quem fala com o cliente é o dono (auditoria 28/09: a
  newsletter titulou "Automatize as respostas do WhatsApp" num produto que promete "não é robô").
- Nunca afirme resultado, alcance ou prova social que não esteja nos posts/fatos
  ("estamos ajudando empresários a…", "milhares de clientes", "aumente suas vendas").
- Não cite página, vitrine, site ou link que não apareça nos posts/fatos; se citar um que
  aparece, escreva o endereço completo.

Responda apenas o JSON.`
}

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
}

async function chamarModelo(modelo: string, apiKey: string, prompt: string, timeoutMs: number): Promise<Tentativa> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    )
    if (!response.ok) {
      const errorData = await response.text()
      console.error(`Erro Gemini (gerar-newsletter, ${modelo}):`, errorData.slice(0, 600))
      let detail = ''
      try {
        detail = JSON.parse(errorData)?.error?.message || ''
      } catch {
        // corpo não era JSON
      }
      return { ok: false, status: response.status, motivo: detail || `Erro na API Gemini: ${response.status}`, modelo, demorou: false }
    }
    const data = await response.json()
    const candidato = data.candidates?.[0]
    const textPart = candidato?.content?.parts?.find((p: any) => typeof p.text === 'string')
    if (!textPart) return { ok: false, status: 502, motivo: 'Nenhuma resposta retornada pela API', modelo, demorou: false }
    if (candidato?.finishReason && candidato.finishReason !== 'STOP') {
      return { ok: false, status: 502, motivo: `resposta incompleta (${candidato.finishReason})`, modelo, demorou: false }
    }
    return { ok: true, texto: textPart.text, modelo }
  } catch (error) {
    const demorou = (error as any)?.name === 'TimeoutError' || (error as any)?.name === 'AbortError'
    console.error(`Falha ao chamar ${modelo} (gerar-newsletter):`, demorou ? 'timeout' : error)
    return { ok: false, status: demorou ? 504 : 502, motivo: demorou ? 'demorou demais' : 'falha de rede', modelo, demorou }
  }
}

function passaProReserva(t: Tentativa): boolean {
  return !t.ok && [429, 500, 502, 503, 504].includes(t.status)
}

function texto(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

// Newsletter válida = assunto + pelo menos 1 bloco com texto. Senão, falha (próximo modelo).
function montarNewsletter(bruto: string) {
  let n: any
  try {
    n = JSON.parse(bruto)
  } catch {
    return null
  }
  const blocos = Array.isArray(n?.blocos)
    ? n.blocos
        .map((b: any) => ({ titulo: texto(b?.titulo, 120), texto: texto(b?.texto, 1500) }))
        .filter((b: { titulo: string; texto: string }) => b.texto)
        .slice(0, 6)
    : []
  const out = {
    assunto: texto(n?.assunto, 120),
    preheader: texto(n?.preheader, 200),
    abertura: texto(n?.abertura, 1200),
    blocos,
    fechamento: texto(n?.fechamento, 800),
  }
  return out.assunto && out.blocos.length ? out : null
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return json({ error: 'GEMINI_API_KEY não configurada' }, 500)

    const body = await request.json()
    const semanas = Number(body?.semanas)
    const pedido: Pedido = {
      nicho: texto(body?.nicho, 200),
      tom: texto(body?.tom, 80) || 'Profissional',
      fatos: texto(body?.fatos, 2000),
      cta: texto(body?.cta, 200),
      semanas: [1, 2, 4].includes(semanas) ? semanas : 1,
      posts: Array.isArray(body?.posts)
        ? body.posts
            .map((p: any) => ({ gancho: texto(p?.gancho, 200), texto: texto(p?.texto, 500) }))
            .filter((p: PostMemoria) => p.gancho || p.texto)
            .slice(0, MAX_POSTS)
        : [],
    }

    if (!pedido.nicho) return json({ error: 'Informe o nome ou nicho do negócio' }, 400)
    if (!pedido.posts.length && !pedido.fatos) {
      return json({ error: 'Sem posts no período e sem fatos da marca: não há o que contar sem inventar. Informe os fatos ou gere conteúdo antes.' }, 400)
    }

    const prompt = buildPrompt(pedido)
    const inicio = Date.now()
    let ultima: Tentativa | null = null

    for (let i = 0; i < MODELOS.length; i++) {
      const restante = ORCAMENTO_MS - (Date.now() - inicio)
      if (restante < MINIMO_TENTATIVA_MS) break
      const { id, tetoMs } = MODELOS[i]
      const tentativa = await chamarModelo(id, apiKey, prompt, Math.min(tetoMs, restante))
      if (tentativa.ok) {
        const newsletter = montarNewsletter(tentativa.texto)
        if (newsletter) {
          if (i > 0) console.warn(`gerar-newsletter: gerada pelo RESERVA ${id}`)
          return json({ newsletter, modelo: id, reserva: i > 0, postsUsados: pedido.posts.length })
        }
        ultima = { ok: false, status: 502, motivo: 'JSON sem newsletter válida', modelo: id, demorou: false }
      } else {
        ultima = tentativa
      }
      if (!passaProReserva(ultima)) break
      console.warn(`gerar-newsletter: ${id} falhou (${ultima.status} ${ultima.motivo}) → próximo modelo`)
    }

    if (!ultima || ultima.ok) return json({ error: 'A IA demorou demais pra escrever a newsletter. Tente de novo em instantes.' }, 503)
    const status = ultima.status === 504 || ultima.demorou ? 503 : ultima.status
    return json(
      { error: ultima.demorou ? 'A IA demorou demais pra escrever a newsletter. Tente de novo em instantes.' : ultima.motivo },
      status,
    )
  } catch (error) {
    console.error('Erro ao gerar newsletter:', error)
    return json({ error: 'Erro ao gerar a newsletter' }, 500)
  }
}

export default { fetch: handler }
