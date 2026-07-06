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
  // Chamado antes de cada espera, com os segundos e o número da tentativa.
  onWait?: (secondsLeft: number, attempt: number) => void
}

// fetch que re-tenta sozinho quando a API responde 429 (limite atingido).
// Retorna a Response final (ok ou o último erro) — o chamador trata como antes.
export async function fetchWithRetry(
  input: RequestInfo,
  init: RequestInit,
  { retries = 3, onWait }: RetryOpts = {},
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(input, init)
    if (res.status !== 429 || attempt > retries) return res

    let ms = 30000
    try {
      ms = parseRetryMs(await res.clone().text())
    } catch {
      // corpo ilegível — usa fallback
    }
    onWait?.(Math.ceil(ms / 1000), attempt)
    await sleep(ms + 500)
  }
}
