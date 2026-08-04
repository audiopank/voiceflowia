// VoiceFlow IA — cron diário de RE-ENGAJAMENTO + FOLLOW-UP DE TRIAL (1x/dia).
// O Hobby da Vercel tem teto de 2 crons e os dois slots já estão em uso (Radar +
// este), então TODO e-mail comportamental pega carona nesta execução. Três
// segmentos, cada um com o próprio anti-spam e a própria falha segura:
//   1. reengajamento — pago ativo >= 25 dias sem gerar → "gere o próximo mês"
//   2. trial expirado — User_7_dias_Free que expirou (tempo OU 10 gerações) e não
//      assinou → follow-up de venda, 1x, copy muda conforme o uso
//   3. trial esperando — cadastrou pedindo o trial (trial_intent) e nunca ativou
//
// Chamado pela Vercel Cron (ver vercel.json). Runtime Node.js (padrão { fetch }).

export const maxDuration = 60

import { createClient } from '@supabase/supabase-js'

const DAY_MS = 24 * 60 * 60 * 1000
// Dias sem gerar até o lembrete de reengajamento disparar. ~25 dá margem pra ele
// voltar e gerar o próximo mês antes de "acabar" o conteúdo.
const REMINDER_AFTER_DAYS = 25
const MAX_ENVIOS = 200 // teto de segurança por execução, somando os 3 segmentos
const PLANOS_PAGOS = ['crescimento', 'dominacao']

// Regras do trial — espelham src/lib/trial.ts. Duplicadas de propósito: o cron
// roda no runtime Node da Vercel e não deve importar nada do bundle do front.
const TRIAL_PLAN = 'User_7_dias_Free'
const TRIAL_DAYS = 7
const TRIAL_GENERATIONS = 10
// A partir de quantas gerações usadas o expirado é tratado como "lead quente"
// (levou a sério o teste): muda o assunto e o argumento do e-mail.
const USO_ALTO_MIN = 5
// Só olha trials iniciados há no máximo 45 dias: se o RESEND for ligado meses
// depois de um trial, ninguém de coorte antiga leva e-mail atrasado do nada.
const TRIAL_LOOKBACK_DAYS = 45
// "Trial esperando": espera 2 dias após o cadastro (dá chance de ativar sozinho)
// e desiste depois de 30 (cadastro frio demais pra cobrar ativação).
const WAITING_AFTER_DAYS = 2
const WAITING_LOOKBACK_DAYS = 30

interface EmailContent {
  subject: string
  html: string
}

function emailReengajamento(appUrl: string): EmailContent {
  const link = `${appUrl}/super-agente`
  return {
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
  }
}

