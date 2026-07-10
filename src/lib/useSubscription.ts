import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'
import { computeTrial, type TrialState } from './trial'
import { computeCourtesy, type CourtesyState } from './courtesy'

interface SubscriptionState {
  plan: string | null
  status: string | null
  loading: boolean
  trial: TrialState
  courtesy: CourtesyState
}

const EMPTY_TRIAL = computeTrial(null)
const EMPTY_COURTESY = computeCourtesy(null)

export function useSubscription() {
  const [state, setState] = useState<SubscriptionState>({
    plan: null,
    status: null,
    loading: true,
    trial: EMPTY_TRIAL,
    courtesy: EMPTY_COURTESY,
  })

  const fetchSubscription = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setState({ plan: null, status: null, loading: false, trial: EMPTY_TRIAL, courtesy: EMPTY_COURTESY })
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('subscription_plan, subscription_status, trial_started_at, trial_generations_used, courtesy_expires_at')
      .eq('id', user.id)
      .single()

    if (error) {
      console.error('Erro ao buscar assinatura:', error)
      setState({ plan: null, status: null, loading: false, trial: EMPTY_TRIAL, courtesy: EMPTY_COURTESY })
      return
    }

    setState({
      plan: data?.subscription_plan || null,
      status: data?.subscription_status || null,
      loading: false,
      trial: computeTrial(data),
      courtesy: computeCourtesy(data),
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

  return {
    ...state,
    hasAccess,
    // Mesmo criterio de hasAccess; mantido pelo nome usado no Dashboard.
    hasContentAgentFeature: hasAccess,
    refresh: fetchSubscription,
  }
}
