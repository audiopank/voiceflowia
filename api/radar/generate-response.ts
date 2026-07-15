// VoiceFlow Radar — "Detectou → Responde". Recebe uma menção negativa/crise e devolve
// um texto de resposta pronto pra publicar (fecha o ciclo detectar → responder e amarra
// o Radar no produto de conteúdo). Runtime edge, mesmo padrão dos outros gemini/*.

export const config = {
  runtime: 'edge',
}

export const maxDuration = 60

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    resposta: { type: 'STRING' },
  },
  required: ['resposta'],
}

function buildPrompt(marca: string, nicho: string, mencao: string, classificacao: string): string {
  return `Você é o social media / atendimento oficial da marca "${marca}" (nicho: ${nicho}). Uma menção ${classificacao.toLowerCase()} sobre a marca apareceu na web:

"${mencao}"

Escreva uma RESPOSTA PÚBLICA da marca para essa menção, pronta pra publicar. Regras:
- Português do Brasil, tom profissional, humano e empático — nunca defensivo ou agressivo.
- Reconheça o ponto do cliente, mostre que a marca se importa e ofereça um próximo passo concreto (chamar no direct/WhatsApp, resolver o caso).
- Se for crise/acusação grave, tranquilize sem admitir culpa indevida e leve a conversa pro privado.
- No máximo 3 frases curtas. Sem hashtags, sem emojis exagerados (no máximo 1).
- Não invente dados (telefone, prazo, valores) que você não tem.

Responda em JSON: { "resposta": "..." }.`
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY não configurada' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { marca, mencao, classificacao, nicho } = await request.json()
    if (!mencao || typeof mencao !== 'string') {
      return new Response(JSON.stringify({ error: 'Menção é obrigatória' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const prompt = buildPrompt(
      (marca && String(marca)) || 'a marca',
      (nicho && String(nicho)) || 'geral',
      String(mencao),
      (classificacao && String(classificacao)) || 'negativa',
    )

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    )

    if (!response.ok) {
      const errorData = await response.text()
      console.error('Erro Gemini (generate-response):', errorData)
      let detail = ''
      try {
        detail = JSON.parse(errorData)?.error?.message || ''
      } catch {
        // corpo não era JSON
      }
      return new Response(JSON.stringify({ error: detail || `Erro na API Gemini: ${response.status}` }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const data = await response.json()
    const textPart = data.candidates?.[0]?.content?.parts?.find((p: any) => typeof p.text === 'string')
    if (!textPart) throw new Error('Nenhum conteúdo retornado pela API')

    const parsed = JSON.parse(textPart.text)
    return new Response(JSON.stringify({ resposta: parsed.resposta || '' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Erro ao gerar resposta:', error)
    return new Response(JSON.stringify({ error: 'Erro ao gerar resposta' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
