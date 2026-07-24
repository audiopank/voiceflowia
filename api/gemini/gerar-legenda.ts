export const config = {
  runtime: 'edge'
}

// Visão computacional (multimodal) costuma responder rápido, mas mantemos a folga
// do mesmo padrão dos outros endpoints pra não virar 504 em pico de fila.
export const maxDuration = 60

// Formatos que o Gemini aceita como inline_data de imagem. SVG não é imagem raster,
// então nem chega aqui (o front converte/bloqueia antes).
const MIMES_OK = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']

function buildPrompt(tom: string, contexto: string): string {
  const extra = contexto.trim()
    ? `\nContexto que o cliente deu sobre o produto/negócio (use pra deixar a legenda específica, não genérica): "${contexto.trim()}"`
    : ''

  return `Você é um social media sênior brasileiro, especialista em legendas que param o dedo (scroll-stopping) para Instagram e Facebook.

Analise a imagem em anexo (é a foto de um PRODUTO ou serviço que a empresa vende) e escreva UMA legenda pronta pra publicar, em português do Brasil.

Tom de voz obrigatório: ${tom}.${extra}

Diretrizes:
- Comece com um gancho forte na primeira linha (nada de "confira", "olha só").
- Fale do que a imagem mostra de verdade — descreva benefício/desejo, não características óbvias.
- Uma chamada para ação (CTA) clara no final: chamar no WhatsApp / Direct, comprar, agendar.
- Feche com 4 a 6 hashtags relevantes ao produto, na última linha.
- Máximo de 500 caracteres no total (contando as hashtags).
- Pode usar 1 ou 2 emojis se combinar com o tom, sem exagero.

REGRA DE PRODUTO (nunca quebre): esta ferramenta entrega TEXTO/legenda e imagem (card). Ela NÃO grava, NÃO edita e NÃO gera vídeo. Nunca escreva nada dando a entender que um vídeo foi produzido.

Responda APENAS com o texto da legenda, sem aspas, sem títulos, sem "Legenda:", nada além do texto pronto pra colar.`
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

    const { imagemBase64, mimeType, tom, contexto } = await request.json()

    if (!imagemBase64 || typeof imagemBase64 !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Imagem é obrigatória' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const mime = typeof mimeType === 'string' ? mimeType : 'image/jpeg'
    if (!MIMES_OK.includes(mime)) {
      return new Response(
        JSON.stringify({ error: 'Formato de imagem não suportado. Use PNG, JPG ou WEBP.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Aceita tanto a data URL inteira ("data:image/...;base64,AAAA") quanto só o base64 puro.
    const base64 = imagemBase64.includes(',') ? imagemBase64.split(',')[1] : imagemBase64

    const tomFinal = tom && typeof tom === 'string' ? tom : 'Profissional'
    const contextoFinal = typeof contexto === 'string' ? contexto : ''

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: mime, data: base64 } },
                { text: buildPrompt(tomFinal, contextoFinal) }
              ]
            }
          ]
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
      throw new Error('Nenhuma legenda retornada pela API')
    }

    return new Response(JSON.stringify({ legenda: textPart.text.trim() }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Erro ao gerar legenda:', error)
    return new Response(
      JSON.stringify({ error: 'Erro ao gerar legenda' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
