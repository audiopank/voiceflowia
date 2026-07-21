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

async function verifySignature(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const digestHex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  // Normaliza antes de comparar: hex maiúsculo ou com espaço em volta é a mesma
  // assinatura, e reprovar por isso seria rejeitar evento legítimo.
  const recebida = signature.trim().toLowerCase()
  if (digestHex.length !== recebida.length) return false
  let diff = 0
  for (let i = 0; i < digestHex.length; i++) {
    diff |= digestHex.charCodeAt(i) ^ recebida.charCodeAt(i)
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

  if (!secret || !(await verifySignature(rawBody, signature, secret))) {
    // Diagnóstico sem vazar segredo: só a ORIGEM e o TAMANHO da assinatura, e
    // os NOMES dos cabeçalhos recebidos. Sem isto, "assinatura inválida" não
    // distingue segredo errado de assinatura em outro lugar — foi exatamente
    // essa ambiguidade que travou a configuração do webhook.
    console.warn(
      '[kiwify-webhook] assinatura inválida ou ausente |',
      `secret configurado: ${secret ? 'sim' : 'NÃO'} |`,
      `header x-kiwify-signature: ${sigHeader ? `sim (${sigHeader.length} chars)` : 'ausente'} |`,
      `query ?signature: ${sigQuery ? `sim (${sigQuery.length} chars)` : 'ausente'} |`,
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
  console.log(
    '[kiwify-webhook] evento recebido |',
    `chaves: ${Object.keys(body).join(', ')} |`,
    `rastreio s1 encontrado: ${extractAgentSlug(body) ? 'sim' : 'não'}`
  )

  const status = body.status ?? body.order_status ?? body.Status
  const customerEmail: string | undefined = body.customer?.email ?? body.Customer?.email
  const productName: string | undefined = body.product?.name ?? body.Product?.product_name
  const orderId: string | undefined = body.order_id ?? body.OrderId

  if (!customerEmail || !productName) {
    console.warn('[kiwify-webhook] payload sem customer/product no formato esperado')
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  if (!['APPROVED', 'ACTIVE', 'paid'].includes(status)) {
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
