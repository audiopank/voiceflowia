export const config = {
  runtime: 'edge'
}

export const maxDuration = 60

const CAMPO_LABEL: Record<string, string> = {
  hook: 'gancho (hook)',
  roteiro: 'roteiro',
  legenda: 'legenda'
}

function buildPrompt(texto: string, campo: string): string {
  const label = CAMPO_LABEL[campo] || 'texto'

  return `Você é um editor de texto brasileiro especialista em fazer conteúdo de IA soar humano.

Reescreva o ${label} abaixo para soar como se um humano brasileiro tivesse escrito, não uma IA.

Regras:
- Varie o ritmo das frases (não deixe tudo no mesmo tamanho/cadência).
- Remova clichês de texto gerado por IA (ex: "no mundo de hoje", "é importante ressaltar", "em suma", "descubra como").
- Mantenha o mesmo sentido e um tamanho aproximado ao original.
- Mantenha emojis e hashtags se o texto original tiver.
- Português do Brasil, tom natural de rede social.
- Esta ferramenta entrega roteiro + legenda + locução (áudio), NÃO gera nem edita vídeo. Nunca
  prometa vídeo pronto por IA.

Texto original:
"""
${texto}
"""

Responda APENAS com o texto reescrito, sem aspas, sem comentário, sem explicação.`
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

    const { texto, campo } = await request.json()

    if (!texto || typeof texto !== 'string' || !texto.trim()) {
      return new Response(
        JSON.stringify({ error: 'Texto é obrigatório' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const campoFinal = typeof campo === 'string' && CAMPO_LABEL[campo] ? campo : 'legenda'

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(texto.trim(), campoFinal) }] }]
        }),
        signal: AbortSignal.timeout(45_000)
      }
    )

    if (!response.ok) {
      const errorData = await response.text()
      console.error('Erro Gemini (humanizar):', errorData)
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
      throw new Error('Nenhum texto retornado pela API')
    }

    return new Response(JSON.stringify({ texto: textPart.text.trim() }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Erro ao humanizar texto:', error)
    return new Response(
      JSON.stringify({ error: 'Erro ao humanizar texto' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
