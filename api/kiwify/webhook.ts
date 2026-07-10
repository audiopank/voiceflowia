export const config = {
  runtime: 'edge'
}

export const maxDuration = 15

import { createClient } from '@supabase/supabase-js'

function resolvePlanFromProductName(name: string): string | null {
  const n = name.toLowerCase()
  if (n.includes('barbeiro')) return 'barbeiro'
  if (n.includes('crescimento')) return 'crescimento'
  if (n.includes('dominação') || n.includes('dominacao')) return 'dominacao'
  return null
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

  if (digestHex.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < digestHex.length; i++) {
    diff |= digestHex.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return diff === 0
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido' }), { status: 405 })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('x-kiwify-signature')
  const secret = process.env.KIWIFY_WEBHOOK_SECRET

  if (!secret || !(await verifySignature(rawBody, signature, secret))) {
    console.warn('[kiwify-webhook] assinatura inválida ou ausente')
    return new Response(JSON.stringify({ error: 'Assinatura inválida' }), { status: 401 })
  }

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400 })
  }

  // Log temporário e deliberado para o primeiro teste real — reduzir depois
  // de confirmar o path do parâmetro de rastreio (extractAgentSlug).
  console.log('[kiwify-webhook] payload recebido:', rawBody)

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

  const { data: existingProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, referred_by_agent_slug')
    .eq('email', customerEmail)
    .maybeSingle()

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
    const { error } = await supabaseAdmin
      .from('pending_kiwify_purchases')
      .upsert(
        {
          email: customerEmail,
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
