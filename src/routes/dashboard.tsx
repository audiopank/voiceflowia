import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { supabase } from '../lib/supabase'
import { useSubscription } from '../lib/useSubscription'
import { Lock, Volume2 } from 'lucide-react'

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
})

function Dashboard() {
  const [user, setUser] = useState<any>(null)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const subscription = useSubscription()
  const navigate = useNavigate()

  const hasContentAgentFeature = subscription.plan === 'crescimento' || subscription.plan === 'dominacao'
  const subscriptionActive = subscription.status === 'active'

  useEffect(() => {
    checkUser()
  }, [])

  async function checkUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      navigate({ to: '/login' })
      return
    }
    setUser(user)
    fetchData(user)
  }

  async function fetchData(user: any) {
    console.log('Buscando dados para usuário:', user)
    
    // Primeiro tenta por user_id
    let { data, error } = await supabase.from('Locutores IA Painel').select('*').eq('user_id', user.id)
    
    // Se não encontrar, tenta por cliente_email
    if ((!data || data.length === 0) && !error) {
      console.log('Nenhum dado por user_id, tentando por cliente_email:', user.email)
      const result = await supabase.from('Locutores IA Painel').select('*').eq('cliente_email', user.email)
      data = result.data
      error = result.error
    }
    
    if (error) {
      console.error('Erro ao buscar dados:', error)
    } else {
      console.log('Dados encontrados:', data)
      setData(data && data.length > 0 ? data[0] : null)
    }
    setLoading(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate({ to: '/login' })
  }

  if (loading || subscription.loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white">
        <div className="container mx-auto p-4 py-8">
          <h1 className="text-3xl font-bold mb-6">Carregando...</h1>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <div className="container mx-auto p-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold">Dashboard - VoiceFlow IA</h1>
            {subscription.plan && (
              <p className="text-[#8B5CF6] mt-1">
                Plano: {subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1)} {subscriptionActive ? '✅' : '(Inativo)'}
              </p>
            )}
          </div>
          <button onClick={handleLogout} className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700">
            Sair
          </button>
        </div>
        
        {/* Métricas */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
          <div className="bg-[#111111] border border-gray-800 rounded-lg p-6 shadow-sm">
            <h3 className="text-sm font-medium text-gray-400 mb-1">Mês</h3>
            <p className="text-2xl font-bold">{data?.mes || 'Julho 2025'}</p>
          </div>
          <div className="bg-[#111111] border border-gray-800 rounded-lg p-6 shadow-sm">
            <h3 className="text-sm font-medium text-gray-400 mb-1">Projetos Criados</h3>
            <p className="text-2xl font-bold">{data?.seguidores ? (data.seguidores / 100).toFixed(0) : '12'}</p>
          </div>
          <div className="bg-[#111111] border border-gray-800 rounded-lg p-6 shadow-sm">
            <h3 className="text-sm font-medium text-gray-400 mb-1">Minutos Gerados</h3>
            <p className="text-2xl font-bold">{data?.alcance ? (data.alcance / 1000).toFixed(0) : '45'}</p>
          </div>
          <div className="bg-[#111111] border border-gray-800 rounded-lg p-6 shadow-sm">
            <h3 className="text-sm font-medium text-gray-400 mb-1">Créditos Restantes</h3>
            <p className="text-2xl font-bold">{data?.receita ? Math.floor(data.receita / 10) : '180'}</p>
          </div>
          <div className="bg-[#111111] border border-gray-800 rounded-lg p-6 shadow-sm">
            <h3 className="text-sm font-medium text-gray-400 mb-1">Plano Atual</h3>
            <p className="text-2xl font-bold text-[#8B5CF6]">{subscription.plan ? subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1) : 'Inicial'}</p>
          </div>
        </div>

        {/* Botão Principal - Editor de Voz */}
        <div className="mb-8">
          {hasContentAgentFeature ? (
            <button
              onClick={() => navigate({ to: '/editor' })}
              className="w-full bg-[#22C55E] hover:bg-[#16A34A] text-white font-bold py-6 px-8 rounded-xl text-2xl flex items-center justify-center gap-3 transition-all hover:scale-[1.02] shadow-lg shadow-[#22C55E]/20"
            >
              <Volume2 className="w-10 h-10" />
              Abrir Editor de Voz 🎙️
            </button>
          ) : (
            <button
              disabled
              className="w-full bg-gray-800 text-gray-500 font-bold py-6 px-8 rounded-xl text-2xl flex items-center justify-center gap-3 cursor-not-allowed border border-gray-700"
            >
              <Lock className="w-10 h-10" />
              Editor de Voz 🔒 - Upgrade para Crescimento
            </button>
          )}
        </div>

        {/* Funcionalidades do Plano */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Editor de Voz - Feature 1 */}
          <div className={`border rounded-lg p-6 shadow-sm ${hasContentAgentFeature ? 'bg-[#111111] border-gray-800 hover:border-[#8B5CF6] cursor-pointer' : 'bg-gray-900/50 border-gray-800/50'}`}
               onClick={() => hasContentAgentFeature && navigate({ to: '/editor' })}>
            <div className="flex items-center gap-2 mb-3">
              <Volume2 className="w-6 h-6 text-[#8B5CF6]" />
              <h3 className="text-xl font-semibold">Editor de Voz</h3>
              {!hasContentAgentFeature && <Lock className="w-4 h-4 text-gray-500" />}
            </div>
            {hasContentAgentFeature ? (
              <p className="text-gray-400">Crie voiceovers profissionais em menos de 2 minutos</p>
            ) : (
              <div className="text-center">
                <p className="text-gray-500 mb-3">Funcionalidade disponível apenas nos planos Crescimento e Dominação</p>
                <button 
                  onClick={(e) => { e.stopPropagation(); navigate({ to: '/precos' }); }}
                  className="bg-[#8B5CF6] text-white px-4 py-2 rounded-lg hover:bg-[#7C3AED] text-sm"
                >
                  Ver Planos
                </button>
              </div>
            )}
          </div>
          
          <div className="bg-[#111111] border border-gray-800 rounded-lg p-6 shadow-sm">
            <h3 className="text-xl font-semibold mb-3">Biblioteca de Vozes</h3>
            <p className="text-gray-400">Gerenciar vozes disponíveis para seus projetos</p>
          </div>
          
          {/* Agente de Conteúdo - Protegido */}
          <div className={`border rounded-lg p-6 shadow-sm ${hasContentAgentFeature ? 'bg-[#111111] border-gray-800 hover:border-[#8B5CF6] cursor-pointer' : 'bg-gray-900/50 border-gray-800/50'}`}
               onClick={() => hasContentAgentFeature && navigate({ to: '/agente' })}>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-xl font-semibold">Agente de Conteúdo IA</h3>
              {!hasContentAgentFeature && <Lock className="w-4 h-4 text-gray-500" />}
            </div>
            {hasContentAgentFeature ? (
              <p className="text-gray-400">Crie conteúdos automaticamente para suas redes sociais</p>
            ) : (
              <div className="text-center">
                <p className="text-gray-500 mb-3">Funcionalidade disponível apenas nos planos Crescimento e Dominação</p>
                <button 
                  onClick={() => navigate({ to: '/precos' })}
                  className="bg-[#8B5CF6] text-white px-4 py-2 rounded-lg hover:bg-[#7C3AED] text-sm"
                >
                  Ver Planos
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
