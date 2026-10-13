import { gerarComReserva, respostaDeFalha } from '../_lib/geminiReserva.js'

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

    const r = await gerarComReserva({
      apiKey,
      rotulo: 'humanizar',
      perfil: 'curto',
      corpo: {
        contents: [{ parts: [{ text: buildPrompt(texto.trim(), campoFinal) }] }]
      }
    })
    if (!r.ok) return respostaDeFalha(r)

    return new Response(JSON.stringify({ texto: r.texto.trim() }), {
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
