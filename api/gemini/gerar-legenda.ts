export const config = {
  runtime: 'edge'
}

// Visão computacional (multimodal) costuma responder rápido, mas mantemos a folga
// do mesmo padrão dos outros endpoints pra não virar 504 em pico de fila.
export const maxDuration = 60

// Formatos que o Gemini aceita como inline_data de imagem. SVG não é imagem raster,
// então nem chega aqui (o front converte/bloqueia antes).
const MIMES_OK = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']

// Regra de tamanho da legenda do post, escolhida pelo cliente no slider da tela.
const TAMANHOS_LEGENDA: Record<string, string> = {
  curta: 'CURTA: no máximo 220 caracteres no total (contando hashtags), direto ao ponto, sem enrolação',
  ideal: 'IDEAL: entre 300 e 500 caracteres no total (contando hashtags)',
  longa: 'LONGA: entre 550 e 900 caracteres no total (contando hashtags), com um storytelling curto (dor → virada → produto) antes do CTA',
}

function buildPrompt(tom: string, contexto: string, tamanho: string): string {
  const extra = contexto.trim()
    ? `\nContexto que o cliente deu sobre o produto/negócio (use pra deixar tudo específico, não genérico): "${contexto.trim()}"`
    : ''
  const regraTamanho = TAMANHOS_LEGENDA[tamanho] ?? TAMANHOS_LEGENDA.ideal

  return `Você é um social media sênior brasileiro, especialista em posts que param o dedo (scroll-stopping) para Instagram e Facebook.

Analise a imagem em anexo (é a foto de um PRODUTO ou serviço que a empresa vende) e crie o pacote completo de UM post, em português do Brasil.

Tom de voz obrigatório: ${tom}.${extra}

O pacote tem 3 partes:

1. "gancho" — frase curta de abertura que vai IMPRESSA no card, acima da headline. Cria curiosidade ou toca na dor (ex: "O melhor conselho que posso te dar..."). Máximo 60 caracteres. Sem hashtag, sem emoji.
2. "headline" — a frase de impacto do card, que complementa o gancho e fecha a ideia. Máximo 80 caracteres. Sem hashtag. É a frase que a pessoa lê em 1 segundo no feed.
3. "legenda" — a legenda completa do post, pronta pra colar. Regras:
- Comece com um gancho forte na primeira linha (nada de "confira", "olha só").
- Fale do que a imagem mostra de verdade — descreva benefício/desejo, não características óbvias.
- Uma chamada para ação (CTA) clara no final: chamar no WhatsApp / Direct, comprar, agendar.
- Feche com 4 a 6 hashtags relevantes ao produto, na última linha.
- Tamanho ${regraTamanho}.
- Pode usar 1 ou 2 emojis se combinar com o tom, sem exagero.

Gancho e headline NÃO podem repetir literalmente a primeira linha da legenda — são peças diferentes do mesmo post.

REGRA DE PRODUTO (nunca quebre): esta ferramenta entrega TEXTO/legenda e imagem (card). Ela NÃO grava, NÃO edita e NÃO gera vídeo. Nunca escreva nada dando a entender que um vídeo foi produzido.

Responda APENAS com um JSON válido, sem markdown e sem texto fora dele, neste formato exato:
{"gancho": "...", "headline": "...", "legenda": "..."}`
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

    const { imagemBase64, mimeType, tom, contexto, tamanho } = await request.json()

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
    const tamanhoFinal = typeof tamanho === 'string' ? tamanho : 'ideal'

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
                { text: buildPrompt(tomFinal, contextoFinal, tamanhoFinal) }
              ]
            }
          ],
          generationConfig: { responseMimeType: 'application/json' }
        }),
        // Sem timeout, um Gemini pendurado segura a função até o limite da plataforma
        // e vira 504 sem mensagem; com ele, cai no catch e o cliente vê um erro claro.
        signal: AbortSignal.timeout(45_000)
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

    // A IA responde JSON ({gancho, headline, legenda}), mas nunca confiamos cegamente:
    // se vier texto solto (modelo ignorou o formato), tratamos tudo como legenda e
    // derivamos a headline da primeira linha — a tela nunca fica sem card.
    const raw = textPart.text.trim()
    let gancho = ''
    let headline = ''
    let legenda = ''
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
      const parsed = JSON.parse(cleaned)
      gancho = typeof parsed.gancho === 'string' ? parsed.gancho.trim() : ''
      headline = typeof parsed.headline === 'string' ? parsed.headline.trim() : ''
      legenda = typeof parsed.legenda === 'string' ? parsed.legenda.trim() : ''
    } catch {
      legenda = raw
    }

    if (!legenda) {
      throw new Error('Nenhuma legenda retornada pela API')
    }
    if (!headline) {
      headline = legenda.split('\n')[0].slice(0, 90)
    }

    return new Response(JSON.stringify({ legenda, headline, gancho }), {
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
