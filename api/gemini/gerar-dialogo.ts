// Modo Diálogo: pega um roteiro que JÁ existe num card e reescreve como uma conversa
// de duas pessoas — o cliente levantando a objeção e o dono respondendo.
//
// Por que um endpoint separado, e não um campo a mais no schema de generate-content /
// generate-strategy: aqueles dois são o coração do produto e rodam pra TODOS os cards
// do calendário. Acrescentar um diálogo obrigatório em cada post encareceria toda
// geração pra atender a minoria de cards que vira áudio de duas vozes — e mexeria
// justo no que não pode quebrar. Aqui é sob demanda: só roda quando o cliente clica.
//
// Runtime Node.js (NAO Edge): Edge tem teto rígido de ~25s e IGNORA o `maxDuration`
// (ver api/gemini/text-to-speech.ts). No Node o teto vale, mas o handler precisa ser
// exportado como `export default { fetch: handler }`.
export const maxDuration = 60

// Os dois papéis são FIXOS de propósito. O TTS multi-locutor casa a fala com a voz
// comparando o começo da linha com o nome declarado — nome livre (ex.: a IA resolver
// escrever "Dona Maria:") não bate com a config e o áudio sai com a voz errada, sem
// erro nenhum. Travar aqui elimina a classe inteira de bug.
const FALANTE_CLIENTE = 'Cliente'
const FALANTE_DONO = 'Dono'

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    falas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          quem: { type: 'STRING', enum: [FALANTE_CLIENTE, FALANTE_DONO] },
          texto: { type: 'STRING' }
        },
        required: ['quem', 'texto']
      }
    }
  },
  required: ['falas']
}

function buildPrompt(hook: string, roteiro: string, nicho: string, tom: string): string {
  const contexto = nicho.trim() ? `\nNegócio: "${nicho.trim()}".` : ''

  return `Você é um redator brasileiro de rádio, especialista em diálogos curtos que vendem.

Transforme o roteiro abaixo numa CONVERSA de duas pessoas, em português do Brasil.${contexto}
Tom de voz: ${tom}.

Roteiro original:
Gancho: "${hook}"
Narração: "${roteiro}"

Os dois personagens são fixos:
- "${FALANTE_CLIENTE}": uma pessoa comum, com a dúvida ou a objeção real de quem ainda não comprou. Fala como gente fala, não como anúncio.
- "${FALANTE_DONO}": o dono do negócio, que responde com fatos concretos e específicos, sem discurso de vendedor.

Regras obrigatórias:
- Entre 6 e 8 falas no total, alternando: começa com ${FALANTE_CLIENTE} e termina com ${FALANTE_DONO}.
- A SOMA de todas as falas deve ficar entre 550 e 720 caracteres. Isso é um teto rígido de tempo de áudio — passar disso quebra a geração da voz.
- A primeira fala do ${FALANTE_CLIENTE} tem que ser a objeção mais comum de quem hesita nesse negócio (preço, desconfiança, "será que funciona pra mim?").
- O ${FALANTE_DONO} responde com o PROCESSO e o diferencial concretos, não com generalidade vazia.
- NUNCA INVENTE FATO. Só use número, prazo, porcentagem, quantidade de clientes, tempo de mercado, prêmio, certificação ou garantia se isso aparecer LITERALMENTE no roteiro original ou no nome do negócio acima. Se não aparecer, responda descrevendo como a coisa é feita, sem número nenhum. Este áudio vai ser publicado no nome de um negócio real: um dado inventado vira propaganda enganosa, não criatividade.
- Não prometa resultado ("resolve em 3 dias", "dura uma semana", "emagrece 5 quilos") a menos que o roteiro original já prometa exatamente isso.
- A última fala do ${FALANTE_DONO} é um convite claro pra ação (passar lá, chamar no WhatsApp, experimentar), curto e sem pressão.
- O ${FALANTE_CLIENTE} não pode ser um enfeite: cada fala dele avança a conversa com uma pergunta nova ou uma reação de verdade. Nada de "hmm", "entendi", "interessante" como fala inteira.
- Escreva SÓ o que vai ser falado em voz alta. Nada de rubrica, indicação de emoção, colchetes, parênteses, asteriscos ou emoji — tudo isso seria lido em voz alta pela locução.
- Não escreva o nome do personagem dentro do campo "texto" (o campo "quem" já diz quem fala).
- Números por extenso quando forem curtos ("vinte e quatro horas", não "24 horas") — a locução lê melhor.

REGRA DE PRODUTO (nunca quebre): esta ferramenta entrega TEXTO/legenda e locução em áudio. Ela NÃO grava, NÃO edita e NÃO gera vídeo. Nunca escreva nada dando a entender que um vídeo foi produzido.`
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

    const { hook, roteiro, nicho, tom } = await request.json()

    const roteiroFinal = typeof roteiro === 'string' ? roteiro.trim() : ''
    const hookFinal = typeof hook === 'string' ? hook.trim() : ''
    if (!roteiroFinal && !hookFinal) {
      return new Response(
        JSON.stringify({ error: 'Roteiro é obrigatório' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        // 50s deixa ~10s de folga dentro do maxDuration de 60: se a IA pendurar, a
        // funcao ainda consegue devolver erro em JSON. Sem isso a Vercel mata a funcao
        // e o cliente recebe o HTML de 504, que o front nao sabe interpretar.
        signal: AbortSignal.timeout(50_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [{
                text: buildPrompt(
                  hookFinal,
                  roteiroFinal,
                  typeof nicho === 'string' ? nicho : '',
                  typeof tom === 'string' && tom ? tom : 'Profissional'
                )
              }]
            }
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA
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
    if (!textPart) throw new Error('Nenhum diálogo retornado pela API')

    // responseSchema torna o JSON válido bem provável, mas não garantido (o modelo pode
    // cortar a resposta em MAX_TOKENS e devolver JSON truncado). Falhar aqui com mensagem
    // clara é melhor do que deixar o front receber `falas: undefined` e quebrar na tela.
    let falas: Array<{ quem?: string; texto?: string }> = []
    try {
      const cru = textPart.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
      const parsed = JSON.parse(cru)
      falas = Array.isArray(parsed?.falas) ? parsed.falas : []
    } catch {
      throw new Error('Resposta da IA veio incompleta')
    }

    // Saneamento final: descarta fala vazia e tira rubrica/asterisco que teria sido lida
    // em voz alta, e força `quem` a um dos dois papéis fixos (o enum do schema já pede
    // isso, mas o valor chega do lado de fora — conferir é barato).
    const limpas = falas
      .map((f) => ({
        quem: f?.quem === FALANTE_CLIENTE ? FALANTE_CLIENTE : FALANTE_DONO,
        texto: String(f?.texto ?? '')
          .replace(/[[\]*_]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      }))
      .filter((f) => f.texto)

    if (limpas.length < 2) throw new Error('A IA não devolveu falas suficientes')

    return new Response(JSON.stringify({ falas: limpas }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Erro ao gerar diálogo:', error)
    const abortou = (error as any)?.name === 'TimeoutError' || (error as any)?.name === 'AbortError'
    return new Response(
      JSON.stringify({
        error: abortou
          ? 'A IA demorou demais pra montar o diálogo. Tente de novo em instantes.'
          : 'Erro ao gerar diálogo'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export default { fetch: handler }
