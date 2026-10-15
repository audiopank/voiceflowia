import { gerarComReserva, respostaDeFalha } from '../_lib/geminiReserva.js'

export const config = {
  runtime: 'edge'
}

export const maxDuration = 60

// Texto colado maior que isso é cortado: um site inteiro estoura o contexto sem
// melhorar a extração — o que interessa (quem é a marca, o que vende) está no começo.
const MAX_CHARS = 12000

// "Preencher com IA": o cliente cola qualquer coisa sobre a marca (site, bio do
// Instagram, print da conversa no WhatsApp) e a IA devolve os campos do formulário
// já preenchidos, pra ele conferir em vez de escrever do zero.
//
// REGRA CENTRAL: campo que não está no texto volta VAZIO. Briefing chutado vira
// roteiro errado — e o cliente só descobre depois de gerar o mês inteiro. Por isso
// nada aqui é `required`: o modelo pode (e deve) omitir o que não encontrou.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    nicho: {
      type: 'STRING',
      description: 'Segmento do negócio em 1 a 3 palavras (ex: "Barbearia", "Aparelhos auditivos"). Vazio se o texto não deixar claro.'
    },
    tom: {
      type: 'STRING',
      // Espelha src/lib/tons.ts — valor fora dessa lista deixa o select em branco.
      description: 'Tom de voz do conteúdo, apenas se o jeito de escrever do material indicar claramente.',
      enum: ['Profissional', 'Divertido', 'Vendedor', 'Inspirador', 'Técnico']
    },
    servicos: {
      type: 'STRING',
      description: 'Serviços/produtos citados no texto, separados por vírgula, só os nomes (ex: "Botox, Fios, Peelings"). Vazio se nenhum for citado.'
    },
    tomMarca: {
      type: 'STRING',
      description: 'Duas ou três palavras de estilo da marca (ex: "Acolhedor, técnico"). Vazio se o texto não permitir concluir.'
    },
    cta: {
      type: 'STRING',
      description: 'Chamada para ação que o próprio texto usa (ex: "Agende sua Avaliação"). Vazio se o texto não tiver nenhuma.'
    },
    diferenciais: {
      type: 'STRING',
      description: 'Garantias, pós-venda, regras e condições que o texto afirma. Fiel ao escrito, sem inventar. Vazio se não houver.'
    },
    instagram: {
      type: 'STRING',
      description: 'Handle do Instagram no formato @nome, apenas se aparecer literalmente no texto. Vazio caso contrário.'
    }
  }
}

function buildPrompt(texto: string): string {
  return `Você é um estrategista de marketing digital brasileiro montando o briefing de um cliente.

Abaixo está um material bruto sobre a marca (pode ser o site, a bio do Instagram, uma conversa de WhatsApp, anotações soltas). Sua tarefa é EXTRAIR do material os campos do formulário.

REGRA MAIS IMPORTANTE: extraia, não invente. Se o material não disser qual é a chamada para ação, deixe o campo vazio — não escreva uma CTA plausível para o segmento. O mesmo vale para todos os campos. Um campo vazio é útil; um campo inventado faz o cliente gerar um mês de conteúdo errado sem perceber.

- Só preencha "tom" e "tomMarca" se o jeito de escrever do material deixar isso claro.
- Em "servicos", liste apenas o que o material cita, separado por vírgula, só os nomes.
- Em "diferenciais", seja fiel: copie as garantias e regras que o material afirma, sem embelezar.
- Em "instagram", só devolva o @ se ele aparecer escrito no material.
- Use português do Brasil.

MATERIAL:
"""
${texto}
"""

Responda apenas o JSON, omitindo os campos que o material não sustenta.`
}

