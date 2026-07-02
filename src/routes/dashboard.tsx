import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { supabase } from '../lib/supabase'
import { useSubscription } from '../lib/useSubscription'
import { Lock } from 'lucide-react'

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
})

function Dashboard() {
  const [user, setUser] = useState<any>(null)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const subscription = useSubscription()
  const navigate = useNavigate()

  const hasSalesAgentFeature = subscription.plan === 'crescimento' || subscription.plan === 'dominacao'
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
            <h1 className="text-3xl font-bold">Dashboard - Locutores IA</h1>
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
        {data ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
            <div className="bg-[#111111] border border-gray-800 rounded-lg p-6 shadow-sm">
              <h3 className="text-sm font-medium text-gray-400 mb-1">Mês</h3>
              <p className="text-2xl font-bold">{data.mes || 'N/A'}</p>
            </div>
            <div className="bg-[#111111] border border-gray-800 rounded-lg p-6 shadow-sm">
              <h3 className="text-sm font-medium text-gray-400 mb-1">Seguidores</h3>
              <p className="text-2xl font-bold">{data.seguidores ? data.seguidores.toLocaleString() : '0'}</p>
            </div>
            <div className="bg-[#111111] border border-gray-800 rounded-lg p-6 shadow-sm">
              <h3 className="text-sm font-medium text-gray-400 mb-1">Receita</h3>
              <p className="text-2xl font-bold">{data.receita ? `R$ ${data.receita.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : 'R$ 0,00'}</p>
            </div>
            <div className="bg-[#111111] border border-gray-800 rounded-lg p-6 shadow-sm">
              <h3 className="text-sm font-medium text-gray-400 mb-1">Engajamento</h3>
              <p className="text-2xl font-bold">{data.engajamento ? `${data.engajamento}%` : '0%'}</p>
            </div>
            <div className="bg-[#111111] border border-gray-800 rounded-lg p-6 shadow-sm">
              <h3 className="text-sm font-medium text-gray-400 mb-1">Alcance</h3>
              <p className="text-2xl font-bold">{data.alcance ? data.alcance.toLocaleString() : '0'}</p>
            </div>
          </div>
        ) : (
          <div className="border border-dashed rounded-lg p-12 text-center text-gray-500 mb-8">
            <h2 className="text-xl font-semibold mb-2">Sem dados ainda.</h2>
            <p>Aguardando primeira campanha.</p>
          </div>
        )}

        {/* Funcionalidades do Plano */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-[#111111] border border-gray-800 rounded-lg p-6 shadow-sm">
            <h3 className="text-xl font-semibold mb-3">Vozes</h3>
            <p className="text-gray-400">Gerenciar vozes disponíveis</p>
          </div>
          
          {/* Agente de Vendas - Protegido */}
          <div className={`border rounded-lg p-6 shadow-sm ${hasSalesAgentFeature ? 'bg-[#111111] border-gray-800' : 'bg-gray-900/50 border-gray-800/50'}`}>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-xl font-semibold">Agente de Vendas</h3>
              {!hasSalesAgentFeature && <Lock className="w-4 h-4 text-gray-500" />}
            </div>
            {hasSalesAgentFeature ? (
              <p className="text-gray-400">Atendimento automático no WhatsApp 24h</p>
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
          
          <div className="bg-[#111111] border border-gray-800 rounded-lg p-6 shadow-sm">
            <h3 className="text-xl font-semibold mb-3">Histórico</h3>
            <p className="text-gray-400">Histórico de geração</p>
          </div>
        </div>
      </div>
    </div>
  )
}
