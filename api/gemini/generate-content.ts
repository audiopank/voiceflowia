export const config = {
  runtime: 'edge'
}

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      dia: { type: 'INTEGER' },
      periodo: { type: 'STRING', enum: ['Manhã', 'Tarde'] },
      hook: { type: 'STRING' },
      roteiro: { type: 'STRING' },
      legenda: { type: 'STRING' },
      vozSugerida: { type: 'STRING', enum: ['Zephyr', 'Puck'] }
    },
    required: ['dia', 'periodo', 'hook', 'roteiro', 'legenda', 'vozSugerida']
  }
}

// qtdDias = quantidade de DIAS de conteúdo; cada dia gera 2 posts (Manhã + Tarde),
// então o array final tem qtdDias * 2 itens (pedido de cliente: fluxo de 2 posts/dia).
function buildPrompt(nicho: string, tom: string, qtdDias: number): string {
  return `Você é um social media sênior brasileiro. Gere um calendário de Reels de ${qtdDias} dias para o nicho: "${nicho}". Tom de voz: ${tom}.

Cada dia tem 2 roteiros: um para postar de Manhã e outro para postar à Tarde — ${qtdDias * 2} roteiros no total.

Para cada roteiro, retorne um objeto com:
- dia: número sequencial de 1 a ${qtdDias} (Manhã e Tarde do mesmo dia usam o MESMO número)
- periodo: "Manhã" ou "Tarde"
- hook: gancho de até 3 segundos para prender atenção logo no início
- roteiro: roteiro de narração de cerca de 20 segundos, pronto para ser lido em voz alta
- legenda: legenda para a postagem, com o CTA certo pro período (ver regras abaixo)
- vozSugerida: "Zephyr" ou "Puck", a que combinar melhor com o tom do roteiro

REGRAS:
- O post da Manhã e o da Tarde do mesmo dia devem ser sobre ângulos diferentes (não repita o mesmo gancho/roteiro só mudando palavras).
- CTA automático por período:
  - Posts de TARDE: legenda fecha com um CTA de conversão forte (chamar no WhatsApp, agendar, comprar/agendar agora), adaptado ao nicho.
  - Posts de MANHÃ: legenda fecha com um CTA leve de engajamento (comentar, salvar, compartilhar, marcar um amigo) — nada de venda direta de manhã.
- Varie a redação entre todos os roteiros do calendário — nunca repita a mesma frase entre dias ou períodos diferentes.

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