// BRIEFING POR VOZ (15/10/2026) — mesmo padrão provado na "pergunta por voz" da NewPost-IA
// (F2, 29/09): o cliente fala sobre a marca, a Gemini ouve e devolve o TEXTO, que volta pra
// caixa "Comece rápido" pro cliente CONFERIR antes de tocar em "Preencher com IA". O áudio é
// ouvido e descartado (não é guardado em lugar nenhum). Mesma função (Edge), sem função nova.
const MAX_AUDIO_BYTES = 2 * 1024 * 1024 // 1 min de voz (opus ~0,5 MB; WAV do Safari maior) cabe; o corpo do Edge vai até 4 MB
const MIMES_OK = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|aac|m4a)$/

const SCHEMA_VOZ = {
  type: 'OBJECT',
  properties: {
    entendeu: { type: 'BOOLEAN', description: 'true só se há fala inteligível' },
    texto: { type: 'STRING', description: 'O que foi falado, transcrito fielmente (vazio se não entendeu)' }
  },
  required: ['entendeu', 'texto']
}

const PROMPT_VOZ = [
  'Transcreva FIELMENTE, em português do Brasil, o que a pessoa fala neste áudio sobre um negócio (a marca, o que vende, preços, horários, diferenciais).',
  'Pode tirar só as hesitações ("é...", "hã", "tipo assim") e pontuar as frases. NÃO resuma, NÃO complete o que não foi dito, NÃO invente preço, nome ou dado.',
  'Nomes, marcas, números e preços exatamente como foram falados.',
  'Se for silêncio, ruído ou fala que você não entende com segurança: entendeu=false e texto vazio.',
  'Responda apenas o JSON.'
].join('\n')

function jsonResposta(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
}

async function transcreverBriefing(apiKey: string, body: { audio: string; mime?: unknown }): Promise<Response> {
  const mime = String(body.mime || '').split(';')[0].trim().toLowerCase()
  if (!MIMES_OK.test(mime)) return jsonResposta({ error: 'Formato de áudio não suportado neste navegador. Escreva o briefing.' }, 400)
  const base64 = body.audio.replace(/^data:[^,]*,/, '')
  if (base64.length * 0.75 > MAX_AUDIO_BYTES) return jsonResposta({ error: 'Áudio longo demais. Fale em até 1 minuto.' }, 413)

  const r = await gerarComReserva({
    apiKey,
    rotulo: 'extrair-briefing/voz',
    perfil: 'curto',
    corpo: {
      contents: [{ parts: [{ text: PROMPT_VOZ }, { inline_data: { mime_type: mime, data: base64 } }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA_VOZ, temperature: 0 }
    },
    aceita: (t) => typeof JSON.parse(t)?.entendeu === 'boolean'
  })
  if (!r.ok) return respostaDeFalha(r)
  const out = JSON.parse(r.texto)
  const texto = String(out.texto || '').trim().slice(0, MAX_CHARS)
  if (out.entendeu !== true || texto.length < 10) return jsonResposta({ entendeu: false })
  return jsonResposta({ entendeu: true, texto })
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

    const body = await request.json().catch(() => null)

    // BRIEFING POR VOZ: o áudio só vira TEXTO aqui; quem preenche o briefing é a chamada
    // normal, depois que o cliente conferiu o texto na tela.
    if (body && typeof body.audio === 'string' && body.audio) return await transcreverBriefing(apiKey, body)

    const texto = body?.texto

    if (!texto || typeof texto !== 'string' || texto.trim().length < 20) {
      return new Response(
        JSON.stringify({ error: 'Cole um pouco mais de texto sobre a marca (pelo menos umas duas frases).' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const r = await gerarComReserva({
      apiKey,
      rotulo: 'extrair-briefing',
      perfil: 'curto',
      corpo: {
        contents: [{ parts: [{ text: buildPrompt(texto.trim().slice(0, MAX_CHARS)) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA
        }
      },
      aceita: (t) => typeof JSON.parse(t) === 'object'
    })
    if (!r.ok) return respostaDeFalha(r)

    const briefing = JSON.parse(r.texto)

    return new Response(JSON.stringify({ briefing }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Erro ao extrair briefing:', error)
    return new Response(
      JSON.stringify({ error: 'Erro ao ler o material colado' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