// Follow-up de trial expirado. Quem usou muito é lead quente: o argumento é
// "continue de onde parou" (o histórico + a Memória da Marca são o custo de
// troca). Quem usou pouco leva um convite mais leve de conhecer os planos.
function emailTrialExpirado(appUrl: string, geracoesUsadas: number): EmailContent {
  const linkPrecos = `${appUrl}/precos`
  const linkConteudos = `${appUrl}/meus-conteudos`
  const usoAlto = geracoesUsadas >= USO_ALTO_MIN

  if (usoAlto) {
    return {
      subject: `Seu teste acabou — e suas ${geracoesUsadas} gerações de conteúdo continuam guardadas`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #1a1a1a;">
          <h2 style="color: #8B5CF6;">Você aproveitou o teste de verdade 👏</h2>
          <p>Foram <strong>${geracoesUsadas} gerações de conteúdo</strong> nos seus 7 dias — estratégia, roteiros,
          legendas e locução. Nada disso se perdeu: está tudo guardado na sua conta, em
          <a href="${linkConteudos}" style="color: #8B5CF6;">Meus Conteúdos</a>.</p>
          <p>Melhor ainda: a <strong>Memória da Marca</strong> já aprendeu o que você entregou. Assinando agora,
          o próximo kit continua exatamente de onde você parou — <strong>sem repetir nenhum ângulo</strong>.</p>
          <p style="text-align: center; margin: 28px 0;">
            <a href="${linkPrecos}" style="background: #8B5CF6; color: #fff; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-weight: bold; display: inline-block;">
              Continuar de onde parei
            </a>
          </p>
          <p style="color: #666; font-size: 13px;">Seu histórico e a memória da sua marca ficam te esperando.</p>
        </div>`,
    }
  }

  return {
    subject: 'Seu período de teste terminou (mas sua conta continua aqui)',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #1a1a1a;">
        <h2 style="color: #8B5CF6;">Seu teste de 7 dias chegou ao fim</h2>
        <p>Deu pouco tempo de explorar? Acontece. O que o VoiceFlow IA faz por você, em 1 clique:
        <strong>estratégia + roteiros + legendas + locução profissional do mês inteiro</strong> —
        você só grava por cima e posta.</p>
        <p>E cada geração alimenta a <strong>Memória da Marca</strong>: a IA aprende sua marca e nunca
        repete um ângulo que já entregou.</p>
        <p style="text-align: center; margin: 28px 0;">
          <a href="${linkPrecos}" style="background: #8B5CF6; color: #fff; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-weight: bold; display: inline-block;">
            Conhecer os planos
          </a>
        </p>
        <p style="color: #666; font-size: 13px;">Sua conta e o que você gerou continuam guardados.</p>
      </div>`,
  }
}

// "Trial esperando": criou a conta pedindo o teste e nunca ativou.
function emailTrialEsperando(appUrl: string): EmailContent {
  const link = `${appUrl}/dashboard`
  return {
    subject: '🎁 Seu teste grátis de 7 dias está te esperando',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #1a1a1a;">
        <h2 style="color: #8B5CF6;">Falta só 1 clique pra começar</h2>
        <p>Você criou sua conta no VoiceFlow IA, mas ainda não ativou seu <strong>teste grátis de 7 dias</strong>.</p>
        <p>São <strong>10 gerações de conteúdo</strong> pra você sentir na prática: estratégia, roteiros,
        legendas e locução profissional do mês — tudo em 1 clique, é só gravar por cima e postar.</p>
        <p style="text-align: center; margin: 28px 0;">
          <a href="${link}" style="background: #8B5CF6; color: #fff; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-weight: bold; display: inline-block;">
            Ativar meu teste grátis
          </a>
        </p>
        <p style="color: #666; font-size: 13px;">Sem cartão. Se não for pra você, é só deixar expirar.</p>
      </div>`,
  }
}

// Envia via Resend. Sem RESEND_API_KEY/RESEND_FROM configurados, não faz nada (o
// pipeline fica dormente até o Mestre ligar o provider) — igual ao Radar.
// Retorna true só se o POST saiu com res.ok.
async function sendEmail(to: string, content: EmailContent): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM // ex: "VoiceFlow IA <ola@seudominio.com>"
  if (!apiKey || !from || !to) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to, subject: content.subject, html: content.html }),
      signal: AbortSignal.timeout(15_000),
    })
    return res.ok
  } catch {
    // falha de e-mail não derruba o cron
    return false
  }
}

type SegmentoResult =
  | { candidatos: number; enviados: number }
  | { erro: string }

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)

  // Segurança: a Vercel manda Authorization: Bearer <CRON_SECRET> quando a env existe.
  // Também aceitamos ?key=<CRON_SECRET> na query, pra permitir o disparo manual do
  // MODO TESTE pelo navegador (que não manda header Authorization).
  // FAIL-CLOSED: sem CRON_SECRET setado, ninguém entra (o modo teste envia e-mail,
  // então nada de abrir a porta se a env sumir). Em produção o CRON_SECRET existe.
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return new Response(JSON.stringify({ error: 'CRON_SECRET não configurado' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }
  const auth = request.headers.get('authorization') || ''
  const keyParam = url.searchParams.get('key') || ''
  if (auth !== `Bearer ${cronSecret}` && keyParam !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Supabase service role não configurado' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Dormente até o Mestre ligar o provider: se RESEND não está configurado, NÃO
  // tocamos em profiles. Sem esta guarda, o loop marcaria os anti-spams
  // (marca-antes-de-enviar) e o e-mail viraria no-op — queimando as coortes
  // inteiras sem enviar nada.
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
    return new Response(
      JSON.stringify({ ok: true, enviados: 0, motivo: 'resend_nao_configurado' }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }

  // A URL do app vem da própria origem em que a Vercel invocou o cron (domínio de
  // produção), com override opcional por env — sem hardcode de domínio.
  const appUrl = process.env.APP_URL || url.origin

  // MODO TESTE: ?teste=<email>[&tipo=reengajamento|trial-expirado|trial-esperando]
  // manda UM e-mail de exemplo pro endereço indicado e encerra — NÃO lê nem toca em
  // profiles/clientes, NÃO mexe nos anti-spams. Serve pra conferir visual/entrega.
  // Atenção: com o Resend em modo teste (sem domínio verificado), só chega no
  // e-mail DONO da conta Resend.
  const testeEmail = (url.searchParams.get('teste') || '').trim()
  if (testeEmail) {
    if (!testeEmail.includes('@')) {
      return new Response(JSON.stringify({ ok: false, motivo: 'email_invalido' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    const tipo = (url.searchParams.get('tipo') || 'reengajamento').trim()
    const content =
      tipo === 'trial-expirado' ? emailTrialExpirado(appUrl, 7)
      : tipo === 'trial-esperando' ? emailTrialEsperando(appUrl)
      : emailReengajamento(appUrl)
    const ok = await sendEmail(testeEmail, content)
    return new Response(
      JSON.stringify({ ok, modo: 'teste', tipo, para: testeEmail, enviado: ok, aviso: ok ? undefined : 'Resend recusou o envio (provável modo teste: só entrega no e-mail dono da conta Resend).' }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }

  const agora = Date.now()
  // Teto de envios COMPARTILHADO entre os 3 segmentos (proteção de reputação/quota).
  let enviadosTotal = 0

  // ==========================================================================
  // Segmento 1 — RE-ENGAJAMENTO (pagos ativos dormentes)
  // ==========================================================================
  let reengajamento: SegmentoResult
  {
    // Selecionar reminder_last_sent_at aqui é de propósito: se a coluna ainda não
    // existe (MIGRATION_REENGAJAMENTO.sql não rodada), este select ERRA e o
    // segmento ABORTA sem enviar nada — falha segura contra spam diário.
    const { data: profiles, error: profErr } = await supabaseAdmin
      .from('profiles')
      .select('id, email, reminder_last_sent_at')
      .in('subscription_plan', PLANOS_PAGOS)
      .eq('subscription_status', 'active')

    if (profErr) {
      reengajamento = { erro: `migration_pending: ${profErr.message}` }
    } else {
      const elegiveis = (profiles || []).filter((p: any) => typeof p.email === 'string' && p.email.includes('@'))
      let enviados = 0

      if (elegiveis.length > 0) {
        const ids = elegiveis.map((p: any) => p.id)

        // Última geração de cada usuário (contents.created_at). Uma consulta
        // ordenada desc + reduce pega o topo (mais recente) por user_id.
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

        const cutoff = agora - REMINDER_AFTER_DAYS * DAY_MS

        for (const p of elegiveis) {
          if (enviadosTotal >= MAX_ENVIOS) break

          const lastGen = ultimaGeracao.get(p.id)
          // Nunca gerou nada: é onboarding, não re-engajamento — fora do escopo.
          if (lastGen === undefined) continue
          // Ainda ativo (gerou nos últimos 25 dias): não incomoda.
          if (lastGen > cutoff) continue

          // Anti-spam: só reenvia se GEROU depois do último lembrete. Assim, um
          // período dormente rende no máximo 1 e-mail; o gatilho rearma quando ele
          // volta a gerar.
          const lastReminder = p.reminder_last_sent_at ? new Date(p.reminder_last_sent_at).getTime() : 0
          if (lastReminder >= lastGen) continue

          // ENVIA PRIMEIRO; só marca o anti-spam se o e-mail REALMENTE saiu (res.ok).
          // Marcando antes, um Resend em modo teste (envio falha) queimaria a coorte
          // inteira em silêncio. Marcando só no sucesso, envio falho re-tenta amanhã
          // (nada entregue = nada de spam); o risco oposto (envio ok + update falho
          // => 1 repetido amanhã) é raro e bem menor.
          const ok = await sendEmail(p.email, emailReengajamento(appUrl))
          if (!ok) continue

          await supabaseAdmin
            .from('profiles')
            .update({ reminder_last_sent_at: new Date(agora).toISOString() })
            .eq('id', p.id)
          enviados++
          enviadosTotal++
        }
      }
      reengajamento = { candidatos: elegiveis.length, enviados }
    }
  }

  // ==========================================================================
  // Segmento 2 — TRIAL EXPIRADO (follow-up de venda, one-shot)
  // ==========================================================================
  let trialExpirado: SegmentoResult
  {
    // Selecionar trial_followup_email_sent_at é a falha segura: sem a coluna
    // (MIGRATION_TRIAL_FOLLOWUP.sql não rodada), o select erra e nada é enviado.
    const { data: trials, error: trialErr } = await supabaseAdmin
      .from('profiles')
      .select('id, email, trial_started_at, trial_generations_used, trial_followup_email_sent_at')
      .eq('subscription_plan', TRIAL_PLAN)
      .not('trial_started_at', 'is', null)

    if (trialErr) {
      trialExpirado = { erro: `migration_pending: ${trialErr.message}` }
    } else {
      const lookbackCutoff = agora - TRIAL_LOOKBACK_DAYS * DAY_MS
      const candidatos = (trials || []).filter((p: any) => {
        if (typeof p.email !== 'string' || !p.email.includes('@')) return false
        if (p.trial_followup_email_sent_at) return false // one-shot: já recebeu
        const inicio = new Date(p.trial_started_at).getTime()
        if (Number.isNaN(inicio) || inicio < lookbackCutoff) return false // coorte velha demais
        const usadas = p.trial_generations_used ?? 0
        const tempoEsgotado = agora > inicio + TRIAL_DAYS * DAY_MS
        const cotaEsgotada = usadas >= TRIAL_GENERATIONS
        return tempoEsgotado || cotaEsgotada // expirou de verdade (mesma régua do trial.ts)
      })

      let enviados = 0
      for (const p of candidatos) {
        if (enviadosTotal >= MAX_ENVIOS) break
        const ok = await sendEmail(p.email, emailTrialExpirado(appUrl, p.trial_generations_used ?? 0))
        if (!ok) continue
        await supabaseAdmin
          .from('profiles')
          .update({ trial_followup_email_sent_at: new Date(agora).toISOString() })
          .eq('id', p.id)
        enviados++
        enviadosTotal++
      }
      trialExpirado = { candidatos: candidatos.length, enviados }
    }
  }

  // ==========================================================================
  // Segmento 3 — TRIAL ESPERANDO (pediu no cadastro e nunca ativou, one-shot)
  // ==========================================================================
  let trialEsperando: SegmentoResult
  {
    // trial_intent mora no user_metadata do Auth (ver cadastro.tsx), não em
    // profiles — só a Admin API alcança. Paginado com teto de 5000 usuários;
    // muito acima disso a base já justifica mover o sinal pra uma coluna.
    const comIntencao: { id: string; email: string; criadoEm: number }[] = []
    let authErro: string | null = null
    for (let page = 1; page <= 5; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) {
        authErro = error.message
        break
      }
      for (const u of data?.users || []) {
        if (!u?.email || !(u as any).user_metadata?.trial_intent) continue
        const criadoEm = u.created_at ? new Date(u.created_at).getTime() : NaN
        if (Number.isNaN(criadoEm)) continue
        comIntencao.push({ id: u.id, email: u.email, criadoEm })
      }
      if (!data || data.users.length < 1000) break
    }

    if (authErro) {
      trialEsperando = { erro: `auth_admin: ${authErro}` }
    } else if (comIntencao.length === 0) {
      trialEsperando = { candidatos: 0, enviados: 0 }
    } else {
      // Cruza com profiles: só quem NUNCA iniciou o trial, não é pagante e ainda
      // não recebeu este e-mail. Select da coluna nova = mesma falha segura.
      const { data: perfis, error: perfErr } = await supabaseAdmin
        .from('profiles')
        .select('id, subscription_plan, trial_started_at, trial_waiting_email_sent_at')
        .in('id', comIntencao.map((u) => u.id))

      if (perfErr) {
        trialEsperando = { erro: `migration_pending: ${perfErr.message}` }
      } else {
        const perfilPorId = new Map((perfis || []).map((p: any) => [p.id, p]))
        const candidatos = comIntencao.filter((u) => {
          const p = perfilPorId.get(u.id)
          if (!p) return false // sem perfil ainda: cadastro incompleto, não cobra
          if (p.trial_started_at) return false // já ativou: o segmento 2 cuida dele
          if (PLANOS_PAGOS.includes(p.subscription_plan || '')) return false // virou cliente
          if (p.trial_waiting_email_sent_at) return false // one-shot: já recebeu
          const idadeDias = (agora - u.criadoEm) / DAY_MS
          return idadeDias >= WAITING_AFTER_DAYS && idadeDias <= WAITING_LOOKBACK_DAYS
        })

        let enviados = 0
        for (const u of candidatos) {
          if (enviadosTotal >= MAX_ENVIOS) break
          const ok = await sendEmail(u.email, emailTrialEsperando(appUrl))
          if (!ok) continue
          await supabaseAdmin
            .from('profiles')
            .update({ trial_waiting_email_sent_at: new Date(agora).toISOString() })
            .eq('id', u.id)
          enviados++
          enviadosTotal++
        }
        trialEsperando = { candidatos: candidatos.length, enviados }
      }
    }
  }

  return new Response(
    JSON.stringify({ ok: true, enviadosTotal, reengajamento, trialExpirado, trialEsperando }),
    { headers: { 'Content-Type': 'application/json' } },
  )
}

export default { fetch: handler }
