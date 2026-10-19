// Runtime Node.js (não 'edge'): o handler espera a resposta INTEIRA do Gemini
// antes de responder (sem streaming) — Edge Functions da Vercel tem um teto
// fixo de 25s pra "começar a responder" que o maxDuration NÃO estica (isso já
// causou "Erro na API: 504"/FUNCTION_INVOCATION_TIMEOUT mesmo com maxDuration=60
// configurado). No runtime Node.js, maxDuration vale de verdade (até 60s no
// plano Hobby da Vercel).
export const maxDuration = 60

// Cadeia de modelos (ordem = qualidade). Fila e cota são POR MODELO: quando o principal
// está congestionado, os "lite" costumam responder. O orçamento corta antes dos 60s.
const MODELOS: { id: string; tetoMs: number }[] = [
  { id: 'gemini-3.7-flash', tetoMs: 28_000 },
  { id: 'gemini-3.5-flash', tetoMs: 20_000 },
  { id: 'gemini-3.5-flash-lite', tetoMs: 16_000 },
  { id: 'gemini-3.1-flash-lite', tetoMs: 16_000 }
]
const ORCAMENTO_MS = 54_000
const MINIMO_TENTATIVA_MS = 8_000

// V1.6: vozes válidas do Gemini TTS que o seletor manual oferece.
const VOZES_VALIDAS = ['Zephyr', 'Puck', 'Kore']

// Teto de ganchos de memória aceitos por requisição. O cliente já limita, mas
// quem manda a requisição é o navegador — o teto que vale é o daqui.
const MAX_HOOKS_MEMORIA = 40

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

// OBJETIVO DA MARCA (19/10/2026): "" = equilibrado (o comportamento de sempre, intocado).
export type Objetivo = '' | 'alcance' | 'leads' | 'vendas'
const OBJETIVOS_VALIDOS: Objetivo[] = ['alcance', 'leads', 'vendas']

interface Marca {
  objetivo: Objetivo
  instagram: string
  servicos: string
  tomMarca: string
  cta: string
  diferenciais: string
}

// qtdDias = quantidade de DIAS de conteúdo; cada dia gera 2 posts (Manhã + Tarde) — pedido de
// cliente: fluxo de 2 posts/dia, não 1.
function buildPrompt(nicho: string, tom: string, qtdDias: number, marca: Marca, hooksAnteriores: string[], campanha: string): string {
  // MEMÓRIA DA MARCA: hooks já entregues a este cliente em gerações passadas.
  // Sem isto o mês 2 sai como releitura do mês 1 — o cliente percebe na hora e
  // conclui que a ferramenta não aprendeu nada sobre o negócio dele.
  const memoriaBloco = hooksAnteriores.length
    ? `\n\nJÁ ENTREGUE A ESTE CLIENTE (${hooksAnteriores.length} ganchos de meses anteriores) — NÃO REPITA:
${hooksAnteriores.map((h) => `- ${h}`).join('\n')}

REGRA DA MEMÓRIA: não reutilize nenhum desses ganchos, nem versões reescritas
deles com sinônimos. Também não repita o ÂNGULO (a promessa/dor central), mesmo
com palavras totalmente diferentes. Se um tema importante já apareceu, aborde-o
por outra porta: outro momento da jornada, outra objeção, outro formato de prova.
Este mês precisa parecer continuação do trabalho, não recomeço.`
    : ''

  // GANCHO SAZONAL: data/campanha em destaque (ex: "Dia dos Pais"). Quando vem,
  // parte do calendário fica temática, mas o mês não vira 100% sobre isso.
  // QUANTIDADE EXATA calculada aqui (15/10/2026): o prompt dizia "20% a 40% dos posts" e, com
  // 1 dia (2 posts), 20-40% de 2 arredondou pra ZERO — o "Dia dos Professores · é hoje" saiu
  // sem nenhum post sobre professores. Calendário curto (até 4 posts) = todos na data.
  const totalPosts = qtdDias * 2
  const postsDaCampanha = totalPosts <= 4 ? totalPosts : Math.max(1, Math.round(totalPosts * 0.3))
  const campanhaBloco = campanha
    ? postsDaCampanha === totalPosts
      ? `\n\nCAMPANHA SAZONAL EM DESTAQUE: "${campanha}". TODOS os ${totalPosts} posts deste calendário são sobre esta data/campanha — ganchos, roteiros, legendas e CTAs conectados a ela, adaptados ao nicho "${nicho}" (cada post por um ângulo diferente). Mantenha TODAS as regras acima (produto sem vídeo, CTA por período, variação de redação, memória da marca).`
      : `\n\nCAMPANHA SAZONAL EM DESTAQUE: "${campanha}". Exatamente ${postsDaCampanha} dos ${totalPosts} posts do calendário (nem menos, nem mais) são sobre esta data/campanha — ganchos, ofertas e CTAs conectados a ela, adaptados ao nicho "${nicho}". Os demais seguem o plano normal do mês. Mantenha TODAS as regras acima (produto sem vídeo, CTA por período, variação de redação, memória da marca).`
    : ''

  return buildPromptBase(nicho, tom, qtdDias, marca, memoriaBloco + campanhaBloco)
}

