export const config = {
  runtime: 'edge'
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    estrategia: {
      type: 'OBJECT',
      properties: {
        resumo: { type: 'STRING' },
        personas: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              nome: { type: 'STRING' },
              descricao: { type: 'STRING' }
            },
            required: ['nome', 'descricao']
          }
        },
        pilares: { type: 'ARRAY', items: { type: 'STRING' } },
        hashtags: { type: 'ARRAY', items: { type: 'STRING' } },
        melhoresHorarios: { type: 'ARRAY', items: { type: 'STRING' } },
        ctas: { type: 'ARRAY', items: { type: 'STRING' } }
      },
      required: ['resumo', 'personas', 'pilares', 'hashtags', 'melhoresHorarios', 'ctas']
    },
    posts: {
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
  },
  required: ['estrategia', 'posts']
}

function buildPrompt(nicho: string, tom: string, qtdPosts: number): string {
  return `Você é um estrategista de marketing digital sênior brasileiro. Crie um plano de conteúdo COMPLETO para o nicho: "${nicho}". Tom de voz: ${tom}.

Retorne um objeto JSON com dois campos: "estrategia" e "posts".

1) "estrategia" deve conter:
- resumo: um parágrafo curto com a estratégia geral do mês para esse nicho
- personas: 2 a 3 personas do público-alvo, cada uma com "nome" (um rótulo curto) e "descricao" (dores, desejos e como falar com ela)
- pilares: 3 a 5 pilares de conteúdo (temas recorrentes)
- hashtags: 8 a 15 hashtags relevantes (com #)
- melhoresHorarios: 3 a 5 sugestões de dias/horários de postagem no Brasil
- ctas: 4 a 6 ideias de call-to-action

2) "posts": ${qtdPosts} roteiros de Reels, cada um com:
- dia: número sequencial de 1 a ${qtdPosts}
- hook: gancho de até 3 segundos para prender atenção
- roteiro: narração de cerca de 20 segundos, pronta para ser lida em voz alta
- legenda: legenda da postagem terminando com um call-to-action
- vozSugerida: "Zephyr" ou "Puck", a que combinar melhor com o roteiro

Responda apenas com o objeto JSON, sem texto adicional.`
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

    const parsed = JSON.parse(textPart.text)

    return new Response(JSON.stringify(parsed), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Erro ao gerar estratégia:', error)
    return new Response(
      JSON.stringify({ error: 'Erro ao gerar estratégia' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
