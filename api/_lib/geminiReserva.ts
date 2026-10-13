// MODELO RESERVA COMPARTILHADO (13/10/2026). Pasta `_lib`: na Vercel, arquivo em pasta com
// "_" não vira função (não conta no teto de 12 funções Node do Hobby). Importar SEMPRE com
// extensão `.js` (o projeto é ESM; o TypeScript resolve `.js` → `.ts`). Provado na Vercel
// (preview 13/10) em função Edge e Node.
//
// Por quê: fila e cota da Gemini são POR MODELO. Quando o gemini-3.5-flash devolve 503
// "high demand", 429 de cota ou pendura (13/10: o Agente caiu assim em produção), os "lite"
// costumam responder. A cadeia tenta o principal e, SÓ em falha de fila/cota/servidor/tempo/
// formato, manda o MESMO corpo pro próximo modelo. Erro do pedido (400, chave) não muda de
// modelo pra modelo: para na hora. O orçamento total corta antes da plataforma matar a função.
// Perfis: 'curto' = até 22s (OBRIGATÓRIO em Edge, teto fixo ~25s; e em respostas que o cliente
// espera na tela); 'longo' = até 54s (só Node, maxDuration 60).
//
// TEMPO HERDADO (13/10, achado no teste): cada modelo ganha o MAIOR entre o seu teto e tudo o
// que sobrou do orçamento menos o mínimo reservado pros seguintes. Sem isso, com o principal
// recusando em 0,5s (429 de cota), os lite ficavam com 8s fixos, estouravam numa lista de
// ganchos e ~12s do orçamento sobravam sem uso.
//
// Padrão já provado no Kit de WhatsApp, Newsletter, Catálogo, Agente e Super Agente.

export type Perfil = 'curto' | 'longo'

const CADEIAS: Record<Perfil, { modelos: { id: string; tetoMs: number }[]; orcamentoMs: number; minimoMs: number }> = {
  curto: {
    modelos: [
      { id: 'gemini-3.5-flash', tetoMs: 12_000 },
      { id: 'gemini-3.5-flash-lite', tetoMs: 8_000 },
      { id: 'gemini-3.1-flash-lite', tetoMs: 8_000 }
    ],
    orcamentoMs: 22_000,
    minimoMs: 5_000
  },
  longo: {
    modelos: [
      { id: 'gemini-3.5-flash', tetoMs: 28_000 },
      { id: 'gemini-3.5-flash-lite', tetoMs: 16_000 },
      { id: 'gemini-3.1-flash-lite', tetoMs: 16_000 }
    ],
    orcamentoMs: 54_000,
    minimoMs: 8_000
  }
}

/** Por que a tentativa falhou — decide se passa pro próximo modelo e qual mensagem mostrar. */
export type TipoFalha = 'fila' | 'tempo' | 'formato' | 'rede' | 'pedido'

export type Resultado =
  | { ok: true; texto: string; modelo: string; reserva: boolean }
  | { ok: false; tipo: TipoFalha; status: number; motivo: string; modelo: string }

const STATUS_DE_FILA = [429, 500, 502, 503, 504]
// Tipos em que vale tentar OUTRO modelo. 'pedido' (400, chave inválida) falharia igual.
const PASSA_PRO_PROXIMO: TipoFalha[] = ['fila', 'tempo', 'formato', 'rede']

/**
 * Chama a Gemini com modelo reserva. `corpo` é o JSON do generateContent (contents +
 * generationConfig) — o mesmo vai pra todos os modelos. `aceita` decide se o texto serve
 * (ex.: JSON com o campo esperado); se não servir, conta como falha de formato e passa pro
 * próximo. `orcamentoMs` opcional encurta a cadeia.
 */
