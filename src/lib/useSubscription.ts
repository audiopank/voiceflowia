import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'
import { computeTrial, podeIniciarTrial, TRIAL_INTENT_KEY, type TrialState } from './trial'
import { computeCourtesy, type CourtesyState } from './courtesy'
import { computeRadarAccess, type RadarAccessState } from './radar'

interface SubscriptionState {
  plan: string | null
  status: string | null
  loading: boolean
  trial: TrialState
  courtesy: CourtesyState
  radar: RadarAccessState
  // Nunca teve trial e não é assinante pago — ou seja, ainda dá pra ativar.
  canStartTrial: boolean
}

const EMPTY_TRIAL = computeTrial(null)
const EMPTY_COURTESY = computeCourtesy(null)
const EMPTY_RADAR = computeRadarAccess(null)

const DESLOGADO: SubscriptionState = {
  plan: null,
  status: null,
  loading: false,
  trial: EMPTY_TRIAL,
  courtesy: EMPTY_COURTESY,
  radar: EMPTY_RADAR,
  canStartTrial: false,
}

// Resgate do trial em andamento, compartilhado entre todas as instâncias do hook.
// O hook é montado em mais de um lugar ao mesmo tempo (TrialStatus no __root + a
// página), e cada instância mantém o seu próprio estado. Guardar só um "já tentei"
// não bastava: uma instância iniciava o trial e as outras continuavam exibindo o
// perfil sem plano que tinham lido antes — o trial existia no banco e a pessoa
// seguia vendo "Upgrade para Crescimento". Compartilhando a promessa, todas
// aproveitam o MESMO resultado, e a RPC continua sendo chamada uma única vez.
let resgateEmAndamento: { userId: string; promessa: Promise<any | null> } | null = null

// Devolve a geração debitada quando a IA falhou e o cliente não recebeu nada.
// Tolerante de propósito: se a MIGRATION_TRIAL_DEVOLUCAO.sql ainda não foi rodada,
// a RPC não existe e isto falha calado — o comportamento volta a ser o de antes
// (cota queimada), nunca um erro na cara do cliente por cima do erro que já houve.
export async function devolverGeracaoTrial() {
  const { error } = await supabase.rpc('refund_trial_generation')
  if (error) console.error('Não consegui devolver a geração do trial:', error)
}

export function useSubscription() {
  const [state, setState] = useState<SubscriptionState>({
    plan: null,
    status: null,
    loading: true,
    trial: EMPTY_TRIAL,
    courtesy: EMPTY_COURTESY,
    radar: EMPTY_RADAR,
    canStartTrial: false,
  })

  const fetchSubscription = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      resgateEmAndamento = null
      setState(DESLOGADO)
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('subscription_plan, subscription_status, trial_started_at, trial_generations_used, courtesy_expires_at')
      .eq('id', user.id)
      .single()

    if (error) {
      console.error('Erro ao buscar assinatura:', error)
      setState(DESLOGADO)
      return
    }

    // RESGATE DO TRIAL: quem se cadastrou pedindo o trial mas caiu na confirmação
    // de e-mail nunca chegou a rodar o start_trial() — o signUp devolve sessão nula
    // e o cadastro termina ali. A pessoa confirmava o e-mail, entrava, e encontrava
    // "Acesso Restrito / faça upgrade": o trial que ela pediu nunca existiu. Aqui é
    // o primeiro ponto depois do login em que temos sessão + perfil, então é onde a
    // intenção guardada no cadastro vira trial de verdade.
    let perfil = data
    const querTrial = user.user_metadata?.[TRIAL_INTENT_KEY] === true
    if (querTrial && podeIniciarTrial(perfil)) {
      if (resgateEmAndamento?.userId !== user.id) {
        resgateEmAndamento = {
          userId: user.id,
          promessa: supabase.rpc('start_trial').then(({ data: iniciado, error: erroInicio }) => {
            if (erroInicio) {
              console.error('Erro ao resgatar trial pendente:', erroInicio)
              return null
            }
            return iniciado
          }),
        }
      }
      const iniciado = await resgateEmAndamento.promessa
      if (iniciado) perfil = { ...perfil, ...iniciado }
    }

    // Radar (add-on) é buscado SEPARADO e tolerante a falha de propósito: se a
    // coluna radar_expires_at ainda não existe (migração não rodada), isto falha
    // em silêncio e o Radar fica "sem acesso" — SEM afetar o resto do acesso.
    let radar = EMPTY_RADAR
    try {
      const { data: radarData } = await supabase
        .from('profiles')
        .select('radar_expires_at')
        .eq('id', user.id)
        .single()
      radar = computeRadarAccess(radarData)
    } catch {
      // coluna ausente / erro — mantém EMPTY_RADAR (sem acesso ao Radar)
    }

    setState({
      plan: perfil?.subscription_plan || null,
      status: perfil?.subscription_status || null,
      loading: false,
      trial: computeTrial(perfil),
      courtesy: computeCourtesy(perfil),
      radar,
      canStartTrial: podeIniciarTrial(perfil),
    })
  }, [])

  useEffect(() => {
    fetchSubscription()
  }, [fetchSubscription])

  // Ativação manual do trial — a rede de segurança final, para quem chegou até uma
  // tela bloqueada sem nunca ter tido trial. A RPC é anti-abuso: se a pessoa já usou
  // o trial antes, ela devolve o perfil intacto e nada muda.
  const startTrial = useCallback(async () => {
    const { error } = await supabase.rpc('start_trial')
    if (error) {
      console.error('Erro ao iniciar trial:', error)
      return false
    }
    await fetchSubscription()
    return true
  }, [fetchSubscription])

  // Acesso as features premium: assinante pago (respeitando expiração de
  // cortesia, se houver uma ativa) OU trial ainda ativo.
  const isPaidPlan = state.plan === 'crescimento' || state.plan === 'dominacao'
  const courtesyGated = state.courtesy.expiresAt !== null
  const hasAccess =
    (isPaidPlan && (!courtesyGated || state.courtesy.active)) ||
    state.trial.active

  // Acesso ao módulo Radar (add-on independente): entitlement paralelo, NÃO
  // depende de hasAccess/subscription_plan. Cliente pode ter só Radar, ou
  // Dominação + Radar, etc.
  const hasRadar = state.radar.active

  return {
    ...state,
    hasAccess,
    // Mesmo criterio de hasAccess; mantido pelo nome usado no Dashboard.
    hasContentAgentFeature: hasAccess,
    hasRadar,
    startTrial,
    refresh: fetchSubscription,
  }
}
