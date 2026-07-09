export const config = {
  runtime: 'edge'
}

// Calendários maiores (mais dias = mais posts) podem passar do limite padrão de
// execução (~25s) e virar "Erro na API: 504" (timeout do gateway, ver text-to-speech.ts).
export const maxDuration = 60

// V1.6: vozes válidas do Gemini TTS que o seletor manual oferece.
const VOZES_VALIDAS = ['Zephyr', 'Puck', 'Kore']

// V1.6: schema virou builder. `vozes` = quais valores vozSugerida pode assumir.
// Automático -> ['Zephyr','Puck'] (IA decide). Forçado -> [voz] (uma só).
function buildResponseSchema(vozes: string[]) {
  return {
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
          periodo: { type: 'STRING', enum: ['Manhã', 'Tarde'] },
          horario: { type: 'STRING' },
          hook: { type: 'STRING' },
          roteiro: { type: 'STRING' },
          legenda: { type: 'STRING' },
          vozSugerida: { type: 'STRING', enum: vozes } // V1.6: dinâmico
        },
        required: ['dia', 'periodo', 'horario', 'hook', 'roteiro', 'legenda', 'vozSugerida']
      }
    }
  },
  required: ['estrategia', 'posts']
  }
}

interface Marca {
  instagram: string
  servicos: string
  tomMarca: string
  cta: string
  diferenciais: string
}

// qtdDias = quantidade de DIAS de conteúdo; cada dia gera 2 posts (Manhã + Tarde) — pedido de
// cliente: fluxo de 2 posts/dia, não 1.
function buildPrompt(nicho: string, tom: string, qtdDias: number, marca: Marca): string {
  // V1.5 Estudo de Marca: campos opcionais. Vazios = comportamento original.
  const tomObrigatorio = marca.tomMarca || tom
  const servicosLinha = marca.servicos || 'serviços típicos do nicho'
  const ctaObrigatorio = marca.cta || 'Clique no link da bio'
  const instaLinha = marca.instagram || 'não informado'
  const diferenciaisContexto = marca.diferenciais
    ? `\n- Diferenciais e informações importantes (destaque isto no conteúdo, SEM inventar nada além do que está escrito aqui): ${marca.diferenciais}`
    : ''
  const diferenciaisRegra = marca.diferenciais
    ? '\n- Quando fizer sentido, destaque os diferenciais informados nos roteiros e legendas, fiel ao que foi dito (não invente benefícios nem regras), mas com palavras diferentes a cada vez — não repita a mesma frase.'
    : ''

  return `Você é um estrategista de marketing digital sênior brasileiro. Crie um plano de conteúdo COMPLETO para o nicho: "${nicho}".

CONTEXTO DA MARCA (use como REFERÊNCIA para deixar o conteúdo na cara dessa marca — NUNCA copie estes textos literalmente nos posts, apenas escreva no mesmo espírito, com palavras próprias):
- Instagram de referência: ${instaLinha}
- Serviços que devem aparecer nos posts: ${servicosLinha}
- Tom de voz obrigatório (estilo/personalidade, não um texto pra repetir): ${tomObrigatorio}
- CTA de venda (só entra nos posts de Tarde — ver regras abaixo): ${ctaObrigatorio}${diferenciaisContexto}

Retorne um objeto JSON com dois campos: "estrategia" e "posts".

1) "estrategia" deve conter:
- resumo: um parágrafo curto com a estratégia geral do mês para essa marca
- personas: 2 a 3 personas do público-alvo, cada uma com "nome" (um rótulo curto) e "descricao" (dores, desejos e como falar com ela)
- pilares: 3 a 5 pilares de conteúdo (temas recorrentes), conectados aos serviços informados
- hashtags: 8 a 15 hashtags relevantes (com #)
- melhoresHorarios: 3 a 5 sugestões de dias/horários de postagem no Brasil
- ctas: 4 a 6 variações do call-to-action, girando em torno de "${ctaObrigatorio}"

2) "posts": um calendário de ${qtdDias} dias, com 2 roteiros de Reels por dia — um para Manhã e
outro para Tarde (${qtdDias * 2} roteiros no total), cada um com:
- dia: número sequencial de 1 a ${qtdDias} (Manhã e Tarde do mesmo dia usam o MESMO número)
- periodo: "Manhã" ou "Tarde"
- horario: horário sugerido de postagem, formato "HH:MM" (ver regras abaixo)
- hook: gancho de até 3 segundos para prender atenção
- roteiro: narração de cerca de 20 segundos, pronta para ser lida em voz alta
- legenda: legenda da postagem, com o CTA certo pro período (ver regras abaixo)
- vozSugerida: "Zephyr" ou "Puck", a que combinar melhor com o roteiro

REGRAS OBRIGATÓRIAS para os posts:
- Cada roteiro deve citar pelo menos 1 serviço da lista: ${servicosLinha}
- CTA automático por período (Manhã = educativo, Tarde = venda):
  - Posts de TARDE: a legenda deve terminar com o CTA de venda "${ctaObrigatorio}".
  - Posts de MANHÃ: a legenda NUNCA usa o CTA de venda. Feche com um CTA leve de engajamento
    (comentar, salvar, compartilhar, marcar um amigo), variando a frase a cada dia.
- Horário sugerido, baseado no nicho "${nicho}" e no período:
  - MANHÃ: escolha um horário entre 07:00 e 11:00 (horários com mais engajamento: 09:15, 10:30).
  - TARDE: escolha um horário entre 17:00 e 21:00 (horários com mais engajamento: 18:40, 20:15).
  - Ajuste pelo nicho quando fizer sentido: Restaurante/gastronomia prioriza 11:30 e 19:00; Loja/E-commerce prioriza 09:00 e 18:00; Serviço/Agência prioriza 10:00 e 20:00.
- Mantenha o tom "${tomObrigatorio}" em 100% dos roteiros e legendas${diferenciaisRegra}
- O post da Manhã e o da Tarde do mesmo dia devem abordar ângulos diferentes, não o mesmo gancho reescrito.
- VARIE A REDAÇÃO: nunca repita a mesma frase, expressão ou construção entre hook/roteiro/legenda do mesmo dia, nem entre dias/períodos diferentes. Cada texto deve soar único, mesmo falando do mesmo serviço ou tom.

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

    const { nicho, tom, qtdPosts, instagram, servicos, tomMarca, cta, diferenciais, voz } = await request.json()

    if (!nicho || typeof nicho !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Nicho é obrigatório' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const tomFinal = tom && typeof tom === 'string' ? tom : 'Profissional'
    const qtdFinal = Math.min(Math.max(Number(qtdPosts) || 30, 1), 30)

    // V1.5 Estudo de Marca: campos opcionais, retrocompatível se vierem vazios.
    const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
    const marca: Marca = {
      instagram: s(instagram),
      servicos: s(servicos),
      tomMarca: s(tomMarca),
      cta: s(cta),
      diferenciais: s(diferenciais),
    }

    // V1.6: voz forçada. Só aceita as vozes válidas; qualquer outra coisa = automático.
    const vozForcada = VOZES_VALIDAS.includes(s(voz)) ? s(voz) : ''
    const vozesPermitidas = vozForcada ? [vozForcada] : ['Zephyr', 'Puck']

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: buildPrompt(nicho, tomFinal, qtdFinal, marca) }]
            }
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: buildResponseSchema(vozesPermitidas) // V1.6
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

    // V1.6: à prova de bala — se o usuário forçou uma voz, crava em todos os posts.
    if (vozForcada && Array.isArray(parsed?.posts)) {
      for (const post of parsed.posts) post.vozSugerida = vozForcada
    }

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
