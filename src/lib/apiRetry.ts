// Resiliência ao limite (429) das APIs de IA (Gemini free tier ~20 req/min).
// Faz auto-retry respeitando o "retry in Xs" e ajuda a throttlar chamadas em lote.

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// Extrai o tempo de espera de um erro 429 ("Please retry in 43.2s" ou retryDelay: "43s").
// Limita entre 1s e 65s; usa fallback se não encontrar.
export function parseRetryMs(text: string, fallbackMs = 30000): number {
  if (!text) return fallbackMs
  const m =
    text.match(/retry in ([\d.]+)\s*s/i) ||
    text.match(/retryDelay["'\s:]+([\d.]+)s/i)
  if (m) {
    const secs = parseFloat(m[1])
    if (!Number.isNaN(secs)) return Math.min(Math.max(secs, 1), 65) * 1000
  }
  return fallbackMs
}

interface RetryOpts {
  retries?: number
  // Teto de espera ACUMULADA em 429 (ms). Um cliente testando não pode ficar minutos
  // olhando "aguardando...": se o próximo "retry in Xs" estourar esse teto (cota de fato
  // esgotada, não um pico passageiro), a gente devolve o erro na hora pra UI mostrar uma
  // mensagem decente — fail-fast em vez de fingir que vai gerar. Padrão: 20s.
  maxTotalWaitMs?: number
  // Chamado antes de cada espera, com os segundos e o número da tentativa.
  onWait?: (secondsLeft: number, attempt: number) => void
}

// Gateway/timeout transitórios (ex: síntese de voz demorou mais que o limite de execução
// da function) — sem "retry-in-Xs" no corpo, então usa uma espera curta fixa.
export const GATEWAY_ERROR_STATUSES = [502, 503, 504]

// fetch que re-tenta sozinho quando a API responde 429 (limite atingido) ou um erro
// transitório de gateway (502/503/504). Retorna a Response final (ok ou o último erro) —
// o chamador trata como antes.
export async function fetchWithRetry(
  input: RequestInfo,
  init: RequestInit,
  { retries = 3, maxTotalWaitMs = 20000, onWait }: RetryOpts = {},
): Promise<Response> {
  let waitedMs = 0
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(input, init)
    if (attempt > retries) return res

    if (res.status === 429) {
      let ms = 30000
      try {
        ms = parseRetryMs(await res.clone().text())
      } catch {
        // corpo ilegível — usa fallback
      }
      // Esperar isso passaria do teto total: é cota esgotada, não pico passageiro.
      // Falha rápido — segurar o cliente por mais tempo só piora a demo.
      if (waitedMs + ms > maxTotalWaitMs) return res
      waitedMs += ms
      onWait?.(Math.ceil(ms / 1000), attempt)
      await sleep(ms + 500)
      continue
    }

    if (GATEWAY_ERROR_STATUSES.includes(res.status)) {
      onWait?.(3, attempt)
      await sleep(3000)
      continue
    }

    return res
  }
}

// Mensagem de erro amigável pro usuário final a partir do status + corpo cru da API.
// Traduz "You exceeded your current quota..." / 429 / RESOURCE_EXHAUSTED (jargão do Google
// que assusta um cliente testando) numa frase que soa "alta demanda", não "app quebrado".
export function friendlyApiError(status: number, rawMessage?: string): string {
  const msg = (rawMessage || '').toLowerCase()
  const isQuota =
    status === 429 ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit')

  if (isQuota) {
    return 'Estamos com muita procura agora e o limite temporário da IA foi atingido. Aguarde alguns minutos e gere de novo. 🙏'
  }

  if (GATEWAY_ERROR_STATUSES.includes(status) || status === 504) {
    return 'A IA demorou demais pra responder desta vez. Tente gerar de novo em instantes.'
  }

  // Erro genuinamente inesperado: mantém o detalhe (ajuda no suporte) com um fallback.
  return rawMessage || `Não foi possível concluir agora (erro ${status}). Tente de novo.`
}

// Lê a Response como JSON com fallback: se o corpo não for JSON válido (ex: página de erro
// de plataforma da Vercel tipo "An error occurred with your deployment", devolvida em
// texto/HTML e não em JSON), gera uma mensagem de erro amigável em vez de vazar o
// SyntaxError do JSON.parse pro usuário.
export async function safeJson(res: Response): Promise<any> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(
      res.ok
        ? 'Resposta inválida do servidor. Tente novamente.'
        : `Erro na API: ${res.status}`
    )
  }
}
