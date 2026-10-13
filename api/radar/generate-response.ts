// VoiceFlow Radar — "Detectou → Responde". Recebe uma menção negativa/crise e devolve
// um texto de resposta pronto pra publicar (fecha o ciclo detectar → responder e amarra
// o Radar no produto de conteúdo). Runtime edge, mesmo padrão dos outros gemini/*.

import { gerarComReserva, respostaDeFalha } from '../_lib/geminiReserva.js'

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

    const r = await gerarComReserva({
      apiKey,
      rotulo: 'radar/generate-response',
      perfil: 'curto',
      corpo: {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
      },
      aceita: (t) => typeof JSON.parse(t)?.resposta === 'string',
    })
    if (!r.ok) return respostaDeFalha(r)

    const parsed = JSON.parse(r.texto)
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
