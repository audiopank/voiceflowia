import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'
import { computeTrial, type TrialState } from './trial'

interface SubscriptionState {
  plan: string | null
  status: string | null
  loading: boolean
  trial: TrialState
}

const EMPTY_TRIAL = computeTrial(null)

export function useSubscription() {
  const [state, setState] = useState<SubscriptionState>({
    plan: null,
    status: null,
    loading: true,
    trial: EMPTY_TRIAL,
  })

  const fetchSubscription = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setState({ plan: null, status: null, loading: false, trial: EMPTY_TRIAL })
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('subscription_plan, subscription_status, trial_started_at, trial_generations_used')
      .eq('id', user.id)
      .single()

    if (error) {
      console.error('Erro ao buscar assinatura:', error)
      setState({ plan: null, status: null, loading: false, trial: EMPTY_TRIAL })
      return
    }

    setState({
      plan: data?.subscription_plan || null,
      status: data?.subscription_status || null,
      loading: false,
      trial: computeTrial(data),
    })
  }, [])

  useEffect(() => {
    fetchSubscription()
  }, [fetchSubscription])

  // Acesso as features premium: assinante pago OU trial ainda ativo.
  const hasAccess =
    state.plan === 'crescimento' ||
    state.plan === 'dominacao' ||
    state.trial.active

  return {
    ...state,
    hasAccess,
    // Mesmo criterio de hasAccess; mantido pelo nome usado no Dashboard.
    hasContentAgentFeature: hasAccess,
    refresh: fetchSubscription,
  }
}
