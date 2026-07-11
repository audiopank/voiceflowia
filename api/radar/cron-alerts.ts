// VoiceFlow Radar — cron diário (1x/dia, limite do Hobby). Pra cada cliente com
// Radar ativo: busca leve de menções da marca, detecta crise/palavra-chave e
// grava alerta + manda email (Resend). Chamado pela Vercel Cron (ver vercel.json).
// Runtime Node.js (padrão { fetch }).

export const maxDuration = 60

import { createClient } from '@supabase/supabase-js'

const GEMINI_MODEL = 'gemini-3.5-flash'
const MAX_CONFIGS = 25 // teto de segurança por execução (protege o free tier da SerpAPI)

interface Hit {
  texto: string
  url: string
  fonte: string
  classificacao: string
  motivo: string
}

async function serpBrand(brand: string, apiKey: string): Promise<Hit[]> {
  const out: Hit[] = []
  try {
    const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(`"${brand}"`)}&hl=pt&gl=br&num=15&api_key=${apiKey}`
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return out
    const data: any = await res.json()
    if (!Array.isArray(data.organic_results)) return out
    for (const r of data.organic_results) {
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

async function sendEmail(to: string, marca: string, url: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM // ex: "VoiceFlow Radar <alertas@seudominio.com>"
  if (!apiKey || !from || !to) return // sem provider configurado: alerta fica só no painel
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to,
        subject: `🚨 ALERTA VOICEFLOW: menção negativa sobre ${marca}`,
        html: `<p><strong>ALERTA VOICEFLOW:</strong> Detectamos uma menção negativa sobre <strong>${marca}</strong>.</p>${url ? `<p>Veja: <a href="${url}">${url}</a></p>` : ''}<p>Abra o VoiceFlow Radar pra ver todos os alertas.</p>`,
      }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    // falha de email não deve derrubar o cron
  }
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

  const serpKey = process.env.SERPAPI_KEY
  const geminiKey = process.env.GEMINI_API_KEY
  if (!serpKey || !geminiKey) {
    return new Response(JSON.stringify({ error: 'SERPAPI_KEY/GEMINI_API_KEY não configuradas' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  const supabaseAdmin = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  // Só configs de usuários com Radar ativo.
  const nowIso = new Date().toISOString()
  const { data: profiles } = await supabaseAdmin.from('profiles').select('id, radar_expires_at').gt('radar_expires_at', nowIso)
  const activeIds = new Set((profiles || []).map((p: any) => p.id))
  if (activeIds.size === 0) return new Response(JSON.stringify({ ok: true, processed: 0 }), { headers: { 'Content-Type': 'application/json' } })

  const { data: configs } = await supabaseAdmin.from('radar_config').select('*').in('user_id', Array.from(activeIds)).limit(MAX_CONFIGS)
  let alertsCreated = 0

  for (const cfg of configs || []) {
    const marca: string = cfg.marca_nome
    if (!marca) continue
    const nicho: string = cfg.nicho || 'geral'
    const keywords: string[] = (Array.isArray(cfg.palavras_chave_alerta) ? cfg.palavras_chave_alerta : []).map((k: string) => k.toLowerCase())

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
      const { error } = await supabaseAdmin.from('radar_alertas').insert({
        user_id: cfg.user_id, config_id: cfg.id, mencao_texto: h.texto.slice(0, 300),
        fonte: h.fonte, url: h.url, classificacao: h.classificacao || 'Negativo', motivo: h.motivo, notified_email: false,
      })
      if (!error) {
        alertsCreated++
        await sendEmail(cfg.alert_email, marca, h.url)
        if (h.url) alreadyAlerted.add(h.url)
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: (configs || []).length, alertsCreated }), { headers: { 'Content-Type': 'application/json' } })
}

export default { fetch: handler }
