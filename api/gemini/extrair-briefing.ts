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

    const { texto } = await request.json()

    if (!texto || typeof texto !== 'string' || texto.trim().length < 20) {
      return new Response(
        JSON.stringify({ error: 'Cole um pouco mais de texto sobre a marca (pelo menos umas duas frases).' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(texto.trim().slice(0, MAX_CHARS)) }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA
          }
        }),
        signal: AbortSignal.timeout(45000)
      }
    )

    if (!response.ok) {
      const errorData = await response.text()
      console.error('Erro Gemini (extrair-briefing):', errorData)
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
      throw new Error('Nenhum briefing retornado pela API')
    }

    const briefing = JSON.parse(textPart.text)

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
