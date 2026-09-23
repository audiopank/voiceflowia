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

interface Marca {
  nicho: string
  tom: string
  fatos: string
  diferenciais: string
  cta: string
}

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

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY não configurada' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
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
      return new Response(
        JSON.stringify({ error: 'Informe o nome ou nicho do negócio' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const perguntas: string[] = Array.isArray(body.perguntas)
      ? body.perguntas
          .filter((p: unknown): p is string => typeof p === 'string' && p.trim().length > 0)
          .map((p: string) => p.trim().slice(0, 200))
          .slice(0, MAX_PERGUNTAS)
      : []

    if (perguntas.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Inclua pelo menos 1 pergunta' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(marca, perguntas) }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA
          }
        }),
        signal: AbortSignal.timeout(45_000)
      }
    )

    if (!response.ok) {
      const errorData = await response.text()
      console.error('Erro Gemini (gerar-kit-whatsapp):', errorData)
      let detail = ''
      try {
        detail = JSON.parse(errorData)?.error?.message || ''
      } catch {
        // corpo não era JSON, ignora
      }
      return new Response(
        JSON.stringify({ error: detail || `Erro na API Gemini: ${response.status}` }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const data = await response.json()
    const textPart = data.candidates?.[0]?.content?.parts?.find((p: any) => typeof p.text === 'string')

    if (!textPart) {
      throw new Error('Nenhuma resposta retornada pela API')
    }

    const parsed = JSON.parse(textPart.text)
    const respostas = Array.isArray(parsed.respostas) ? parsed.respostas : []

    // Alinha pela POSIÇÃO com as perguntas enviadas (nunca pelo texto que a IA
    // devolveu — ela pode reescrever a pergunta). Falta de resposta = honesta.
    const kit = perguntas.map((pergunta, i) => ({
      pergunta,
      resposta: typeof respostas[i]?.resposta === 'string' ? respostas[i].resposta.trim() : ''
    }))

    return new Response(JSON.stringify({ respostas: kit }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Erro ao gerar kit de WhatsApp:', error)
    const abortou = (error as any)?.name === 'TimeoutError' || (error as any)?.name === 'AbortError'
    return new Response(
      JSON.stringify({
        error: abortou
          ? 'A IA demorou demais pra escrever o kit. Tente de novo em instantes.'
          : 'Erro ao gerar o kit de respostas'
      }),
      { status: abortou ? 503 : 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export default { fetch: handler }
