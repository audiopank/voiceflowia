export const config = {
  runtime: 'edge'
}

export const maxDuration = 15

import { createClient } from '@supabase/supabase-js'

function resolvePlanFromProductName(name: string): string | null {
  const n = name.toLowerCase()
  // RADAR PRO é add-on: NÃO é um subscription_plan, é um entitlement paralelo
  // (radar_expires_at). Checado antes dos planos de conteúdo. Ver handler abaixo.
  if (n.includes('radar')) return 'radar_pro'
  if (n.includes('barbeiro')) return 'barbeiro'
  if (n.includes('crescimento')) return 'crescimento'
  if (n.includes('dominação') || n.includes('dominacao')) return 'dominacao'
  return null
}

// Dias de acesso concedidos por pagamento de RADAR PRO. 32 = buffer pra não
// lapsar entre cobranças mensais da Kiwify (webhook chega a cada renovação).
const RADAR_DAYS = 32

// Rede de segurança: avisa o admin por email quando uma compra do Radar precisa
// de atenção. NUNCA lança — se o Resend falhar, o webhook segue e responde 200
// (um não-2xx faria a Kiwify reenviar o evento e duplicar o processamento).
// Obs: o Resend está em modo teste (sem domínio verificado), o que só entrega
// pro dono da conta — aqui o destinatário É o admin, então funciona mesmo assim.
async function notifyAdmin(subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM
  const to =
    process.env.ADMIN_ALERT_EMAIL || process.env.VITE_ADMIN_EMAIL || 'novaaudiopank@gmail.com'
  if (!apiKey || !from) {
    // Sem provider configurado o aviso morre aqui — deixa rastro no log, senão
    // a rede de segurança falha em silêncio justo quando é mais necessária.
    console.warn(`[kiwify-webhook] RESEND_API_KEY/RESEND_FROM ausentes — email não enviado: ${subject}`)
    return
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to, subject, html }),
      signal: AbortSignal.timeout(10_000),
    })
    // Resend recusa em silêncio (domínio não verificado, from inválido) com um
    // 4xx. Sem este log, o admin acharia que foi avisado e não foi. Usa text()
    // porque a resposta de erro nem sempre é JSON.
    if (!res.ok) {
      const detalhe = await res.text().catch(() => '')
      console.error(`[kiwify-webhook] Resend recusou o email (${res.status}): ${detalhe}`)
    }
  } catch {
    // falha de email não pode derrubar o webhook
  }
}

// Path exato do parametro de rastreio (s1) no payload da Kiwify ainda NAO
// esta confirmado pra esta conta — checa candidatos plausiveis e loga o
// corpo bruto ate confirmar no primeiro teste real (ver MIGRATION_REFERRALS.sql
// / plano do programa de indicacao, item de rollout "confirmar path do s1").
function extractAgentSlug(body: any): string | null {
  const candidates = [
    body?.TrackingParameters?.s1,
    body?.tracking_parameters?.s1,
    body?.Commissions?.trackingParameters?.s1,
    body?.checkout?.s1,
    body?.Checkout?.s1,
    body?.s1,
    body?.subscription?.s1,
    body?.sck,
    body?.src,
    body?.utm_source,
  ]
  const found = candidates.find((v) => typeof v === 'string' && v.trim().length > 0)
  return found ? found.trim().toLowerCase() : null
}

// Reembolso de verdade = timestamp que PARSEIA. Checar só "truthy" aceitaria a
// data-zero do MySQL ("0000-00-00"), que vaza em serialização de campo nulo e é
// truthy — e aí bloquearíamos uma compra legítima. Isso reintroduziria pela
// porta dos fundos exatamente o "cliente paga e não recebe" que a denylist
// existe pra evitar. Date.parse devolve NaN nesses casos.
function foiReembolsado(valor: unknown): boolean {
  if (typeof valor !== 'string') return false
  // Mínimo de 8 caracteres: uma data é "2026-07-21" (10) ou "20260721" (8).
  // Sem isto, Date.parse("0") vira ano 2000 — truthy e no passado, ou seja,
  // "0" seria lido como reembolso e bloquearia uma venda boa.
  const v = valor.trim()
  if (v.length < 8) return false
  const t = Date.parse(v)
  return Number.isFinite(t) && t > 0
}

