// VoiceFlow Radar — gera o relatório semanal: busca menções (SerpAPI),
// classifica sentimento (Gemini), sugere tendências (Gemini), monta nuvem de
// palavras, e grava relatório + alertas. Runtime Node.js (padrão { fetch }).

export const maxDuration = 60

import { createClient } from '@supabase/supabase-js'

const GEMINI_MODEL = 'gemini-3.5-flash'

interface Mencao {
  fonte: string
  texto: string
  url: string
  classificacao: string
  motivo: string
}

// Stopwords PT-BR pra limpar a nuvem de palavras.
const STOPWORDS = new Set([
  'a','o','e','de','da','do','das','dos','em','um','uma','uns','umas','para','por','com','sem','no','na','nos','nas',
  'que','se','os','as','ao','aos','à','às','ou','mais','mas','como','sua','seu','suas','seus','meu','minha','este','esta',
  'isso','ele','ela','eles','elas','você','voce','vocês','muito','já','ja','não','nao','sim','the','and','of','to','in',
  'is','it','for','on','com.br','www','https','http','br','pt','são','sao','foi','ser','tem','está','esta','pra','pelo','pela',
])

function tokenize(texts: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const t of texts) {
    const words = (t || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
    for (const w of words) {
      if (w.length < 4) continue
      if (STOPWORDS.has(w)) continue
      counts[w] = (counts[w] || 0) + 1
    }
  }
  // Mantém só as top ~40 pra não inchar o JSONB.
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 40)
  )
}

