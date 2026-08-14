// VoiceFlow Radar — gera o relatório semanal: busca menções (Serper.dev),
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
  relevante?: boolean // false = xará (outra empresa/pessoa de mesmo nome, fora do nicho)
  // true = a PRÓPRIA marca publicou (anúncio, post do perfil dela, divulgação de
  // parceiro). Não é opinião do público — entra separado pra não inflar a nota.
  propria?: boolean
}

// Abaixo disso a nota vira estatística de nada: com 2 ou 3 menções um único post
// move a nota 30 pontos. Melhor dizer "amostra pequena" do que fingir precisão.
const MIN_MENCOES_NOTA = 5

// Stopwords PT-BR pra limpar a nuvem de palavras.
const STOPWORDS = new Set([
  'a','o','e','de','da','do','das','dos','em','um','uma','uns','umas','para','por','com','sem','no','na','nos','nas',
  'que','se','os','as','ao','aos','à','às','ou','mais','mas','como','sua','seu','suas','seus','meu','minha','este','esta',
  'isso','ele','ela','eles','elas','você','voce','vocês','muito','já','ja','não','nao','sim','the','and','of','to','in',
  'is','it','for','on','com.br','www','https','http','br','pt','são','sao','foi','ser','tem','está','esta','pra','pelo','pela',
])

// Sobras da raspagem, não são termos de marca: aparecem porque o Serper devolve
// o texto do post junto do rótulo da plataforma ("Photo posted by...", "Publicação
// de...", "Citação de Seguidores"). Sem isso a nuvem enche de ruído.
const RUIDO_SCRAPING = new Set([
  'photo','posted','publicacao','publicacoes','citacao','citacoes','instagram','facebook','linkedin',
  'twitter','threads','tiktok','youtube','post','posts','stories','reels','perfil','pagina','link',
  'clique','saiba','veja','confira','acesse','image','video','videos','feed',
])

// `marca` entra como stopword: o nome da própria marca aparece em TODA menção
// (é o termo da busca), então dominava a nuvem sem informar nada.
function tokenize(texts: string[], marca = ''): Record<string, number> {
  const termosMarca = new Set(
    marca
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  )
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
      if (RUIDO_SCRAPING.has(w)) continue
      if (termosMarca.has(w)) continue
      counts[w] = (counts[w] || 0) + 1
    }
  }
  // Mantém só as top ~40 pra não inchar o JSONB.
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 40)
  )
}