export async function gerarComReserva(opts: {
  apiKey: string
  corpo: unknown
  rotulo: string
  perfil: Perfil
  aceita?: (texto: string) => boolean
  orcamentoMs?: number
}): Promise<Resultado> {
  const cadeia = CADEIAS[opts.perfil]
  const orcamento = Math.min(opts.orcamentoMs ?? cadeia.orcamentoMs, cadeia.orcamentoMs)
  const body = JSON.stringify(opts.corpo)
  const inicio = Date.now()
  let ultimo: Resultado = { ok: false, tipo: 'tempo', status: 504, motivo: 'sem tempo pra tentar', modelo: '' }

  for (let i = 0; i < cadeia.modelos.length; i++) {
    const restante = orcamento - (Date.now() - inicio)
    if (restante < cadeia.minimoMs) break
    const { id, tetoMs } = cadeia.modelos[i]
    const seguintes = cadeia.modelos.length - i - 1
    // Tempo herdado: o que sobrou, menos o mínimo de cada modelo que ainda vem depois.
    const teto = Math.min(restante, Math.max(tetoMs, restante - seguintes * cadeia.minimoMs))
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${id}:generateContent?key=${opts.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(teto)
        }
      )
      if (!response.ok) {
        const bruto = await response.text()
        console.error(`Erro Gemini (${opts.rotulo}, ${id}):`, bruto.slice(0, 600))
        let detalhe = ''
        try {
          detalhe = JSON.parse(bruto)?.error?.message || ''
        } catch {
          // corpo não era JSON
        }
        ultimo = {
          ok: false,
          tipo: STATUS_DE_FILA.includes(response.status) ? 'fila' : 'pedido',
          status: response.status,
          motivo: detalhe || `Erro na API Gemini: ${response.status}`,
          modelo: id
        }
      } else {
        const data = await response.json()
        const parte = data?.candidates?.[0]?.content?.parts?.find((p: any) => typeof p?.text === 'string')
        const texto: string = parte?.text ?? ''
        let serve = texto.trim().length > 0
        if (serve && opts.aceita) {
          try {
            serve = opts.aceita(texto)
          } catch {
            serve = false
          }
        }
        if (serve) {
          if (i > 0) console.warn(`${opts.rotulo}: gerado pelo RESERVA ${id}`)
          return { ok: true, texto, modelo: id, reserva: i > 0 }
        }
        ultimo = { ok: false, tipo: 'formato', status: 502, motivo: 'resposta da IA vazia ou fora do formato', modelo: id }
      }
    } catch (err) {
      const demorou = (err as any)?.name === 'TimeoutError' || (err as any)?.name === 'AbortError'
      console.error(`Falha em ${id} (${opts.rotulo}):`, demorou ? `timeout (${teto}ms)` : err)
      ultimo = demorou
        ? { ok: false, tipo: 'tempo', status: 504, motivo: 'demorou demais', modelo: id }
        : { ok: false, tipo: 'rede', status: 502, motivo: 'falha de conexão com a IA', modelo: id }
    }
    if (!PASSA_PRO_PROXIMO.includes(ultimo.tipo)) break
    console.warn(`${opts.rotulo}: ${id} falhou (${ultimo.tipo} ${ultimo.status} ${ultimo.motivo.slice(0, 120)}) → próximo modelo`)
  }
  return ultimo
}

/** Resposta HTTP honesta pra quando nenhum modelo entregou — a mensagem diz o que houve. */
export function respostaDeFalha(r: Extract<Resultado, { ok: false }>): Response {
  const porTipo: Record<TipoFalha, { status: number; error: string }> = {
    fila: { status: 503, error: 'A IA do Google está sobrecarregada agora (todos os modelos ocupados). Tente de novo em alguns minutos.' },
    tempo: { status: 503, error: 'A IA do Google está demorando demais pra responder agora. Tente de novo em alguns minutos.' },
    formato: { status: 502, error: 'A IA respondeu fora do formato esperado. Tente de novo.' },
    rede: { status: 502, error: 'Falha de conexão com a IA do Google. Tente de novo.' },
    pedido: { status: r.status, error: r.motivo }
  }
  const { status, error } = porTipo[r.tipo]
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } })
}
