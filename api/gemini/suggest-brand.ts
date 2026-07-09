export const config = {
  runtime: 'edge'
}

export const maxDuration = 60

// Sugestões sob medida para o "Agente Guia" do Super Agente: a partir do nicho,
// devolve chips prontos para o cliente se inspirar e preencher o Estudo de Marca.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    servicos: {
      type: 'ARRAY',
      description: 'Serviços/produtos comuns do nicho, 1 a 3 palavras cada',
      items: { type: 'STRING' }
    },
    tomMarca: {
      type: 'ARRAY',
      description: 'Opções de tom de marca, frase curta cada (ex: "Autoridade médica, sofisticado")',
      items: { type: 'STRING' }
    },
    cta: {
      type: 'ARRAY',
      description: 'Chamadas para ação curtas e diretas (ex: "Agende sua Avaliação")',
      items: { type: 'STRING' }
    }
  },
  required: ['servicos', 'tomMarca', 'cta']
}

function buildPrompt(nicho: string): string {
  return `Você é um estrategista de marketing digital brasileiro. Para o nicho "${nicho}", gere sugestões curtas e realistas para um cliente preencher um formulário de conteúdo.

Retorne:
- servicos: 6 serviços/produtos típicos desse nicho, 1 a 3 palavras cada (o cliente vai clicar em vários para montar a lista dele).
- tomMarca: 4 opções de tom de marca, cada uma uma frase curta com 2 ou 3 adjetivos (ex: "Autoridade médica, sofisticado").
- cta: 4 chamadas para ação curtas e diretas típicas do nicho (ex: "Agende sua Avaliação").

Use português do Brasil, linguagem natural de agência. Não repita. Responda apenas o JSON.`
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

    const { nicho } = await request.json()

    if (!nicho || typeof nicho !== 'string' || !nicho.trim()) {
      return new Response(
        JSON.stringify({ error: 'Nicho é obrigatório' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(nicho.trim()) }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA
          }
        })
      }
    )

    if (!response.ok) {
      const errorData = await response.text()
      console.error('Erro Gemini (suggest-brand):', errorData)
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
      throw new Error('Nenhuma sugestão retornada pela API')
    }

    const suggestions = JSON.parse(textPart.text)

    return new Response(JSON.stringify({ suggestions }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Erro ao sugerir marca:', error)
    return new Response(
      JSON.stringify({ error: 'Erro ao gerar sugestões' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
