import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'
import { computeTrial, type TrialState } from './trial'
import { computeCourtesy, type CourtesyState } from './courtesy'
import { computeRadarAccess, type RadarAccessState } from './radar'

interface SubscriptionState {
  plan: string | null
  status: string | null
  loading: boolean
  trial: TrialState
  courtesy: CourtesyState
  radar: RadarAccessState
}

const EMPTY_TRIAL = computeTrial(null)
const EMPTY_COURTESY = computeCourtesy(null)
const EMPTY_RADAR = computeRadarAccess(null)

export function useSubscription() {
  const [state, setState] = useState<SubscriptionState>({
    plan: null,
    status: null,
    loading: true,
    trial: EMPTY_TRIAL,
    courtesy: EMPTY_COURTESY,
    radar: EMPTY_RADAR,
  })

  const fetchSubscription = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setState({ plan: null, status: null, loading: false, trial: EMPTY_TRIAL, courtesy: EMPTY_COURTESY, radar: EMPTY_RADAR })
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('subscription_plan, subscription_status, trial_started_at, trial_generations_used, courtesy_expires_at')
      .eq('id', user.id)
      .single()

    if (error) {
      console.error('Erro ao buscar assinatura:', error)
      setState({ plan: null, status: null, loading: false, trial: EMPTY_TRIAL, courtesy: EMPTY_COURTESY, radar: EMPTY_RADAR })
      return
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
      plan: data?.subscription_plan || null,
      status: data?.subscription_status || null,
      loading: false,
      trial: computeTrial(data),
      courtesy: computeCourtesy(data),
      radar,
    })
  }, [])

  useEffect(() => {
    fetchSubscription()
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
    refresh: fetchSubscription,
  }
}
