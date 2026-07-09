export const config = {
  runtime: 'edge'
}

export const maxDuration = 60

// V1.7 "Ideias Desta Semana": a partir do nicho + objetivo, devolve 3 hooks
// (ganchos de 3s) prontos, cada um com um ângulo psicológico diferente.
// O cliente vê os 3 como cards e copia o que mais gostar.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    hooks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          hook: { type: 'STRING', description: 'Gancho curto e forte de até 3 segundos' },
          angle: { type: 'STRING', description: 'Ângulo psicológico em 1 palavra (ex: Medo, Vaidade, Curiosidade)' }
        },
        required: ['hook', 'angle']
      }
    }
  },
  required: ['hooks']
}

function buildPrompt(nicho: string, objetivo: string): string {
  const alvo = objetivo ? `com o objetivo de "${objetivo}"` : 'para atrair e engajar clientes'
  return `Você é um copywriter sênior de social media brasileiro, especialista em Reels que viralizam.

Para o nicho "${nicho}", ${alvo}, gere exatamente 3 hooks (ganchos de até 3 segundos) prontos para começar um Reels.

Regras:
- Cada hook deve usar um ângulo psicológico DIFERENTE (ex: Medo, Vaidade, Curiosidade, Urgência, Prova Social, Autoridade).
- hook: frase curta, forte e específica do nicho, que prende a atenção nos 3 primeiros segundos.
- angle: 1 palavra que nomeia o ângulo usado.
- Português do Brasil, linguagem natural de Instagram. Nada genérico.

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

    const { nicho, objetivo } = await request.json()

    if (!nicho || typeof nicho !== 'string' || !nicho.trim()) {
      return new Response(
        JSON.stringify({ error: 'Nicho é obrigatório' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const objetivoFinal = typeof objetivo === 'string' ? objetivo.trim() : ''

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(nicho.trim(), objetivoFinal) }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA
          }
        })
      }
    )

    if (!response.ok) {
      const errorData = await response.text()
      console.error('Erro Gemini (generate-hooks):', errorData)
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
      throw new Error('Nenhuma ideia retornada pela API')
    }

    const parsed = JSON.parse(textPart.text)

    return new Response(JSON.stringify({ hooks: parsed.hooks }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Erro ao gerar hooks:', error)
    return new Response(
      JSON.stringify({ error: 'Erro ao gerar ideias' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