// Serper.dev (Google Search API): POST com header X-API-KEY; resposta tem
// `organic` (busca) e `news` (endpoint /news).
async function serperSearch(q: string, apiKey: string, num: number, endpoint: 'search' | 'news'): Promise<any | null> {
  try {
    const res = await fetch(`https://google.serper.dev/${endpoint}`, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl: 'br', hl: 'pt', num }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function serpMentions(brand: string, nicho: string, extras: string[], apiKey: string): Promise<Mencao[]> {
  const out: Mencao[] = []
  const seen = new Set<string>()

  const add = (rows: any, isNews: boolean) => {
    if (!Array.isArray(rows)) return
    for (const r of rows) {
      const link = r.link || ''
      if (link && seen.has(link)) continue
      if (link) seen.add(link)
      const texto = [r.title, r.snippet].filter(Boolean).join(' — ').slice(0, 400)
      if (!texto) continue
      const fonte = r.source || (link ? new URL(link).hostname.replace('www.', '') : isNews ? 'notícia' : 'busca')
      out.push({ fonte: String(fonte), texto, url: link, classificacao: '', motivo: '' })
    }
  }

  // Nicho definido (ex: "aparelhos auditivos") vira contexto pra desambiguar xarás:
  // uma busca ENVIESADA pelo nicho traz a marca certa mesmo quando ela tem pouca
  // presença na web e um "xará" domina os resultados. Vem primeiro pra priorizar.
  const temNicho = !!nicho && nicho !== 'geral'
  if (temNicho) {
    const ctx = await serperSearch(`"${brand}" ${nicho}`, apiKey, 15, 'search')
    if (ctx) add(ctx.organic, false)
  }
  const web = await serperSearch(`"${brand}"`, apiKey, 20, 'search')
  if (web) add(web.organic, false)
  const news = await serperSearch(brand, apiKey, 20, 'news')
  if (news) add(news.news, true)
  // Reputação em avaliações/reclamações via busca dirigida.
  for (const extra of extras) {
    const r = await serperSearch(`"${brand}" ${extra}`, apiKey, 10, 'search')
    if (r) add(r.organic, false)
  }

  return out.slice(0, 40)
}

interface SentCount {
  positivo: number
  neutro: number
  negativo: number
  crise: number
}

interface ConcorrenteAnalise {
  nome: string
  total: number
  sentimento: SentCount
  score: number
  classificado: boolean // false = IA não classificou OU sem menções → score não é confiável
}

// Nota de Reputação 0-100 a partir da contagem de sentimentos. Positivo puxa pra cima,
// negativo é neutro-baixo, crise penaliza pesado. Sem menções = 0.
function reputationScore(s: SentCount): number {
  const total = s.positivo + s.neutro + s.negativo + s.crise
  if (!total) return 0
  const raw = (s.positivo * 1 + s.neutro * 0.5 + s.negativo * 0 + s.crise * -0.5) / total
  return Math.max(0, Math.min(100, Math.round(raw * 100)))
}

// Chama o Gemini com RETRY: o free tier engasga (429/timeout) com frequência e uma 2ª
// tentativa costuma pegar. Em caso de erro HTTP, inclui o motivo real do Google (ex:
// "quota exceeded") na mensagem — pra diagnóstico, em vez de só "Gemini 429".
async function geminiJson(apiKey: string, prompt: string, schema: any, attempts = 2): Promise<any> {
  let lastErr: unknown = null
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
          }),
          signal: AbortSignal.timeout(20_000),
        }
      )
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        let detalhe = ''
        try {
          detalhe = JSON.parse(body)?.error?.message || ''
        } catch {
          detalhe = body.slice(0, 140)
        }
        const httpErr = new Error(`Gemini ${res.status}${detalhe ? `: ${detalhe}` : ''}`)
        ;(httpErr as any).status = res.status
        throw httpErr
      }
      const data: any = await res.json()
      const text = data.candidates?.[0]?.content?.parts?.find((p: any) => typeof p.text === 'string')?.text
      if (!text) throw new Error('Gemini sem conteúdo')
      return JSON.parse(text)
    } catch (err) {
      lastErr = err
      // 429 = cota estourada: a janela só reseta em ~37s e retentar em 1.5s só queima outra
      // das 20 req/min do free tier. Não retenta (só timeout/rede/5xx é que vale retry).
      if ((err as any)?.status === 429) break
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Gemini falhou')
}

