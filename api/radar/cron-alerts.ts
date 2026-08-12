// VoiceFlow Radar — cron diário (1x/dia, limite do Hobby). Pra cada cliente com
// Radar ativo: busca leve de menções da marca, detecta crise/palavra-chave e
// grava alerta + manda email (Resend). Chamado pela Vercel Cron (ver vercel.json).
// Runtime Node.js (padrão { fetch }).

export const maxDuration = 60

import { createClient } from '@supabase/supabase-js'

const GEMINI_MODEL = 'gemini-3.5-flash'
const MAX_CONFIGS = 25 // teto de segurança por execução (protege os créditos do Serper)

interface Hit {
  texto: string
  url: string
  fonte: string
  classificacao: string
  motivo: string
}

// Serper.dev (Google Search API): POST com header X-API-KEY, resposta em `organic`.
async function serpBrand(brand: string, apiKey: string): Promise<Hit[]> {
  const out: Hit[] = []
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: `"${brand}"`, gl: 'br', hl: 'pt', num: 15 }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return out
    const data: any = await res.json()
    if (!Array.isArray(data.organic)) return out
    for (const r of data.organic) {
      const link = r.link || ''
      const texto = [r.title, r.snippet].filter(Boolean).join(' — ').slice(0, 400)
      if (!texto) continue
      const fonte = link ? new URL(link).hostname.replace('www.', '') : 'busca'
      out.push({ texto, url: link, fonte, classificacao: '', motivo: '' })
    }
  } catch {
    // ignora rede/timeout
  }
  return out
}

async function geminiClassify(apiKey: string, nicho: string, brand: string, hits: Hit[]): Promise<void> {
  if (!hits.length) return
  const lista = hits.map((h, i) => `${i}. ${h.texto}`).join('\n')
  const schema = {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        indice: { type: 'INTEGER' },
        classificacao: { type: 'STRING', enum: ['Positivo', 'Neutro', 'Negativo', 'Crise'] },
        motivo: { type: 'STRING' },
      },
      required: ['indice', 'classificacao', 'motivo'],
    },
  }
  const prompt = `Analise reputação da marca "${brand}" (nicho "${nicho}"). Classifique cada menção como Positivo, Neutro, Negativo ou Crise (Crise = golpe/fraude/processo/escândalo). Motivo em 1 frase. Array JSON com "indice", "classificacao", "motivo".\n\n${lista}`
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema } }),
        signal: AbortSignal.timeout(40_000),
      }
    )
    if (!res.ok) return
    const data: any = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.find((p: any) => typeof p.text === 'string')?.text
    if (!text) return
    const arr = JSON.parse(text)
    if (Array.isArray(arr)) {
      for (const item of arr) {
        const idx = Number(item.indice)
        if (hits[idx]) {
          hits[idx].classificacao = item.classificacao || 'Neutro'
          hits[idx].motivo = item.motivo || ''
        }
      }
    }
  } catch {
    // se falhar, segue só com o match de palavra-chave
  }
}

// Devolve true se o email saiu de fato — o chamador grava isso em notified_email,
// senão não há como auditar depois se o cliente foi avisado ou se o Resend estava
// fora do ar.
async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM // ex: "VoiceFlow Radar <alertas@seudominio.com>"
  if (!apiKey || !from || !to) return false // sem provider configurado: fica só no painel
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to, subject, html }),
      signal: AbortSignal.timeout(15_000),
    })
    return res.ok
  } catch {
    // falha de email não deve derrubar o cron
    return false
  }
}

// ---------------------------------------------------------------------------
// Resumo periódico
// ---------------------------------------------------------------------------

// Folga de algumas horas em cada janela: o cron não roda no segundo exato todo
// dia, e sem isso um atraso de minutos faria o resumo "diário" pular um dia.
const JANELA_HORAS: Record<string, number> = {
  diario: 20,
  semanal: 6.5 * 24,
  mensal: 29 * 24,
}

function resumoVencido(frequencia: string, ultimoIso: string | null): boolean {
  const janela = JANELA_HORAS[frequencia]
  if (!janela) return false // 'nunca' ou valor desconhecido: não manda nada
  if (!ultimoIso) return true // nunca recebeu: manda o primeiro na próxima passada
  const horas = (Date.now() - new Date(ultimoIso).getTime()) / 3_600_000
  return Number.isFinite(horas) ? horas >= janela : true
}