async function hmacHex(rawBody: string, secret: string, hash: 'SHA-1' | 'SHA-256'): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash },
    false,
    ['sign']
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function verifySignature(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false

  // Normaliza antes de comparar: hex maiúsculo ou com espaço em volta é a mesma
  // assinatura, e reprovar por isso seria rejeitar evento legítimo.
  const recebida = signature.trim().toLowerCase()

  // A Kiwify usa HMAC-SHA1 (hex, 40 chars), não SHA-256 — medido em 21/07/2026
  // pelo log de diagnóstico, com a assinatura chegando na query ?signature=.
  // A documentação pública dela não informa isso, e o código nasceu assumindo
  // SHA-256: nenhuma assinatura real jamais poderia bater. Escolhemos o
  // algoritmo pelo TAMANHO recebido (40 = SHA-1, 64 = SHA-256) pra continuar
  // funcionando se a Kiwify migrar pra SHA-256 sem avisar. Não enfraquece: o
  // atacante escolhe o algoritmo, mas segue precisando do segredo pra forjar
  // qualquer um dos dois.
  const esperado = await hmacHex(rawBody, secret, recebida.length === 40 ? 'SHA-1' : 'SHA-256')

  if (esperado.length !== recebida.length) return false
  let diff = 0
  for (let i = 0; i < esperado.length; i++) {
    diff |= esperado.charCodeAt(i) ^ recebida.charCodeAt(i)
  }
  return diff === 0
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido' }), { status: 405 })
  }

  const rawBody = await request.text()
  const secret = process.env.KIWIFY_WEBHOOK_SECRET

  // A Kiwify não documenta publicamente ONDE manda a assinatura, e o teste do
  // painel chegou aqui como 401. Aceitamos as duas formas usadas no mercado: o
  // cabeçalho e o parâmetro ?signature= na URL. Isto NÃO enfraquece nada — o
  // HMAC do corpo cru continua sendo exigido e conferido igual; só mudamos de
  // ONDE lemos a assinatura que vamos verificar.
  const sigHeader = request.headers.get('x-kiwify-signature')
  const sigQuery = new URL(request.url).searchParams.get('signature')
  const signature = sigHeader || sigQuery

  let assinaturaValida = false
  try {
    assinaturaValida = !!secret && (await verifySignature(rawBody, signature, secret))
  } catch (err) {
    // Se o runtime edge não suportar o algoritmo, crypto.subtle LANÇA. Sem este
    // catch a exceção viraria um 500 mudo — indistinguível de falha do Supabase,
    // com a Kiwify reenviando em looping e nenhuma pista no log. Mantemos 500
    // (e não 401) de propósito: 500 preserva a retentativa da Kiwify, enquanto
    // 401 descartaria um evento legítimo por causa de erro nosso.
    console.error('[kiwify-webhook] erro ao verificar assinatura (algoritmo indisponível no runtime?):', err)
    return new Response(JSON.stringify({ error: 'Erro interno' }), { status: 500 })
  }

  if (!assinaturaValida) {
    // Diagnóstico sem vazar segredo: só a ORIGEM e o TAMANHO da assinatura, e
    // os NOMES dos cabeçalhos recebidos. Sem isto, "assinatura inválida" não
    // distingue segredo errado de assinatura em outro lugar — foi exatamente
    // essa ambiguidade que travou a configuração do webhook.
    console.warn(
      '[kiwify-webhook] assinatura inválida ou ausente |',
      `secret configurado: ${secret ? 'sim' : 'NÃO'} |`,
      `header x-kiwify-signature: ${sigHeader ? `sim (${sigHeader.length} chars)` : 'ausente'} |`,
      `query ?signature: ${sigQuery ? `sim (${sigQuery.length} chars)` : 'ausente'} |`,
      // Qual algoritmo foi tentado: sem isto, "não bateu" não separa algoritmo
      // errado de segredo errado — a mesma ambiguidade já custou um ciclo hoje.
      `algoritmo tentado: ${signature && signature.trim().length === 40 ? 'SHA-1' : 'SHA-256'} |`,
      `corpo: ${rawBody.length} bytes |`,
      `headers recebidos: ${Array.from(request.headers.keys()).join(', ')}`
    )
    return new Response(JSON.stringify({ error: 'Assinatura inválida' }), { status: 401 })
  }

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400 })
  }

  // Diagnóstico de ESTRUTURA, não de conteúdo. Antes isto logava o rawBody
  // inteiro — inofensivo enquanto o webhook nunca recebeu nada, mas a partir do
  // primeiro evento real seriam nome, email, telefone, CPF e endereço do cliente
  // despejados no log da Vercel, um armazenamento de terceiro com retenção
  // própria. O propósito original (descobrir onde a Kiwify manda o parâmetro de
  // rastreio s1) é atendido pelas CHAVES e pelos candidatos, sem os valores
  // pessoais. O payload completo continua disponível em raw_payload no Supabase,
  // que é nosso e tem RLS.
  // Resolvido ANTES do log de propósito: o log precisa mostrar exatamente o
  // valor que o filtro abaixo vai julgar. Logar `order_status` direto enquanto o
  // filtro lê `status ?? order_status` faria o log mentir justamente no payload
  // atípico (os dois campos presentes e diferentes) — e é nesse caso que o log é
  // a única pista que temos.
  const status = body.status ?? body.order_status ?? body.Status

  console.log(
    '[kiwify-webhook] evento recebido |',
    `webhook_event_type: ${body.webhook_event_type ?? '(ausente)'} |`,
    `status: ${status ?? '(ausente)'} |`,
    `rastreio s1 encontrado: ${extractAgentSlug(body) ? 'sim' : 'não'}`
  )

  const customerEmail: string | undefined = body.customer?.email ?? body.Customer?.email
  const productName: string | undefined = body.product?.name ?? body.Product?.product_name
  const orderId: string | undefined = body.order_id ?? body.OrderId

  if (!customerEmail || !productName) {
    console.warn('[kiwify-webhook] payload sem customer/product no formato esperado')
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  // BLOQUEIO DE EVENTO DE SAÍDA — precisa vir ANTES da checagem de status.
  // `order_status` descreve a ORDEM, não o EVENTO: num reembolso ou chargeback a
  // ordem continua "paid" e o que muda é `refunded_at`. Sem esta guarda, um
  // reembolso entraria no caminho de ativação e CONCEDERIA acesso (no Radar,
  // renovaria +32 dias). Era inofensivo enquanto a assinatura barrava tudo;
  // passou a ser real agora que o webhook autentica.
  //
  // Denylist, não allowlist, de propósito: ainda não sabemos o valor exato de
  // webhook_event_type numa compra aprovada. Uma allowlist erraria pro lado de
  // recusar compra legítima ("cliente paga e não recebe"), que é pior do que
  // "quem pediu reembolso mantém acesso" — este último a gente corta na mão.
  // `refunded_at` sozinho já fecha o caso do reembolso, qualquer que seja o
  // nome do evento.
  const evento = String(body.webhook_event_type ?? '').trim().toLowerCase()
  const eventoDeSaida = ['order_refunded', 'chargeback', 'subscription_canceled', 'subscription_late'].includes(evento)
  if (foiReembolsado(body.refunded_at) || eventoDeSaida) {
    console.log(
      '[kiwify-webhook] evento de saída — NÃO concede acesso |',
      `webhook_event_type: ${evento || '(ausente)'} |`,
      `refunded_at presente: ${body.refunded_at ? 'sim' : 'não'} |`,
      `order_id: ${orderId ?? '(ausente)'}`
    )
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }

  // Comparação insensível a maiúsculas: a lista original ('APPROVED', 'ACTIVE',
  // 'paid') já misturava caixas, sinal de que ninguém tinha visto um evento real
  // — e de fato nenhum chegava, porque a assinatura barrava tudo antes. Um
  // "approved" minúsculo era descartado em silêncio, com 200 e sem log: compra
  // aprovada de verdade sumiria sem deixar rastro.
  const statusNormalizado = String(status ?? '').trim().toLowerCase()
  if (!['approved', 'active', 'paid'].includes(statusNormalizado)) {
    // Status e tipo de evento não são dado pessoal, e são exatamente o que
    // precisamos pra escrever a revogação por reembolso/chargeback depois.
    console.log(
      '[kiwify-webhook] evento ignorado |',
      `status: ${statusNormalizado || '(vazio)'} |`,
      `webhook_event_type: ${body.webhook_event_type ?? '(ausente)'}`
    )
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }

  const plan = resolvePlanFromProductName(productName)
  if (!plan) {
    console.log('[kiwify-webhook] produto não reconhecido:', productName)
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }

  const supabaseAdmin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const rawSlug = extractAgentSlug(body)
  let resolvedAgentSlug: string | null = null
  if (rawSlug) {
    const { data: agent } = await supabaseAdmin
      .from('expander_agents')
      .select('slug')
      .eq('slug', rawSlug)
      .eq('active', true)
      .maybeSingle()
    resolvedAgentSlug = agent?.slug ?? null
  }

  let { data: existingProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, referred_by_agent_slug')
    .eq('email', customerEmail)
    .maybeSingle()

  // A Kiwify pode devolver o email como o cliente digitou ("Fulano@Gmail.com"),
  // enquanto profiles.email vem do auth do Supabase, sempre normalizado. Sem
  // este segundo tiro, um cliente COM conta cairia no fluxo de "sem cadastro".
  // Só roda quando o match exato falhou, então nunca piora o resultado.
  if (!existingProfile && customerEmail !== customerEmail.toLowerCase()) {
    const { data: byLowercase } = await supabaseAdmin
      .from('profiles')
      .select('id, referred_by_agent_slug')
      .eq('email', customerEmail.toLowerCase())
      .maybeSingle()
    existingProfile = byLowercase
  }

  // RADAR PRO é add-on: concede o entitlement do Radar (radar_expires_at) SEM
  // tocar no subscription_plan (o cliente mantém Dominação/Crescimento etc).
  if (plan === 'radar_pro') {
    if (existingProfile) {
      const expires = new Date(Date.now() + RADAR_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const { error } = await supabaseAdmin
        .from('profiles')
        .update({ radar_expires_at: expires, updated_at: new Date().toISOString() })
        .eq('id', existingProfile.id)
      if (error) {
        console.error('[kiwify-webhook] erro ao conceder Radar:', error)
        return new Response(JSON.stringify({ error: 'Erro interno' }), { status: 500 })
      }
      console.log(`[kiwify-webhook] RADAR PRO ativado para ${customerEmail} até ${expires}`)
    } else {
      // Comprou o Radar antes de ter conta. Entra numa fila PRÓPRIA
      // (pending_radar_purchases) — não a pending_kiwify_purchases, cujo
      // subscription_plan é NOT NULL e é aplicado direto no profile pelo
      // handle_new_user: gravar 'radar_pro' ali sobrescreveria o plano de
      // conteúdo do cliente. O trigger on_auth_user_created_radar concede o
      // acesso sozinho no cadastro. Ver MIGRATION_RADAR_PENDING.sql.
      const emailNormalizado = customerEmail.toLowerCase()
      const { error } = await supabaseAdmin
        .from('pending_radar_purchases')
        .upsert(
          {
            email: emailNormalizado,
            radar_days: RADAR_DAYS,
            kiwify_order_id: orderId ?? null,
            raw_payload: body,
            processed: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'email' }
        )

      if (error) {
        // Aqui o cliente pagou e NÃO vai receber nada sozinho: é o caso que
        // exige ação humana. Grita no log e no email, mas responde 200 —
        // reenvio da Kiwify não resolveria (a migração é que provavelmente
        // não rodou) e só duplicaria eventos.
        console.error('[kiwify-webhook] FALHA ao enfileirar Radar pendente:', error)
        await notifyAdmin(
          `🚨 AÇÃO MANUAL: compra do Radar não registrada (${customerEmail})`,
          `<p><strong>${customerEmail}</strong> pagou o VoiceFlow RADAR, não tem conta no app e a fila de pendentes FALHOU.</p>
           <p>Erro: <code>${error.message}</code></p>
           <p>Causa provável: <code>MIGRATION_RADAR_PENDING.sql</code> ainda não rodou no Supabase.</p>
           <p><strong>O que fazer:</strong> rode a migração, peça pro cliente se cadastrar e, se ele já tiver se cadastrado, conceda com <code>grant_radar_access('${customerEmail}', 32)</code>.</p>`
        )
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }

      console.log(`[kiwify-webhook] Radar pendente enfileirado para ${emailNormalizado} (sem cadastro ainda)`)
      await notifyAdmin(
        `Radar vendido para ${customerEmail} — falta o cadastro`,
        `<p><strong>${customerEmail}</strong> comprou o VoiceFlow RADAR mas ainda não tem conta no app.</p>
         <p>O acesso (${RADAR_DAYS} dias) já está na fila e é liberado <strong>sozinho</strong> assim que essa pessoa se cadastrar com esse mesmo email — não precisa fazer nada.</p>
         <p>Vale só um empurrão: se ela não se cadastrar, não usa o que pagou.</p>`
      )
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }

  if (existingProfile) {
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({
        subscription_plan: plan,
        subscription_status: 'active',
        courtesy_expires_at: null, // pagamento real sobrepoe cortesia
        referred_by_agent_slug: existingProfile.referred_by_agent_slug ?? resolvedAgentSlug,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingProfile.id)

    if (error) {
      console.error('[kiwify-webhook] erro ao atualizar profile:', error)
      return new Response(JSON.stringify({ error: 'Erro interno' }), { status: 500 })
    }

    console.log(`[kiwify-webhook] plano ${plan} ativado para ${customerEmail}`)
  } else {
    // Email SEMPRE normalizado aqui. O handle_new_user() reconcilia com
    // `WHERE email = NEW.email`, comparação sensível a maiúsculas, e o
    // NEW.email vem do auth do Supabase já em minúsculas. Se a Kiwify mandar
    // o email como o cliente digitou ("Fulano@Gmail.com"), a linha nunca casa
    // no cadastro: o cliente paga o plano e ele simplesmente não chega, sem
    // erro em lugar nenhum. Normalizar na escrita fecha isso.
    const { error } = await supabaseAdmin
      .from('pending_kiwify_purchases')
      .upsert(
        {
          email: customerEmail.toLowerCase(),
          subscription_plan: plan,
          subscription_status: 'active',
          referred_by_agent_slug: resolvedAgentSlug,
          kiwify_order_id: orderId ?? null,
          raw_payload: body,
          processed: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'email' }
      )

    if (error) {
      console.error('[kiwify-webhook] erro ao gravar pending purchase:', error)
      return new Response(JSON.stringify({ error: 'Erro interno' }), { status: 500 })
    }

    console.log(`[kiwify-webhook] compra pendente registrada para ${customerEmail} (sem cadastro ainda)`)
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}
