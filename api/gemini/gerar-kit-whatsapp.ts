// Runtime Node.js (NÃO Edge): o kit devolve 10-15 respostas numa chamada só —
// mais texto que os irmãos em Edge — e o Edge tem teto rígido de ~25s que IGNORA
// o `maxDuration` (cicatriz dos 504 na voz; ver text-to-speech.ts e gerar-bio.ts).
// No Node o teto vale, mas o handler precisa sair como `export default { fetch }`.
export const maxDuration = 60

// KIT DE RESPOSTAS DE WHATSAPP: as perguntas que todo negócio recebe no
// WhatsApp, respondidas na voz da marca — prontas pra virar "resposta rápida"
// no WhatsApp Business (texto agora; áudio na voz da marca é gerado sob
// demanda pela rota, uma por clique, pra não estourar a cota da voz).
//
// Regra de ouro (a mesma da casa): a IA só afirma o que os FATOS DA MARCA
// dizem. Preço, horário, endereço, prazo, garantia e promoção NUNCA são
// chutados — se o fato não foi informado, a resposta pede o dado ou
// encaminha, em vez de inventar. Resposta rápida errada no WhatsApp é
// promessa falsa entregue direto ao cliente do cliente.
//
// MODELO RESERVA (25/09, incidente nº 7 da fila da Gemini): fila e cota são POR
// MODELO — quando o gemini-3.5-flash devolve 503 "high demand", os "lite"
// respondem. A cadeia abaixo tenta o principal e, só em falha de fila/servidor/
// tempo, passa pro reserva com o MESMO prompt, schema e regra dos fatos. A
// resposta diz qual modelo gerou (`modelo`, `reserva`) pra tela contar a verdade.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    respostas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          pergunta: { type: 'STRING' },
          resposta: { type: 'STRING' }
        },
        required: ['pergunta', 'resposta']
      },
      description: 'Uma resposta por pergunta, na MESMA ordem das perguntas recebidas'
    }
  },
  required: ['respostas']
}

const MAX_PERGUNTAS = 15

// Ordem = qualidade. Teto por tentativa cabe no maxDuration de 60s mesmo que os
// três sejam usados; o orçamento total corta antes de a Vercel matar a function.
const MODELOS: { id: string; tetoMs: number }[] = [
  { id: 'gemini-3.5-flash', tetoMs: 28_000 },
  { id: 'gemini-3.5-flash-lite', tetoMs: 20_000 },
  { id: 'gemini-3.1-flash-lite', tetoMs: 20_000 }
]
const ORCAMENTO_MS = 54_000
const MINIMO_TENTATIVA_MS = 8_000

interface Marca {
  nicho: string
  tom: string
  fatos: string
  diferenciais: string
  cta: string
}

type Tentativa =
  | { ok: true; texto: string; modelo: string }
  | { ok: false; status: number; motivo: string; modelo: string; demorou: boolean }

function buildPrompt(marca: Marca, perguntas: string[]): string {
  const lista = perguntas.map((p, i) => `${i + 1}) ${p}`).join('\n')

  return `Você escreve RESPOSTAS RÁPIDAS de WhatsApp para um negócio brasileiro. Cada resposta
será salva como "resposta rápida" no WhatsApp Business e enviada a clientes REAIS — então
ela precisa soar como o dono do negócio falando, e só pode afirmar o que é verdade.

NEGÓCIO: ${marca.nicho}
TOM DE VOZ: ${marca.tom}

FATOS DA MARCA (a ÚNICA fonte de verdade — só afirme o que está aqui):
"""
${marca.fatos || '(nenhum fato informado)'}
"""

DIFERENCIAIS (use se ajudar, SEM inventar nada além do que está escrito): ${marca.diferenciais || 'não informados'}
CHAMADA PARA AÇÃO preferida do negócio: ${marca.cta || 'não informada'}

PERGUNTAS DOS CLIENTES (responda TODAS, na mesma ordem):
${lista}

REGRAS OBRIGATÓRIAS:
- Português do Brasil, formato de mensagem de WhatsApp: 2 a 4 frases, direta, calorosa, no máximo 1 emoji.
- NUNCA invente preço, horário, endereço, prazo de entrega, garantia, estoque ou promoção. Se o
  fato necessário NÃO está em FATOS DA MARCA, a resposta deve pedir o dado ou encaminhar
  (ex.: "me passa seu bairro que eu confirmo o prazo", "te mando a tabela agora mesmo") —
  jamais chutar um número ou um horário.
- Quando o fato ESTÁ nos FATOS DA MARCA, use-o exatamente como foi escrito.
- A CHAMADA PARA AÇÃO entra em NO MÁXIMO 4 das respostas — e nunca com a mesma frase duas
  vezes: reescreva com palavras diferentes a cada uso. Nas demais, termine com uma pergunta
  natural sobre o que o cliente precisa, ou simplesmente termine.
- DIFERENCIAIS: cite em no máximo 3 respostas, só onde encaixam de verdade. Repetir o
  mesmo diferencial em toda mensagem cansa o cliente e desvaloriza o diferencial.
- Cada resposta precisa soar diferente das outras: varie a abertura (nem todas começam com
  "Olá!") e o fechamento. O cliente pode receber várias delas na mesma conversa.
- Não use listas nem títulos: é uma mensagem de conversa.
- Esta ferramenta entrega texto + locução (áudio). Nunca prometa vídeo nem nada que o negócio não declarou.

Responda apenas o JSON.`
}

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