const ROTULO_PERIODO: Record<string, string> = {
  diario: 'de hoje',
  semanal: 'da semana',
  mensal: 'do mês',
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Monta o e-mail com DADO REAL: a contagem por sentimento vem da varredura que o
// cron acabou de fazer, e os alertas vêm da tabela. Nada é estimado — se algo
// não pôde ser classificado, o texto diz isso em vez de fingir um número.
function montarResumoHtml(
  marca: string,
  frequencia: string,
  hits: Hit[],
  alertasPeriodo: { mencao_texto: string; url: string; classificacao: string }[],
): string {
  const conta = { Positivo: 0, Neutro: 0, Negativo: 0, Crise: 0, semClassificacao: 0 }
  for (const h of hits) {
    const c = h.classificacao
    if (c === 'Positivo' || c === 'Neutro' || c === 'Negativo' || c === 'Crise') conta[c]++
    else conta.semClassificacao++
  }

  const periodo = ROTULO_PERIODO[frequencia] || 'do período'
  const linhas: string[] = []

  linhas.push(`<h2 style="margin:0 0 4px">Resumo ${periodo} — ${escapeHtml(marca)}</h2>`)
  linhas.push(`<p style="color:#555;margin:0 0 16px">VoiceFlow Radar · varredura de hoje na web</p>`)

  linhas.push(`<p><strong>${hits.length}</strong> menção(ões) encontradas na varredura de hoje:</p>`)
  linhas.push('<ul>')
  linhas.push(`<li>👍 Positivas: <strong>${conta.Positivo}</strong></li>`)
  linhas.push(`<li>😐 Neutras: <strong>${conta.Neutro}</strong></li>`)
  linhas.push(`<li>👎 Negativas: <strong>${conta.Negativo}</strong></li>`)
  linhas.push(`<li>🚨 Crise: <strong>${conta.Crise}</strong></li>`)
  if (conta.semClassificacao > 0) {
    linhas.push(`<li style="color:#888">Sem classificação (a IA não conseguiu analisar): ${conta.semClassificacao}</li>`)
  }
  linhas.push('</ul>')

  if (alertasPeriodo.length) {
    linhas.push(`<p><strong>${alertasPeriodo.length}</strong> alerta(s) desde o último resumo:</p><ul>`)
    for (const a of alertasPeriodo.slice(0, 10)) {
      const txt = escapeHtml((a.mencao_texto || '').slice(0, 160))
      const link = a.url ? ` — <a href="${escapeHtml(a.url)}">ver</a>` : ''
      linhas.push(`<li>[${escapeHtml(a.classificacao || '')}] ${txt}${link}</li>`)
    }
    linhas.push('</ul>')
    if (alertasPeriodo.length > 10) {
      linhas.push(`<p style="color:#888">+ ${alertasPeriodo.length - 10} alerta(s) no painel.</p>`)
    }
  } else {
    linhas.push('<p>Nenhum alerta disparado desde o último resumo. 👌</p>')
  }

  linhas.push('<p>Abra o VoiceFlow Radar pra ver o relatório completo e responder às menções.</p>')
  return linhas.join('')
}

async function handler(request: Request): Promise<Response> {
  // Segurança: a Vercel manda Authorization: Bearer <CRON_SECRET> quando a env existe.
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = request.headers.get('authorization') || ''
    if (auth !== `Bearer ${cronSecret}`) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    }
  }

  // Aceita os dois nomes: a chave foi cadastrada como SERPER_KEY, e exigir só
  // SERPER_API_KEY fazia o cron morrer no 500 sem o cliente perceber nada — nem
  // alerta, nem resumo, e nenhum sinal na tela dele.
  const serpKey = process.env.SERPER_API_KEY || process.env.SERPER_KEY
  const geminiKey = process.env.GEMINI_API_KEY
  if (!serpKey || !geminiKey) {
    return new Response(JSON.stringify({ error: 'SERPER_API_KEY (ou SERPER_KEY) / GEMINI_API_KEY não configuradas' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  const supabaseAdmin = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  // Só configs de usuários com Radar ativo.
  const nowIso = new Date().toISOString()
  const { data: profiles } = await supabaseAdmin.from('profiles').select('id, radar_expires_at').gt('radar_expires_at', nowIso)
  const activeIds = new Set((profiles || []).map((p: any) => p.id))
  if (activeIds.size === 0) return new Response(JSON.stringify({ ok: true, processed: 0 }), { headers: { 'Content-Type': 'application/json' } })

  const { data: configs } = await supabaseAdmin.from('radar_config').select('*').in('user_id', Array.from(activeIds)).limit(MAX_CONFIGS)
  let alertsCreated = 0
  let resumosEnviados = 0

  for (const cfg of configs || []) {
    // Um cliente com dado ruim não pode derrubar a varredura dos outros: qualquer
    // exceção inesperada aqui dentro só pula esse cliente e o cron segue.
    try {
      const marca: string = cfg.marca_nome
      if (!marca) continue
      const nicho: string = cfg.nicho || 'geral'
      const keywords: string[] = (Array.isArray(cfg.palavras_chave_alerta) ? cfg.palavras_chave_alerta : []).map((k: any) => String(k ?? '').toLowerCase())

      const hits = await serpBrand(marca, serpKey)
      if (!hits.length) continue
      await geminiClassify(geminiKey, nicho, marca, hits)

      // Dedup: não re-alertar URLs já alertadas nos últimos 30 dias.
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { data: recent } = await supabaseAdmin.from('radar_alertas').select('url').eq('user_id', cfg.user_id).gte('created_at', since)
      const alreadyAlerted = new Set((recent || []).map((r: any) => r.url).filter(Boolean))

      const novos = hits.filter((h) => {
        const isCrise = h.classificacao.toLowerCase() === 'crise'
        const kwHit = keywords.some((k) => k && h.texto.toLowerCase().includes(k))
        const dup = h.url && alreadyAlerted.has(h.url)
        return (isCrise || kwHit) && !dup
      })

      for (const h of novos) {
        // Manda o e-mail ANTES de gravar pra registrar o resultado real do envio:
        // antes gravava notified_email: false sempre, e não dava pra saber depois
        // se o cliente foi avisado ou se o Resend estava fora.
        const avisado = await sendEmail(
          cfg.alert_email,
          `🚨 ALERTA VOICEFLOW: menção negativa sobre ${marca}`,
          `<p><strong>ALERTA VOICEFLOW:</strong> Detectamos uma menção negativa sobre <strong>${escapeHtml(marca)}</strong>.</p>${h.url ? `<p>Veja: <a href="${escapeHtml(h.url)}">${escapeHtml(h.url)}</a></p>` : ''}<p>Abra o VoiceFlow Radar pra ver todos os alertas.</p>`,
        )
        const { error } = await supabaseAdmin.from('radar_alertas').insert({
          user_id: cfg.user_id, config_id: cfg.id, mencao_texto: h.texto.slice(0, 300),
          fonte: h.fonte, url: h.url, classificacao: h.classificacao || 'Negativo', motivo: h.motivo, notified_email: avisado,
        })
        if (!error) {
          alertsCreated++
          if (h.url) alreadyAlerted.add(h.url)
        }
      }

      // Resumo periódico na frequência escolhida pelo cliente. Aproveita a
      // varredura acima — não gasta busca extra do Serper.
      const frequencia: string = cfg.frequencia_resumo || 'semanal'
      if (cfg.alert_email && resumoVencido(frequencia, cfg.ultimo_resumo_at ?? null)) {
        const desde = cfg.ultimo_resumo_at ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        const { data: alertasPeriodo } = await supabaseAdmin
          .from('radar_alertas')
          .select('mencao_texto, url, classificacao')
          .eq('user_id', cfg.user_id)
          .gte('created_at', desde)
          .order('created_at', { ascending: false })

        const enviado = await sendEmail(
          cfg.alert_email,
          `Resumo ${ROTULO_PERIODO[frequencia] || 'do período'} — ${marca} | VoiceFlow Radar`,
          montarResumoHtml(marca, frequencia, hits, alertasPeriodo || []),
        )

        // Só grava ultimo_resumo_at se o e-mail saiu de verdade E o banco aceitou
        // a coluna. Se a migração ainda não rodou, o update falha e NÃO contamos
        // como enviado — assim o número do retorno não mente sobre o que persistiu.
        if (enviado) {
          const { error: updErr } = await supabaseAdmin
            .from('radar_config')
            .update({ ultimo_resumo_at: new Date().toISOString() })
            .eq('id', cfg.id)
          if (updErr) console.error('[radar-cron] não gravou ultimo_resumo_at (migração pendente?):', updErr.message)
          else resumosEnviados++
        }
      }
    } catch (e) {
      // Falha de um cliente não pode impedir os outros de serem processados.
      console.error('[radar-cron] falhou pro config', cfg?.id, e)
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: (configs || []).length, alertsCreated, resumosEnviados }), { headers: { 'Content-Type': 'application/json' } })
}

export default { fetch: handler }
