// Bio do perfil do cliente na NewPost-IA, escrita a partir do nicho que ele já digitou.
//
// Por que isso existe: até hoje toda conta criada pelo VoiceFlow nascia com a bio fixa
// "Publicando com o VoiceFlow IA". Quem clicava no perfil da padaria lia propaganda da
// NOSSA ferramenta em vez de qualquer coisa sobre a padaria — e todos os clientes ficavam
// com o perfil idêntico. Perfil vazio já seria melhor que isso; perfil com a bio do
// negócio é o que faz o primeiro visitante entender de quem é aquilo.
//
// Runtime Node.js (NAO Edge): Edge tem teto rígido de ~25s e IGNORA o `maxDuration`
// (ver api/gemini/text-to-speech.ts). No Node o teto vale, mas o handler precisa ser
// exportado como `export default { fetch: handler }`.
export const maxDuration = 60

// Bio de rede social é curta por natureza, e a NewPost-IA mostra ela embaixo do nome no
// topo do perfil. 160 é o teto que o front também aplica — passar disso corta na tela.
const LIMITE_BIO = 160

// Última linha de defesa: bio maior que o campo some na tela do cliente sem ele entender
// por quê. Um `.slice(0, 160)` seco resolveria o tamanho e criaria dois defeitos piores:
//   - `.length` em JS conta unidades UTF-16, então cortar em cima de um emoji parte o par
//     substituto ao meio e o perfil exibe o caractere quebrado "�";
//   - cortar no meio de uma palavra deixa a bio truncada na cara do visitante.
// Por isso: corta por CODE POINT e recua até o último espaço, quando isso não mutila a frase.
function cortarBio(texto: string): string {
  if (texto.length <= LIMITE_BIO) return texto

  const pontos = [...texto]
  let cortado = ''
  for (const p of pontos) {
    if ((cortado + p).length > LIMITE_BIO) break
    cortado += p
  }
  const ultimoEspaco = cortado.lastIndexOf(' ')
  if (ultimoEspaco > LIMITE_BIO * 0.6) cortado = cortado.slice(0, ultimoEspaco)
  return cortado.trim()
}

function buildPrompt(marca: string, nicho: string): string {
  const contexto = nicho.trim() && nicho.trim() !== marca.trim()
    ? `\nNicho/atividade: "${nicho.trim()}".`
    : ''

  return `Você é um redator brasileiro. Escreva a BIO do perfil de "${marca}" numa rede social.${contexto}

Regras:
- Máximo ${LIMITE_BIO} caracteres. Bio é curta — se passar disso, é cortada na tela.
- Português do Brasil, falando com o cliente final desse negócio, não com outros profissionais.
- Diga O QUE o negócio faz e PARA QUEM, de forma concreta. Nada de "excelência", "qualidade e compromisso", "há anos no mercado" — frase de placa, que serve pra qualquer um, não serve pra ninguém.
- Escreva no máximo 150 caracteres, pra caber com folga.
- Pode terminar com um convite curto (chamar no WhatsApp, passar na loja, mandar mensagem) se sobrar espaço.
- NUNCA aponte para um link: nada de "link abaixo", "link na bio", "clique no link", "👇". O perfil não tem link nenhum, então mandar clicar leva o visitante a procurar uma coisa que não existe.
- No máximo 2 emojis, e só se combinarem. Pode não usar nenhum.
- Sem hashtag.
- NUNCA INVENTE FATO. Não escreva tempo de mercado, número de clientes, prêmio, certificação, endereço, horário nem telefone — nada disso foi informado, e a bio vai pública no nome de um negócio real. Escreva só o que dá pra afirmar a partir do nicho acima.

REGRA DE PRODUTO (nunca quebre): esta ferramenta entrega TEXTO/legenda e locução em áudio. Ela NÃO grava, NÃO edita e NÃO gera vídeo. Nunca escreva nada dando a entender que um vídeo foi produzido.

Responda APENAS com o texto da bio, sem aspas, sem markdown e sem nenhuma explicação.`
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

    const { marca, nicho } = await request.json()
    const marcaFinal = typeof marca === 'string' ? marca.trim() : ''
    if (!marcaFinal) {
      return new Response(
        JSON.stringify({ error: 'Nome do perfil é obrigatório' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        // Bio é resposta curta, mas o teto segue o padrão dos outros endpoints: uma Gemini
        // pendurada sem timeout vira 504 em HTML, que o front não sabe interpretar.
        signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(marcaFinal, typeof nicho === 'string' ? nicho : '') }] }],
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
    if (!textPart) throw new Error('Nenhuma bio retornada pela API')

    // A IA às vezes devolve com aspas ou quebra de linha mesmo sendo instruída a não fazer.
    const bio = cortarBio(
      String(textPart.text)
        .replace(/^["'`\s]+|["'`\s]+$/g, '')
        .replace(/\s*\n+\s*/g, ' ')
        .trim()
    )

    if (!bio) throw new Error('Bio veio vazia')

    return new Response(JSON.stringify({ bio }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Erro ao gerar bio:', error)
    const abortou = (error as any)?.name === 'TimeoutError' || (error as any)?.name === 'AbortError'
    return new Response(
      JSON.stringify({
        error: abortou
          ? 'A IA demorou demais pra escrever a bio.'
          : 'Erro ao gerar bio'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export default { fetch: handler }