function buildPromptBase(nicho: string, tom: string, qtdDias: number, marca: Marca, memoriaBloco: string): string {
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

  // OBJETIVO DA MARCA (19/10/2026): muda o PAPEL de cada período e o fechamento das legendas.
  // Sem objetivo ('') = o texto de sempre, palavra por palavra. O objetivo muda a escrita, nunca
  // promete resultado (nada de "vai vender mais" / "vai viralizar").
  const objetivoContexto = {
    '': '',
    alcance: '\n- OBJETIVO DO MÊS: ALCANCE — ser descoberto por gente nova (salvamentos, compartilhamentos, marcações).',
    leads: '\n- OBJETIVO DO MÊS: LEADS — fazer a pessoa INICIAR UMA CONVERSA (direct, WhatsApp, pedir orçamento/avaliação).',
    vendas: '\n- OBJETIVO DO MÊS: VENDAS — levar quem já conhece a marca a COMPRAR/CONTRATAR.'
  }[marca.objetivo]
  const regrasCta = {
    '': `- CTA automático por período (Manhã = educativo, Tarde = venda):
  - Posts de TARDE: a legenda deve terminar com o CTA de venda "${ctaObrigatorio}".
  - Posts de MANHÃ: a legenda NUNCA usa o CTA de venda. Feche com um CTA leve de engajamento
    (comentar, salvar, compartilhar, marcar um amigo), variando a frase a cada dia.`,
    alcance: `- OBJETIVO ALCANCE — o mês inteiro é feito pra ser SALVO e COMPARTILHADO:
  - Ganchos de curiosidade e utilidade; roteiros que ensinam algo prático ou contam algo que a
    pessoa queira mandar pra alguém. Nada de pressão de venda.
  - Posts de MANHÃ: feche pedindo pra SALVAR o post (variando a frase a cada dia).
  - Posts de TARDE: feche pedindo pra COMPARTILHAR ou MARCAR alguém que precisa ver isso.
  - O CTA de venda "${ctaObrigatorio}" aparece só no ÚLTIMO post de Tarde do calendário.`,
    leads: `- OBJETIVO LEADS — cada post é um convite pra CONVERSAR com a marca:
  - Roteiros que levantam uma dúvida ou dor comum do público e mostram que a marca resolve.
  - Posts de MANHÃ: feche convidando a pessoa a COMENTAR a dúvida dela ou chamar no direct
    (variando a frase a cada dia).
  - Posts de TARDE: a legenda deve terminar com "${ctaObrigatorio}"; se essa chamada não for de
    contato, acrescente antes dela um convite direto pra chamar no direct/WhatsApp.`,
    vendas: `- OBJETIVO VENDAS — o mês conduz até a compra:
  - Posts de MANHÃ: preparam a decisão — benefício concreto, como funciona, resposta a uma
    objeção comum (preço, tempo, confiança). Feche com CTA leve (comentar, salvar), sem venda.
  - Posts de TARDE: oferta clara do serviço, sempre fiel aos diferenciais informados (preço,
    condição ou prazo SÓ se estiverem escritos acima), terminando com "${ctaObrigatorio}".`
  }[marca.objetivo]

  return `Você é um estrategista de marketing digital sênior brasileiro. Crie um plano de conteúdo COMPLETO para o nicho: "${nicho}".

CONTEXTO DA MARCA (use como REFERÊNCIA para deixar o conteúdo na cara dessa marca — NUNCA copie estes textos literalmente nos posts, apenas escreva no mesmo espírito, com palavras próprias):
- Instagram de referência: ${instaLinha}
- Serviços que devem aparecer nos posts: ${servicosLinha}
- Tom de voz obrigatório (estilo/personalidade, não um texto pra repetir): ${tomObrigatorio}
- CTA de venda (${marca.objetivo ? 'onde ele entra está nas regras abaixo' : 'só entra nos posts de Tarde — ver regras abaixo'}): ${ctaObrigatorio}${diferenciaisContexto}${objetivoContexto}

REGRA DE PRODUTO (vale para a estratégia E para os posts — nunca a quebre):
- Esta ferramenta entrega ROTEIRO + LEGENDA + LOCUÇÃO (áudio de IA), além de cards em imagem
  (carrossel) com esses textos. Ela NÃO grava, NÃO edita, NÃO produz e NÃO entrega VÍDEO nem
  animação. Quem grava o vídeo é o próprio cliente, usando o roteiro e a locução por cima.
- Portanto, NUNCA escreva nada que afirme ou dê a entender que vídeos são gerados, editados,
  produzidos ou entregues prontos pela IA/plataforma. Proibido: "gere seus vídeos com IA",
  "escalar a entrega de vídeos", "vídeos prontos em segundos", "produção de vídeo automatizada".
- Quando o assunto for vídeo, escreva sempre do ponto de vista de quem GRAVA: "roteiro pronto
  pra você gravar", "locução profissional pra usar no seu vídeo", "é só gravar por cima".
- ATENÇÃO à exceção: se o próprio nicho "${nicho}" for um negócio que de fato produz vídeo
  (produtora, videomaker, editor), fale dos serviços DELE normalmente — a proibição acima é só
  sobre o que esta ferramenta faz, não sobre o que o cliente vende.

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
${regrasCta}
- Horário sugerido, baseado no nicho "${nicho}" e no período:
  - MANHÃ: escolha um horário entre 07:00 e 11:00 (horários com mais engajamento: 09:15, 10:30).
  - TARDE: escolha um horário entre 17:00 e 21:00 (horários com mais engajamento: 18:40, 20:15).
  - Ajuste pelo nicho quando fizer sentido: Restaurante/gastronomia prioriza 11:30 e 19:00; Loja/E-commerce prioriza 09:00 e 18:00; Serviço/Agência prioriza 10:00 e 20:00.
- Mantenha o tom "${tomObrigatorio}" em 100% dos roteiros e legendas${diferenciaisRegra}
- O post da Manhã e o da Tarde do mesmo dia devem abordar ângulos diferentes, não o mesmo gancho reescrito.
- VARIE A REDAÇÃO: nunca repita a mesma frase, expressão ou construção entre hook/roteiro/legenda do mesmo dia, nem entre dias/períodos diferentes. Cada texto deve soar único, mesmo falando do mesmo serviço ou tom.${memoriaBloco}

Responda apenas com o objeto JSON, sem texto adicional.`
}

