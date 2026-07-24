// VoiceFlow IA — cron diário de RE-ENGAJAMENTO (1x/dia, limite do Hobby).
// Acha clientes PAGOS e ativos que ficaram >= REMINDER_AFTER_DAYS sem gerar
// conteúdo e manda 1 e-mail (Resend) chamando de volta pra gerar o próximo mês.
// Gatilho comportamental (dias desde a última geração), não dia fixo do mês —
// o kit tem duração variável, então isto pega exatamente quem ficou dormente.
// Chamado pela Vercel Cron (ver vercel.json). Runtime Node.js (padrão { fetch }).

export const maxDuration = 60

import { createClient } from '@supabase/supabase-js'

const DAY_MS = 24 * 60 * 60 * 1000
// Dias sem gerar até o lembrete disparar. ~25 dá margem pra ele voltar e gerar o
// próximo mês antes de "acabar" o conteúdo. Fácil de ajustar depois.
const REMINDER_AFTER_DAYS = 25
const MAX_ENVIOS = 200 // teto de segurança por execução
const PLANOS_PAGOS = ['crescimento', 'dominacao']

// Envia o e-mail de re-engajamento. Sem RESEND_API_KEY/RESEND_FROM configurados,
// não faz nada (o lembrete fica dormente até o Mestre ligar o provider) — igual
// ao Radar. Retorna true só se o POST saiu sem lançar.
async function sendReminder(to: string, appUrl: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM // ex: "VoiceFlow IA <ola@seudominio.com>"
  if (!apiKey || !from || !to) return false
  const link = `${appUrl}/super-agente`
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to,
        subject: '⏰ Hora de gerar o conteúdo do próximo mês',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #1a1a1a;">
            <h2 style="color: #8B5CF6;">Seu próximo mês de conteúdo está a 1 clique 🚀</h2>
            <p>Faz um tempinho que você não gera conteúdo novo no VoiceFlow IA — e o feed não espera. 😉</p>
            <p>A boa notícia: a <strong>Memória da Marca</strong> já conhece as suas marcas, então o próximo kit sai
            <strong>melhor que o anterior</strong>, sem repetir os ângulos que você já usou.</p>
            <p style="text-align: center; margin: 28px 0;">
              <a href="${link}" style="background: #8B5CF6; color: #fff; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-weight: bold; display: inline-block;">
                Gerar o conteúdo do próximo mês
              </a>
            </p>
            <p style="color: #666; font-size: 13px;">Estratégia + roteiros + legendas + locução do mês em 1 clique.</p>
          </div>`,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    return res.ok
  } catch {
    // falha de e-mail não derruba o cron
    return false
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

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Supabase service role não configurado' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Dormente até o Mestre ligar o provider: se RESEND não está configurado, NÃO
  // tocamos em profiles. Sem esta guarda, o loop marcaria reminder_last_sent_at
  // de todo mundo (marca-antes-de-enviar) e o e-mail viraria no-op — queimando o
  // anti-spam de toda a coorte dormente sem enviar nada. Quando o RESEND for
  // ligado, ninguém dessa coorte receberia o lembrete até gerar de novo.
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
    return new Response(
      JSON.stringify({ ok: true, enviados: 0, motivo: 'resend_nao_configurado' }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }

  // A URL do app vem da própria origem em que a Vercel invocou o cron (domínio de
  // produção), com override opcional por env — sem hardcode de domínio.
  const appUrl = process.env.APP_URL || new URL(request.url).origin

  // Pagos e ativos, com e-mail. Selecionar reminder_last_sent_at aqui é de propósito:
  // se a coluna ainda não existe (migração não rodada), este select ERRA e a gente
  // ABORTA sem enviar nada — falha segura contra spam diário.
  const { data: profiles, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('id, email, reminder_last_sent_at')
    .in('subscription_plan', PLANOS_PAGOS)
    .eq('subscription_status', 'active')

  if (profErr) {
    // Provável causa: MIGRATION_REENGAJAMENTO.sql ainda não rodou. Não envia nada.
    return new Response(
      JSON.stringify({ ok: false, reason: 'migration_pending', detail: profErr.message }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const elegiveis = (profiles || []).filter((p: any) => typeof p.email === 'string' && p.email.includes('@'))
  if (elegiveis.length === 0) {
    return new Response(JSON.stringify({ ok: true, enviados: 0, motivo: 'sem clientes pagos ativos' }), { headers: { 'Content-Type': 'application/json' } })
  }

  const ids = elegiveis.map((p: any) => p.id)

  // Última geração de cada usuário (contents.created_at). Uma consulta ordenada
  // desc + reduce pega o topo (mais recente) por user_id.
  const { data: contentsRows } = await supabaseAdmin
    .from('contents')
    .select('user_id, created_at')
    .in('user_id', ids)
    .order('created_at', { ascending: false })

  const ultimaGeracao = new Map<string, number>()
  for (const row of contentsRows || []) {
    const uid = row?.user_id
    if (!uid || ultimaGeracao.has(uid)) continue // já temos a mais recente (ordem desc)
    const t = row?.created_at ? new Date(row.created_at).getTime() : NaN
    if (!Number.isNaN(t)) ultimaGeracao.set(uid, t)
  }

  const agora = Date.now()
  const cutoff = agora - REMINDER_AFTER_DAYS * DAY_MS
  let enviados = 0

  for (const p of elegiveis) {
    if (enviados >= MAX_ENVIOS) break

    const lastGen = ultimaGeracao.get(p.id)
    // Nunca gerou nada: é onboarding, não re-engajamento — fora do escopo deste cron.
    if (lastGen === undefined) continue
    // Ainda ativo (gerou nos últimos 25 dias): não incomoda.
    if (lastGen > cutoff) continue

    // Anti-spam: só reenvia se GEROU depois do último lembrete. Assim, um período
    // dormente rende no máximo 1 e-mail; o gatilho rearma quando ele volta a gerar.
    const lastReminder = p.reminder_last_sent_at ? new Date(p.reminder_last_sent_at).getTime() : 0
    if (lastReminder >= lastGen) continue

    // ENVIA PRIMEIRO; só marca o anti-spam se o e-mail REALMENTE saiu (res.ok).
    // Por que não marcar antes: com o Resend em MODO TESTE (sem domínio verificado)
    // o envio pra cliente falha e retorna false. Se marcássemos antes, a coorte
    // dormente inteira ficaria "já avisada" sem NUNCA ter recebido nada — pulada
    // até gerar de novo. Marcando só no sucesso, um envio falho apenas re-tenta no
    // próximo dia (nada entregue = nada de spam). O risco oposto (envio ok + update
    // falho => 1 e-mail repetido no dia seguinte) é raro e muito menor que queimar
    // toda a coorte em silêncio.
    const ok = await sendReminder(p.email, appUrl)
    if (!ok) continue

    await supabaseAdmin
      .from('profiles')
      .update({ reminder_last_sent_at: new Date(agora).toISOString() })
      .eq('id', p.id)
    enviados++
  }

  return new Response(JSON.stringify({ ok: true, candidatos: elegiveis.length, enviados }), { headers: { 'Content-Type': 'application/json' } })
}

export default { fetch: handler }