async function serpMentions(brand: string, extras: string[], apiKey: string): Promise<Mencao[]> {
  const queries = [
    { engine: 'google', q: `"${brand}"` },
    { engine: 'google_news', q: brand },
  ]
  const out: Mencao[] = []
  const seen = new Set<string>()

  for (const { engine, q } of queries) {
    try {
      const url = `https://serpapi.com/search.json?engine=${engine}&q=${encodeURIComponent(q)}&hl=pt&gl=br&num=20&api_key=${apiKey}`
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (!res.ok) continue
      const data: any = await res.json()
      const rows = engine === 'google_news' ? data.news_results : data.organic_results
      if (!Array.isArray(rows)) continue
      for (const r of rows) {
        const link = r.link || r.source?.link || ''
        if (link && seen.has(link)) continue
        if (link) seen.add(link)
        const texto = [r.title, r.snippet].filter(Boolean).join(' — ').slice(0, 400)
        if (!texto) continue
        const fonte = r.source?.name || r.source || (link ? new URL(link).hostname.replace('www.', '') : engine)
        out.push({ fonte: String(fonte), texto, url: link, classificacao: '', motivo: '' })
      }
    } catch {
      // rede/timeout/parse — ignora essa query, segue a próxima.
    }
  }
  // Também procura reputação em avaliações/reclamações via busca dirigida.
  for (const extra of extras) {
    try {
      const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(`"${brand}" ${extra}`)}&hl=pt&gl=br&num=10&api_key=${apiKey}`
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) continue
      const data: any = await res.json()
      if (!Array.isArray(data.organic_results)) continue
      for (const r of data.organic_results) {
        const link = r.link || ''
        if (link && seen.has(link)) continue
        if (link) seen.add(link)
        const texto = [r.title, r.snippet].filter(Boolean).join(' — ').slice(0, 400)
        if (!texto) continue
        const fonte = link ? new URL(link).hostname.replace('www.', '') : 'busca'
        out.push({ fonte, texto, url: link, classificacao: '', motivo: '' })
      }
    } catch {
      // ignora
    }
  }

  return out.slice(0, 40)
}

async function geminiJson(apiKey: string, prompt: string, schema: any): Promise<any> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
      }),
      signal: AbortSignal.timeout(45_000),
    }
  )
  if (!res.ok) throw new Error(`Gemini ${res.status}`)
  const data: any = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.find((p: any) => typeof p.text === 'string')?.text
  if (!text) throw new Error('Gemini sem conteúdo')
  return JSON.parse(text)
}

const CLASSIFY_SCHEMA = {
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

const TRENDS_SCHEMA = {
  type: 'OBJECT',
  properties: { tendencias: { type: 'ARRAY', items: { type: 'STRING' } } },
  required: ['tendencias'],
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido' }), { status: 405, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    const serpKey = process.env.SERPAPI_KEY
    const geminiKey = process.env.GEMINI_API_KEY
    if (!geminiKey) return new Response(JSON.stringify({ error: 'GEMINI_API_KEY não configurada' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    if (!serpKey) return new Response(JSON.stringify({ error: 'SERPAPI_KEY não configurada' }), { status: 500, headers: { 'Content-Type': 'application/json' } })

    const supabaseAdmin = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

    // Autentica o usuário pelo token da sessão (escreve dado por-usuário).
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
    if (userErr || !userData?.user) return new Response(JSON.stringify({ error: 'Sessão inválida' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    const user = userData.user

    // Confere entitlement do Radar (defesa em profundidade além do gate no client).
    const { data: profile } = await supabaseAdmin.from('profiles').select('radar_expires_at').eq('id', user.id).maybeSingle()
    const radarActive = profile?.radar_expires_at && new Date(profile.radar_expires_at).getTime() > Date.now()
    if (!radarActive) return new Response(JSON.stringify({ error: 'Sem acesso ao Radar' }), { status: 403, headers: { 'Content-Type': 'application/json' } })

    const { data: config } = await supabaseAdmin.from('radar_config').select('*').eq('user_id', user.id).maybeSingle()
    if (!config || !config.marca_nome) return new Response(JSON.stringify({ error: 'Configure sua marca primeiro (Monitor de Marca).' }), { status: 400, headers: { 'Content-Type': 'application/json' } })

    const marca: string = config.marca_nome
    const nicho: string = config.nicho || 'geral'
    const keywords: string[] = Array.isArray(config.palavras_chave_alerta) ? config.palavras_chave_alerta : []

    // 1) Menções (SerpAPI): marca + termos de reputação comuns.
    const mencoes = await serpMentions(marca, ['reclame aqui', 'avaliações', 'reclamação'], serpKey)

    // 2) Classificação de sentimento (1 chamada Gemini pra todas).
    if (mencoes.length > 0) {
      const lista = mencoes.map((m, i) => `${i}. ${m.texto}`).join('\n')
      const prompt = `Você analisa reputação de marca no nicho "${nicho}". Para cada menção abaixo sobre a marca "${marca}", classifique o sentimento como Positivo, Neutro, Negativo ou Crise (Crise = ameaça séria à reputação: acusação de golpe/fraude, ameaça de processo, escândalo). Dê o motivo em 1 frase curta. Responda um array JSON com um item por menção, cada um com "indice" (o número da menção), "classificacao" e "motivo".\n\nMenções:\n${lista}`
      try {
        const arr = await geminiJson(geminiKey, prompt, CLASSIFY_SCHEMA)
        if (Array.isArray(arr)) {
          for (const item of arr) {
            const idx = Number(item.indice)
            if (mencoes[idx]) {
              mencoes[idx].classificacao = item.classificacao || 'Neutro'
              mencoes[idx].motivo = item.motivo || ''
            }
          }
        }
      } catch {
        // Se a classificação falhar, deixa como Neutro (não trava o relatório).
      }
    }
    for (const m of mencoes) if (!m.classificacao) m.classificacao = 'Neutro'

    // 3) Tendências do nicho (sugeridas por IA — rotulado como tal no client).
    let tendencias: string[] = []
    try {
      const tPrompt = `Você é estrategista de conteúdo. Liste 3 tendências de conteúdo para redes sociais no nicho "${nicho}" nesta semana, cada uma como uma frase acionável (o que postar e por quê). Responda JSON { "tendencias": ["...", "...", "..."] }.`
      const tData = await geminiJson(geminiKey, tPrompt, TRENDS_SCHEMA)
      if (Array.isArray(tData?.tendencias)) tendencias = tData.tendencias.slice(0, 5)
    } catch {
      // tendências são opcionais
    }

    // 4) Sentimento agregado + nuvem de palavras.
    const sentimento = { positivo: 0, neutro: 0, negativo: 0, crise: 0 }
    for (const m of mencoes) {
      const c = m.classificacao.toLowerCase()
      if (c === 'positivo') sentimento.positivo++
      else if (c === 'negativo') sentimento.negativo++
      else if (c === 'crise') sentimento.crise++
      else sentimento.neutro++
    }
    const palavras = tokenize(mencoes.map((m) => m.texto))

    const resumo = mencoes.length
      ? `Analisamos ${mencoes.length} menções sobre "${marca}" na web: ${sentimento.positivo} positivas, ${sentimento.neutro} neutras, ${sentimento.negativo} negativas e ${sentimento.crise} de crise.`
      : `Não encontramos menções relevantes de "${marca}" na web nesta rodada. Tente novamente mais tarde ou ajuste o nome da marca.`

    // 5) Grava relatório.
    const { data: rel, error: relErr } = await supabaseAdmin
      .from('radar_relatorios')
      .insert({ user_id: user.id, config_id: config.id, resumo, sentimento, mencoes, tendencias, palavras })
      .select()
      .single()
    if (relErr) return new Response(JSON.stringify({ error: `Erro ao salvar relatório: ${relErr.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' } })

    // 6) Gera alertas: Crise OU menção que bate com palavra-chave.
    const lowerKeywords = keywords.map((k) => k.toLowerCase())
    const alertas = mencoes
      .filter((m) => m.classificacao.toLowerCase() === 'crise' || lowerKeywords.some((k) => k && m.texto.toLowerCase().includes(k)))
      .map((m) => ({
        user_id: user.id, config_id: config.id, mencao_texto: m.texto.slice(0, 300),
        fonte: m.fonte, url: m.url, classificacao: m.classificacao, motivo: m.motivo, notified_email: false,
      }))
    if (alertas.length) await supabaseAdmin.from('radar_alertas').insert(alertas)

    return new Response(JSON.stringify(rel), { headers: { 'Content-Type': 'application/json' } })
  } catch (error) {
    console.error('Erro no radar generate-report:', error)
    return new Response(JSON.stringify({ error: 'Erro ao gerar relatório' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

export default { fetch: handler }