async function handler(request: Request): Promise<Response> {
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

    const { nicho, tom, qtdPosts, instagram, servicos, tomMarca, cta, diferenciais, voz, hooksAnteriores, campanha, objetivo } = await request.json()

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
      objetivo: (OBJETIVOS_VALIDOS as string[]).includes(s(objetivo)) ? (s(objetivo) as Objetivo) : '',
      instagram: s(instagram),
      servicos: s(servicos),
      tomMarca: s(tomMarca),
      cta: s(cta),
      diferenciais: s(diferenciais),
    }

    // Ganchos sazonais: data/campanha opcional, limitada pra não inchar o prompt.
    const campanhaFinal = s(campanha).slice(0, 120)

    // V1.6: voz forçada. Só aceita as vozes válidas; qualquer outra coisa = automático.
    const vozForcada = VOZES_VALIDAS.includes(s(voz)) ? s(voz) : ''
    const vozesPermitidas = vozForcada ? [vozForcada] : ['Zephyr', 'Puck']

    // Memória da marca: sanitiza no servidor em vez de confiar no cliente. O teto
    // aqui é o que protege a chamada — prompt inchado atrasa uma requisição que
    // já morre em 45s, e o Gemini anda instável.
    const memoria: string[] = (Array.isArray(hooksAnteriores) ? hooksAnteriores : [])
      .filter((h: unknown): h is string => typeof h === 'string' && h.trim().length > 0)
      .map((h: string) => h.trim().slice(0, 120))
      .slice(0, MAX_HOOKS_MEMORIA)

    const body = JSON.stringify({
      contents: [
        {
          parts: [{ text: buildPrompt(nicho, tomFinal, qtdFinal, marca, memoria, campanhaFinal) }]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: buildResponseSchema(vozesPermitidas) // V1.6
      }
    })

    // MODELO RESERVA (13/10/2026): mesma cadeia do Kit. Cada tentativa tem teto próprio
    // (sem ele o fetch fica pendurado até a Vercel matar a função, ~300s) e o orçamento
    // total corta antes do maxDuration de 60s.
    const inicio = Date.now()
    let ultimo = { status: 500, motivo: '', demorou: false }
    for (let i = 0; i < MODELOS.length; i++) {
      const restante = ORCAMENTO_MS - (Date.now() - inicio)
      if (restante < MINIMO_TENTATIVA_MS) break
      const { id, tetoMs } = MODELOS[i]
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${id}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: AbortSignal.timeout(Math.min(tetoMs, restante))
          }
        )
        if (!response.ok) {
          const errorData = await response.text()
          console.error(`Erro Gemini (generate-strategy, ${id}):`, errorData.slice(0, 600))
          let detail = ''
          try {
            detail = JSON.parse(errorData)?.error?.message || ''
          } catch {
            // corpo não era JSON, ignora
          }
          ultimo = { status: response.status, motivo: detail || `Erro na API Gemini: ${response.status}`, demorou: false }
        } else {
          const data = await response.json()
          const textPart = data.candidates?.[0]?.content?.parts?.find((p: any) => typeof p.text === 'string')
          const parsed = textPart ? JSON.parse(textPart.text) : null
          if (Array.isArray(parsed?.posts) && parsed.posts.length > 0) {
            // V1.6: à prova de bala — se o usuário forçou uma voz, crava em todos os posts.
            if (vozForcada) {
              for (const post of parsed.posts) post.vozSugerida = vozForcada
            }
            if (i > 0) console.warn(`generate-strategy: gerado pelo RESERVA ${id}`)
            return new Response(JSON.stringify({ ...parsed, modelo: id, reserva: i > 0 }), {
              headers: { 'Content-Type': 'application/json' }
            })
          }
          ultimo = { status: 502, motivo: 'Nenhum conteúdo retornado pela API', demorou: false }
        }
      } catch (err) {
        const demorou = (err as any)?.name === 'TimeoutError' || (err as any)?.name === 'AbortError'
        console.error(`Falha em ${id} (generate-strategy):`, demorou ? 'timeout' : err)
        ultimo = { status: demorou ? 504 : 502, motivo: demorou ? 'demorou demais' : 'resposta inválida da IA', demorou }
      }
      if (![429, 500, 502, 503, 504].includes(ultimo.status)) break
      console.warn(`generate-strategy: ${id} falhou (${ultimo.status} ${ultimo.motivo}) → próximo modelo`)
    }

    const filaOuTempo = ultimo.demorou || [429, 500, 502, 503, 504].includes(ultimo.status)
    return new Response(
      JSON.stringify({
        error: filaOuTempo
          ? 'A IA do Google está sobrecarregada agora (todos os modelos ocupados). Tente de novo em alguns minutos.'
          : ultimo.motivo
      }),
      { status: filaOuTempo ? 503 : ultimo.status, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Erro ao gerar estratégia:', error)
    if (error instanceof Error && error.name === 'TimeoutError') {
      return new Response(
        JSON.stringify({ error: 'O Gemini está demorando muito pra responder (alta demanda). Tente novamente em instantes.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )
    }
    return new Response(
      JSON.stringify({ error: 'Erro ao gerar estratégia' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// No runtime Node.js (não-Edge) deste projeto (framework "Other", não
// Next.js), a Vercel NÃO reconhece nem `export default function handler`
// nem `export const POST` como Web Handler (Request/Response) — em ambos
// os casos ela assume a assinatura antiga `(req, res) => void`, ignora o
// que a gente `return`, e a conexao fica pendurada ate a Vercel desistir
// sozinha (~300s!). O formato que funciona é `export default { fetch }`.
// O dev-bridge local (vite.config.ts) foi ajustado pra aceitar os dois
// formatos (function OU {fetch}).
export default { fetch: handler }
