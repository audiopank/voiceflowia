import { useState, useEffect } from 'react'
import { supabase } from './supabase'

export function useSubscription() {
  const [subscription, setSubscription] = useState<{
    plan: string | null
    status: string | null
    loading: boolean
  }>({ plan: null, status: null, loading: true })

  useEffect(() => {
    const fetchSubscription = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setSubscription({ plan: null, status: null, loading: false })
        return
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('subscription_plan, subscription_status')
        .eq('id', user.id)
        .single()

      if (error) {
        console.error('Erro ao buscar assinatura:', error)
        setSubscription({ plan: null, status: null, loading: false })
        return
      }

      setSubscription({
        plan: data?.subscription_plan || null,
        status: data?.subscription_status || null,
        loading: false
      })
    }

    fetchSubscription()
  }, [])

  return subscription
}
