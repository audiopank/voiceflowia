import { gerarComReserva, respostaDeFalha } from '../_lib/geminiReserva.js'

export const config = {
  runtime: 'edge'
}

export const maxDuration = 60

// CTA Inteligente por Objetivo: a partir de uma legenda já gerada + tom + um
// objetivo explícito (vender, gerar lead, ganhar seguidor, levar pro WhatsApp),
// devolve 5 variações de CTA prontas para colar no fim da legenda.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    ctas: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'Exatamente 5 variações de CTA, cada uma pronta para colar no fim da legenda'
    }
  },
  required: ['ctas']
}

const OBJETIVO_INSTRUCOES: Record<string, string> = {
  vender: 'CTA de venda direta: convida a comprar/agendar agora, pode usar senso de urgência ou oferta.',
  lead: 'CTA de geração de lead: convida a deixar contato, preencher formulário ou pedir mais informação, sem pressão de venda imediata.',
  seguidor: 'CTA de engajamento: convida a seguir o perfil, salvar ou compartilhar o post, sem venda direta.',
  whatsapp: 'CTA que leva para o WhatsApp ou Direct: pede pra comentar uma palavra-chave ou chamar no direct/WhatsApp, com urgência leve.'
}

function buildPrompt(legenda: string, tom: string, objetivo: string): string {
  const instrucaoObjetivo = OBJETIVO_INSTRUCOES[objetivo]
  const tomFinal = tom ? `Tom de voz da marca: "${tom}".` : ''

  return `Você é um copywriter sênior de social media brasileiro, especialista em CTAs (chamadas para ação) que convertem.

Legenda já pronta do post:
"""
${legenda}
"""

${tomFinal}

Gere exatamente 5 variações de CTA com este objetivo: ${instrucaoObjetivo}

Regras:
- Cada CTA é 1 frase curta, pronta para colar no fim da legenda acima (não repita a legenda, só o CTA).
- Varie a abordagem entre as 5 opções (não gere 5 frases quase iguais).
- Português do Brasil, linguagem natural de Instagram. Nada genérico ou clichê.
- Esta ferramenta entrega roteiro + legenda + locução (áudio), NÃO gera nem edita vídeo. Nunca
  prometa vídeo pronto por IA.

Responda apenas o JSON.`
}

export default async function handler(request: Request): Promise<Response> {
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

    const { legenda, tom, objetivo } = await request.json()

    if (!legenda || typeof legenda !== 'string' || !legenda.trim()) {
      return new Response(
        JSON.stringify({ error: 'Legenda é obrigatória' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!objetivo || typeof objetivo !== 'string' || !OBJETIVO_INSTRUCOES[objetivo]) {
      return new Response(
        JSON.stringify({ error: 'Objetivo inválido. Use: vender, lead, seguidor ou whatsapp' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const tomFinal = typeof tom === 'string' ? tom.trim() : ''

    const r = await gerarComReserva({
      apiKey,
      rotulo: 'gerar-ctas',
      perfil: 'curto',
      corpo: {
        contents: [{ parts: [{ text: buildPrompt(legenda.trim(), tomFinal, objetivo) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA
        }
      },
      aceita: (t) => Array.isArray(JSON.parse(t)?.ctas)
    })
    if (!r.ok) return respostaDeFalha(r)

    const parsed = JSON.parse(r.texto)

    return new Response(JSON.stringify({ ctas: parsed.ctas }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Erro ao gerar CTAs:', error)
    return new Response(
      JSON.stringify({ error: 'Erro ao gerar CTAs' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