// Análise de reputação dos concorrentes (dado já capturado na config, antes ignorado).
// Limita a 3 concorrentes e busca em PARALELO pra não estourar o maxDuration; classifica
// TODAS as menções numa ÚNICA chamada Gemini pra economizar cota do free tier.
async function analisarConcorrentes(
  concorrentes: string[],
  serpKey: string,
  geminiKey: string,
  nicho: string,
): Promise<ConcorrenteAnalise[]> {
  const limit = concorrentes.slice(0, 3)
  if (!limit.length) return []

  // Buscas em paralelo (uma por concorrente).
  const buscas = await Promise.all(
    limit.map(async (nome) => {
      const web = await serperSearch(`"${nome}"`, serpKey, 8, 'search')
      const mencoes: string[] = []
      const seen = new Set<string>()
      if (web && Array.isArray(web.organic)) {
        for (const r of web.organic) {
          const link = r.link || ''
          if (link && seen.has(link)) continue
          if (link) seen.add(link)
          const texto = [r.title, r.snippet].filter(Boolean).join(' — ').slice(0, 300)
          if (texto) mencoes.push(texto)
        }
      }
      return { nome, mencoes: mencoes.slice(0, 8) }
    }),
  )

  // Achata todas as menções tagueando de qual concorrente vieram.
  const flat: { comp: number; texto: string; classificacao: string; propria?: boolean }[] = []
  buscas.forEach((c, ci) => c.mencoes.forEach((texto) => flat.push({ comp: ci, texto, classificacao: '' })))

  let classifyOk = false
  if (flat.length) {
    try {
      const lista = flat.map((f, i) => `${i}. ${f.texto}`).join('\n')
      // Pede `propria` aqui TAMBÉM: a nota da marca do cliente já exclui anúncio
      // dela mesma. Se a do concorrente continuasse incluindo (e anúncio é quase
      // sempre "Positivo"), a mesma barra compararia régua diferente e empurraria
      // o cliente pra baixo — exatamente o inverso do que se quis corrigir.
      const prompt = `Você analisa reputação de marcas no nicho "${nicho}". Para cada menção abaixo (sobre marcas concorrentes):
1. "classificacao": Positivo, Neutro, Negativo ou Crise (Crise = golpe/fraude/processo/escândalo).
2. "propria": true se quem PUBLICOU foi a própria marca mencionada ou alguém divulgando por ela (anúncio, post institucional, comunicado); false se é um TERCEIRO falando sobre ela. Na dúvida, true.
3. "motivo": 1 frase curta.
Responda um array JSON com um item por menção: "indice", "classificacao", "propria", "motivo".\n\nMenções:\n${lista}`
      const arr = await geminiJson(geminiKey, prompt, CLASSIFY_SCHEMA, 1)
      if (Array.isArray(arr)) {
        classifyOk = true
        for (const it of arr) {
          const idx = Number(it.indice)
          if (flat[idx]) {
            flat[idx].classificacao = it.classificacao || 'Neutro'
            flat[idx].propria = it.propria === true
          }
        }
      }
    } catch {
      // Gemini fora: classifyOk fica false → score marcado como não confiável (UI mostra "—").
    }
  }

  return buscas.map((c, ci) => {
    const s: SentCount = { positivo: 0, neutro: 0, negativo: 0, crise: 0 }
    for (const f of flat) {
      if (f.comp !== ci) continue
      // Mesma régua da marca do cliente: anúncio da própria empresa fica fora da nota.
      // Só dá pra separar quando a IA classificou (senão `propria` vem indefinido).
      if (classifyOk && f.propria === true) continue
      const cl = (f.classificacao || 'neutro').toLowerCase()
      if (cl === 'positivo') s.positivo++
      else if (cl === 'negativo') s.negativo++
      else if (cl === 'crise') s.crise++
      else s.neutro++
    }
    const total = s.positivo + s.neutro + s.negativo + s.crise
    // classificado só é confiável se a IA classificou E o concorrente teve menções.
    // Amostra pequena não vira nota: comparar uma marca nova com "Instagram" achando
    // 7 menções do Instagram no mundo e cravando 79 é ruído com cara de dado — e a
    // barra verde ao lado da nota real do cliente sugere um empate que não existe.
    return {
      nome: c.nome,
      total,
      sentimento: s,
      score: reputationScore(s),
      classificado: classifyOk && total >= MIN_MENCOES_NOTA,
    }
  })
}

