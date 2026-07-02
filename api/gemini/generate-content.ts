export const config = {
  runtime: 'edge'
}

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      dia: { type: 'INTEGER' },
      hook: { type: 'STRING' },
      roteiro: { type: 'STRING' },
      legenda: { type: 'STRING' },
      vozSugerida: { type: 'STRING', enum: ['Zephyr', 'Puck'] }
    },
    required: ['dia', 'hook', 'roteiro', 'legenda', 'vozSugerida']
  }
}

function buildPrompt(nicho: string, tom: string, qtdPosts: number): string {
  return `Você é um social media sênior brasileiro. Gere ${qtdPosts} roteiros de Reels para o nicho: "${nicho}". Tom de voz: ${tom}.

Para cada um dos ${qtdPosts} roteiros, retorne um objeto com:
- dia: número sequencial de 1 a ${qtdPosts}
- hook: gancho de até 3 segundos para prender atenção logo no início
- roteiro: roteiro de narração de cerca de 20 segundos, pronto para ser lido em voz alta
- legenda: legenda para a postagem, terminando com uma call-to-action
- vozSugerida: "Zephyr" ou "Puck", a que combinar melhor com o tom do roteiro

Responda apenas com o array JSON, sem texto adicional.`
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

    const { nicho, tom, qtdPosts } = await request.json()

    if (!nicho || typeof nicho !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Nicho é obrigatório' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const tomFinal = tom && typeof tom === 'string' ? tom : 'Profissional'
    const qtdFinal = Math.min(Math.max(Number(qtdPosts) || 30, 1), 30)

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: buildPrompt(nicho, tomFinal, qtdFinal) }]
            }
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA
          }
        })
      }
    )

    if (!response.ok) {
      const errorData = await response.text()
      console.error('Erro Gemini:', errorData)
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
      throw new Error('Nenhum conteúdo retornado pela API')
    }

    const posts = JSON.parse(textPart.text)

    return new Response(JSON.stringify({ posts }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Erro ao gerar conteúdo:', error)
    return new Response(
      JSON.stringify({ error: 'Erro ao gerar conteúdo' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