// Uma chamada a um modelo. Nunca lança: devolve ok/não-ok com o motivo — quem
// chama decide se passa pro reserva.
async function chamarModelo(modelo: string, apiKey: string, prompt: string, timeoutMs: number): Promise<Tentativa> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA
          }
        }),
        signal: AbortSignal.timeout(timeoutMs)
      }
    )

    if (!response.ok) {
      const errorData = await response.text()
      console.error(`Erro Gemini (gerar-kit-whatsapp, ${modelo}):`, errorData.slice(0, 600))
      let detail = ''
      try {
        detail = JSON.parse(errorData)?.error?.message || ''
      } catch {
        // corpo não era JSON, ignora
      }
      return { ok: false, status: response.status, motivo: detail || `Erro na API Gemini: ${response.status}`, modelo, demorou: false }
    }

    const data = await response.json()
    const textPart = data.candidates?.[0]?.content?.parts?.find((p: any) => typeof p.text === 'string')
    if (!textPart) {
      return { ok: false, status: 502, motivo: 'Nenhuma resposta retornada pela API', modelo, demorou: false }
    }
    return { ok: true, texto: textPart.text, modelo }
  } catch (error) {
    const demorou = (error as any)?.name === 'TimeoutError' || (error as any)?.name === 'AbortError'
    console.error(`Falha ao chamar ${modelo} (gerar-kit-whatsapp):`, demorou ? 'timeout' : error)
    return { ok: false, status: demorou ? 504 : 502, motivo: demorou ? 'demorou demais' : 'falha de rede', modelo, demorou }
  }
}

// Falha que justifica tentar o reserva: fila/cota/servidor/tempo. Erro de pedido
// (400, chave, 404 do modelo) é nosso e não muda de modelo pra modelo.
function passaProReserva(t: Tentativa): boolean {
  return !t.ok && [429, 500, 502, 503, 504].includes(t.status)
}

// Alinha pela POSIÇÃO com as perguntas enviadas (nunca pelo texto que a IA
// devolveu — ela pode reescrever a pergunta). Kit sem nenhuma resposta = falha.
function montarKit(texto: string, perguntas: string[]): { pergunta: string; resposta: string }[] | null {
  let parsed: any
  try {
    parsed = JSON.parse(texto)
  } catch {
    return null
  }
  const respostas = Array.isArray(parsed?.respostas) ? parsed.respostas : []
  const kit = perguntas.map((pergunta, i) => ({
    pergunta,
    resposta: typeof respostas[i]?.resposta === 'string' ? respostas[i].resposta.trim() : ''
  }))
  return kit.some((r) => r.resposta) ? kit : null
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Método não permitido' }, 405)
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return json({ error: 'GEMINI_API_KEY não configurada' }, 500)
    }

    const body = await request.json()
    const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

    const marca: Marca = {
      nicho: texto(body.nicho, 200),
      tom: texto(body.tom, 80) || 'Profissional',
      fatos: texto(body.fatos, 2000),
      diferenciais: texto(body.diferenciais, 1000),
      cta: texto(body.cta, 200)
    }

    if (!marca.nicho) {
      return json({ error: 'Informe o nome ou nicho do negócio' }, 400)
    }

    const perguntas: string[] = Array.isArray(body.perguntas)
      ? body.perguntas
          .filter((p: unknown): p is string => typeof p === 'string' && p.trim().length > 0)
          .map((p: string) => p.trim().slice(0, 200))
          .slice(0, MAX_PERGUNTAS)
      : []

    if (perguntas.length === 0) {
      return json({ error: 'Inclua pelo menos 1 pergunta' }, 400)
    }

    const prompt = buildPrompt(marca, perguntas)
    const inicio = Date.now()
    let ultima: Tentativa | null = null

    for (let i = 0; i < MODELOS.length; i++) {
      const restante = ORCAMENTO_MS - (Date.now() - inicio)
      if (restante < MINIMO_TENTATIVA_MS) break
      const { id, tetoMs } = MODELOS[i]

      const tentativa = await chamarModelo(id, apiKey, prompt, Math.min(tetoMs, restante))
      if (tentativa.ok) {
        const kit = montarKit(tentativa.texto, perguntas)
        if (kit) {
          if (i > 0) console.warn(`gerar-kit-whatsapp: gerado pelo RESERVA ${id} (principal falhou: ${ultima?.ok === false ? `${ultima.status} ${ultima.motivo}` : '?'})`)
          return json({ respostas: kit, modelo: id, reserva: i > 0 })
        }
        ultima = { ok: false, status: 502, motivo: 'JSON sem respostas', modelo: id, demorou: false }
      } else {
        ultima = tentativa
      }

      if (!passaProReserva(ultima)) break
      console.warn(`gerar-kit-whatsapp: ${id} falhou (${ultima.status} ${ultima.motivo}) → próximo modelo`)
    }

    // Nenhum modelo entregou: devolve o último motivo, honesto. 503 pra tempo
    // esgotado, que a tela traduz como "a IA demorou demais".
    if (!ultima) {
      return json({ error: 'A IA demorou demais pra escrever o kit. Tente de novo em instantes.' }, 503)
    }
    if (ultima.ok) {
      return json({ error: 'Erro ao gerar o kit de respostas' }, 500)
    }
    const status = ultima.status === 504 || ultima.demorou ? 503 : ultima.status
    return json(
      { error: ultima.demorou ? 'A IA demorou demais pra escrever o kit. Tente de novo em instantes.' : ultima.motivo },
      status
    )
  } catch (error) {
    console.error('Erro ao gerar kit de WhatsApp:', error)
    return json({ error: 'Erro ao gerar o kit de respostas' }, 500)
  }
}

export default { fetch: handler }