const CLASSIFY_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      indice: { type: 'INTEGER' },
      classificacao: { type: 'STRING', enum: ['Positivo', 'Neutro', 'Negativo', 'Crise'] },
      motivo: { type: 'STRING' },
      // Opcionais (só o classify da MARCA pede). Fora do `required` pra não
      // obrigar o classify dos concorrentes a devolver.
      relevante: { type: 'BOOLEAN' }, // desambigua xarás
      propria: { type: 'BOOLEAN' },   // publicado PELA marca (anúncio/post próprio)
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
    // Aceita os dois nomes: a chave está cadastrada como SERPER_KEY.
    const serpKey = process.env.SERPER_API_KEY || process.env.SERPER_KEY
    const geminiKey = process.env.GEMINI_API_KEY
    if (!geminiKey) return new Response(JSON.stringify({ error: 'GEMINI_API_KEY não configurada' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    if (!serpKey) return new Response(JSON.stringify({ error: 'SERPER_API_KEY (ou SERPER_KEY) não configurada' }), { status: 500, headers: { 'Content-Type': 'application/json' } })

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

    // 1) Menções (Serper.dev): marca + nicho (desambigua xarás) + termos de reputação.
    const mencoes = await serpMentions(marca, nicho, ['reclame aqui', 'avaliações', 'reclamação'], serpKey)

    // 2+3) Classificação de sentimento E tendências: 2 chamadas Gemini
    // INDEPENDENTES rodadas em PARALELO (Promise.all) — não sequencial. Isso
    // mantém o tempo total ~= 1 chamada (não a soma), crítico porque o Gemini
    // free tier é lento/instável (ver memória gemini-free-tier-billing): com
    // timeout de 25s cada, o pior caso é ~25s e cabe folgado no maxDuration=60,
    // devolvendo relatório útil (menções + nuvem + alertas por palavra-chave, que
    // NÃO dependem do Gemini) mesmo quando o Gemini está fora — em vez de 504.
    // Marca se a IA REALMENTE classificou o sentimento. Quando o Gemini está fora/lento
    // (free tier), tudo cai pra "Neutro" no fallback — e antes isso era indistinguível de
    // uma marca genuinamente neutra. Persistimos esse flag pra UI avisar "não classificado"
    // em vez de mostrar 100% neutro como se fosse real.
    let sentimentoOk = false
    let classifyErro = '' // motivo real da falha do Gemini (pra diagnóstico na UI)
    const classifyTask = (async () => {
      if (mencoes.length === 0) return
      const lista = mencoes.map((m, i) => `${i}. ${m.texto}`).join('\n')
      const prompt = `Você analisa reputação da marca "${marca}", que atua no nicho "${nicho}". Para cada menção abaixo:
1. "relevante": true se a menção é MESMO sobre a marca "${marca}" do nicho "${nicho}"; false se for um XARÁ — outra empresa, pessoa ou produto de nome igual/parecido, mas de outro ramo (ex: uma empresa homônima de outro setor).
2. "propria": true se quem PUBLICOU foi a própria marca ou alguém divulgando por ela — anúncio, post institucional, "conheça a ${marca}", comunicado de marco ("já somos X membros"), material promocional, post do perfil oficial. false quando é um TERCEIRO falando sobre a marca (cliente, jornalista, usuário comentando, avaliação). Na dúvida entre os dois, marque true.
3. "classificacao": Positivo, Neutro, Negativo ou Crise (Crise = ameaça séria: acusação de golpe/fraude, ameaça de processo, escândalo).
4. "motivo": 1 frase curta.
Responda um array JSON com um item por menção: "indice" (número da menção), "relevante", "propria", "classificacao", "motivo".\n\nMenções:\n${lista}`
      try {
        const arr = await geminiJson(geminiKey, prompt, CLASSIFY_SCHEMA)
        if (Array.isArray(arr)) {
          sentimentoOk = true
          for (const item of arr) {
            const idx = Number(item.indice)
            if (mencoes[idx]) {
              mencoes[idx].classificacao = item.classificacao || 'Neutro'
              mencoes[idx].motivo = item.motivo || ''
              mencoes[idx].relevante = item.relevante !== false // só false explícito descarta
              mencoes[idx].propria = item.propria === true // só true explícito separa
            }
          }
        }
      } catch (err) {
        // Gemini fora/lento: deixa como Neutro e sentimentoOk = false (UI avisa).
        classifyErro = err instanceof Error ? err.message : 'Falha desconhecida no Gemini'
      }
    })()

    const trendsTask = (async (): Promise<string[]> => {
      try {
        const tPrompt = `Você é estrategista de conteúdo. Liste 3 tendências de conteúdo para redes sociais no nicho "${nicho}" nesta semana, cada uma como uma frase acionável (o que postar e por quê). Responda JSON { "tendencias": ["...", "...", "..."] }.`
        const tData = await geminiJson(geminiKey, tPrompt, TRENDS_SCHEMA, 1)
        if (Array.isArray(tData?.tendencias)) return tData.tendencias.slice(0, 5)
      } catch {
        // tendências são opcionais
      }
      return []
    })()

    // Análise de concorrentes (roda em paralelo com classify/trends).
    const concorrentesCfg: string[] = Array.isArray(config.concorrentes) ? config.concorrentes.filter(Boolean) : []
    const competitorsTask = concorrentesCfg.length
      ? analisarConcorrentes(concorrentesCfg, serpKey, geminiKey, nicho)
      : Promise.resolve([] as ConcorrenteAnalise[])

    const [, tendencias, concorrentesAnalise] = await Promise.all([classifyTask, trendsTask, competitorsTask])
    for (const m of mencoes) if (!m.classificacao) m.classificacao = 'Neutro'
    // Sem menções não há o que classificar — não é falha (evita aviso falso).
    if (mencoes.length === 0) sentimentoOk = true

    // Filtra XARÁS: quando a IA classificou, descarta o que ela marcou como não relevante
    // (outra empresa/pessoa de mesmo nome, fora do nicho). Sem classificação não dá pra
    // julgar → mantém tudo (a UI já avisa "não classificado").
    const coletadas = mencoes.length
    const mencoesRel = sentimentoOk ? mencoes.filter((m) => m.relevante !== false) : mencoes
    const descartadas = coletadas - mencoesRel.length

    // REPUTAÇÃO = o que TERCEIROS falam. Anúncio e post do perfil da própria marca
    // são divulgação, não opinião — contar isso como "positivo" inflava a nota e dava
    // conforto falso (quem posta muito via nota alta). Ficam guardados e exibidos,
    // mas fora do cálculo. Sem classificação da IA não dá pra separar → conta tudo.
    const mencoesProprias = sentimentoOk ? mencoesRel.filter((m) => m.propria === true) : []
    const mencoesTerceiros = sentimentoOk ? mencoesRel.filter((m) => m.propria !== true) : mencoesRel

    // 4) Sentimento agregado + nuvem de palavras (só de TERCEIROS).
    const sentimento = { positivo: 0, neutro: 0, negativo: 0, crise: 0 }
    for (const m of mencoesTerceiros) {
      const c = m.classificacao.toLowerCase()
      if (c === 'positivo') sentimento.positivo++
      else if (c === 'negativo') sentimento.negativo++
      else if (c === 'crise') sentimento.crise++
      else sentimento.neutro++
    }
    const palavras = tokenize(mencoesTerceiros.map((m) => m.texto), marca)

    // `classificado` (1/0), `descartadas`, `proprias` e `amostraMinima` viajam junto do
    // sentimento (mesma coluna JSONB, sem migration nova). A UI usa pra distinguir neutro
    // real de "IA não classificou", avisar dos xarás e não exibir nota de amostra minúscula.
    const sentimentoStore = {
      ...sentimento,
      classificado: sentimentoOk ? 1 : 0,
      descartadas,
      proprias: mencoesProprias.length,
      amostraMinima: MIN_MENCOES_NOTA,
    }

    const sufixoProprias = mencoesProprias.length
      ? ` Outras ${mencoesProprias.length} menção(ões) são publicações da própria marca (anúncio/divulgação) e ficam FORA da nota — nota mede o que terceiros dizem.`
      : ''
    const resumo = !coletadas
      ? `Não encontramos menções relevantes de "${marca}" na web nesta rodada. Tente novamente mais tarde ou ajuste o nome da marca.`
      : !sentimentoOk
        ? `Coletamos ${coletadas} menções sobre "${marca}", mas a IA não conseguiu classificar o sentimento nesta rodada (sobrecarga temporária do Gemini). Gere o relatório novamente em alguns instantes.`
        : mencoesRel.length === 0
          ? `Encontramos ${coletadas} menções com o nome "${marca}", mas todas eram de outra empresa/contexto (mesmo nome, nicho diferente). Nenhuma menção da sua marca nesta rodada.`
          : mencoesTerceiros.length === 0
            ? `Encontramos ${mencoesRel.length} menção(ões) de "${marca}", mas TODAS são publicações da própria marca (anúncio/divulgação). Ninguém de fora falou da marca nesta rodada — por isso não há nota de reputação.${descartadas > 0 ? ` (${descartadas} descartadas por serem de outra empresa de mesmo nome.)` : ''}`
            : `Analisamos ${mencoesTerceiros.length} menção(ões) de terceiros sobre "${marca}": ${sentimento.positivo} positivas, ${sentimento.neutro} neutras, ${sentimento.negativo} negativas e ${sentimento.crise} de crise.${sufixoProprias}${descartadas > 0 ? ` (${descartadas} descartadas por serem de outra empresa de mesmo nome.)` : ''}`

    // 5) Grava relatório (só as menções relevantes). A coluna `concorrentes` é da migration
    // 1.1 — se ela ainda não foi rodada no Supabase, o insert com esse campo falha. Nesse
    // caso, regrava SEM ele (degrada pra relatório sem comparativo) em vez de quebrar.
    const baseRow = { user_id: user.id, config_id: config.id, resumo, sentimento: sentimentoStore, mencoes: mencoesRel, tendencias, palavras }
    let { data: rel, error: relErr } = await supabaseAdmin
      .from('radar_relatorios')
      .insert({ ...baseRow, concorrentes: concorrentesAnalise })
      .select()
      .single()
    if (relErr) {
      ;({ data: rel, error: relErr } = await supabaseAdmin.from('radar_relatorios').insert(baseRow).select().single())
    }
    if (relErr) return new Response(JSON.stringify({ error: `Erro ao salvar relatório: ${relErr.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' } })

    // 6) Gera alertas. Crise SEMPRE alerta. Palavra-chave alerta só quando a menção
    // NÃO é positiva: quem põe o nome da própria marca como palavra-chave fazia todo
    // elogio virar "alerta de crise" — e alerta que apita pra elogio é alerta que o
    // cliente aprende a ignorar, justo pra quando vier problema de verdade.
    const lowerKeywords = keywords.map((k) => k.toLowerCase())
    const alertas = mencoesRel
      .filter((m) => {
        const c = m.classificacao.toLowerCase()
        if (c === 'crise') return true
        if (c === 'positivo') return false
        return lowerKeywords.some((k) => k && m.texto.toLowerCase().includes(k))
      })
      .map((m) => ({
        user_id: user.id, config_id: config.id, mencao_texto: m.texto.slice(0, 300),
        fonte: m.fonte, url: m.url, classificacao: m.classificacao, motivo: m.motivo, notified_email: false,
      }))
    if (alertas.length) await supabaseAdmin.from('radar_alertas').insert(alertas)

    // Diagnóstico (não persistido): só volta quando a IA falhou, pra UI mostrar o motivo
    // real (429/cota/billing) em vez de deixar o Mestre adivinhando.
    const payload = classifyErro && !sentimentoOk ? { ...rel, diagnostico: classifyErro } : rel
    return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } })
  } catch (error) {
    console.error('Erro no radar generate-report:', error)
    return new Response(JSON.stringify({ error: 'Erro ao gerar relatório' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

export default { fetch: handler }
