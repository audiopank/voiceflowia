import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { supabase } from '../lib/supabase'
import { useSubscription } from '../lib/useSubscription'
import { Lock, Volume2, Settings, Rocket, Radar as RadarIcon } from 'lucide-react'
import { BackButton } from '../components/BackButton'
import { ADMIN_EMAIL } from '../lib/plans'
import { TRIAL_GENERATIONS } from '../lib/trial'

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
})

// Nome amigável do plano (o slug do trial é feio para exibir).
function planLabel(plan: string | null): string {
  switch (plan) {
    case 'User_7_dias_Free': return 'Trial 7 dias'
    case 'crescimento': return 'Crescimento'
    case 'dominacao': return 'Dominação'
    case 'inicial': return 'Inicial'
    default: return plan || 'Sem plano'
  }
}

// Mês atual calculado (ex: "Julho de 2026"), sem depender de dado mockado.
function mesAtual(): string {
  const s = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function Dashboard() {
  const [user, setUser] = useState<any>(null)
  const [stats, setStats] = useState({ projetos: 0, posts: 0 })
  const [loading, setLoading] = useState(true)
  const subscription = useSubscription()
  const navigate = useNavigate()

  const hasContentAgentFeature = subscription.hasContentAgentFeature
  const hasRadar = subscription.hasRadar
  const subscriptionActive = subscription.status === 'active'

  // Trial mostra o que sobra das 10; pago é ilimitado; sem acesso mostra "—".
  const trial = subscription.trial
  const geracoesRestantes = trial.isTrial
    ? `${trial.generationsLeft} de ${TRIAL_GENERATIONS}`
    : hasContentAgentFeature ? 'Ilimitado' : '—'

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
    // Dado REAL: conteúdos gerados pelo próprio usuário (tabela contents).
    const { data, error } = await supabase
      .from('contents')
      .select('posts_json')
      .eq('user_id', user.id)

    if (error) {
      console.error('Erro ao buscar conteúdos:', error)
    } else if (data) {
      const projetos = data.length
      const posts = data.reduce(
        (sum, row) => sum + (Array.isArray(row.posts_json) ? row.posts_json.length : 0),
        0,
      )
      setStats({ projetos, posts })
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
        <BackButton to="/precos" label="Voltar" className="mb-4" />
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold">Dashboard - VoiceFlow IA</h1>
            {subscription.plan && (
              <p className="text-[#8B5CF6] mt-1">
                Plano: {planLabel(subscription.plan)} {subscriptionActive ? '✅' : '(Inativo)'}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {user?.email === ADMIN_EMAIL && (
              <button
                onClick={() => navigate({ to: '/admin' })}
                className="bg-[#8B5CF6] text-white px-4 py-2 rounded-lg hover:bg-[#7C3AED] flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                Admin
              </button>
            )}
            <button onClick={handleLogout} className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700">
              Sair
            </button>
          </div>
        </div>
        
        {/* Métricas — todas reais (contents + trial). */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
          <div className="bg-[#111111] border border-gray-800 rounded-lg p-6 shadow-sm">
            <h3 className="text-sm font-medium text-gray-400 mb-1">Mês</h3>
            <p className="text-2xl font-bold">{mesAtual()}</p>
          </div>
          <div className="bg-[#111111] border border-gray-800 rounded-lg p-6 shadow-sm">
            <h3 className="text-sm font-medium text-gray-400 mb-1">Projetos Criados</h3>
            <p className="text-2xl font-bold">{stats.projetos}</p>
          </div>
          <div className="bg-[#111111] border border-gray-800 rounded-lg p-6 shadow-sm">
            <h3 className="text-sm font-medium text-gray-400 mb-1">Posts Gerados</h3>
            <p className="text-2xl font-bold">{stats.posts}</p>
          </div>
          <div className="bg-[#111111] border border-gray-800 rounded-lg p-6 shadow-sm">
            <h3 className="text-sm font-medium text-gray-400 mb-1">Gerações Restantes</h3>
            <p className="text-2xl font-bold">{geracoesRestantes}</p>
          </div>
          <div className="bg-[#111111] border border-gray-800 rounded-lg p-6 shadow-sm">
            <h3 className="text-sm font-medium text-gray-400 mb-1">Plano Atual</h3>
            <p className="text-2xl font-bold text-[#8B5CF6]">{planLabel(subscription.plan)}</p>
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

        {/* Super Agente - Destaque */}
        <div className="mb-8">
          {hasContentAgentFeature ? (
            <button
              onClick={() => navigate({ to: '/super-agente' })}
              className="w-full bg-gradient-to-r from-[#8B5CF6] to-[#6D28D9] hover:from-[#7C3AED] hover:to-[#5B21B6] text-white font-bold py-6 px-8 rounded-xl text-2xl flex items-center justify-center gap-3 transition-all hover:scale-[1.02] shadow-lg shadow-[#8B5CF6]/30"
            >
              <Rocket className="w-9 h-9" />
              Super Agente — Estratégia + Kit do Mês em 1 Clique 🚀
            </button>
          ) : (
            <button
              disabled
              className="w-full bg-gray-800 text-gray-500 font-bold py-6 px-8 rounded-xl text-2xl flex items-center justify-center gap-3 cursor-not-allowed border border-gray-700"
            >
              <Lock className="w-9 h-9" />
              Super Agente 🔒 - Upgrade para Crescimento
            </button>
          )}
        </div>

        {/* VoiceFlow Radar — módulo premium (add-on RADAR PRO). Só aparece o
            hero se o cliente tem o entitlement; senão vira convite pra conhecer. */}
        <div className="mb-8">
          {hasRadar ? (
            <button
              onClick={() => navigate({ to: '/radar' })}
              className="w-full bg-gradient-to-r from-[#0EA5E9] to-[#2563EB] hover:from-[#0284C7] hover:to-[#1D4ED8] text-white font-bold py-6 px-8 rounded-xl text-2xl flex items-center justify-center gap-3 transition-all hover:scale-[1.02] shadow-lg shadow-[#2563EB]/30"
            >
              <RadarIcon className="w-9 h-9" />
              VoiceFlow Radar — Monitore sua marca 📡
            </button>
          ) : (
            <button
              onClick={() => navigate({ to: '/precos' })}
              className="w-full bg-[#0A0F1E] border border-[#1E3A5F] text-gray-300 hover:border-[#2563EB] font-bold py-6 px-8 rounded-xl text-2xl flex items-center justify-center gap-3 transition-all"
            >
              <RadarIcon className="w-9 h-9 text-[#2563EB]" />
              Novo: VoiceFlow Radar — Conheça o RADAR PRO 📡
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
          
          <div className={`border rounded-lg p-6 shadow-sm ${hasContentAgentFeature ? 'bg-[#111111] border-gray-800 hover:border-[#8B5CF6] cursor-pointer' : 'bg-gray-900/50 border-gray-800/50'}`}
               onClick={() => hasContentAgentFeature && navigate({ to: '/biblioteca' })}>
            <div className="flex items-center gap-2 mb-3">
              <Volume2 className="w-6 h-6 text-[#8B5CF6]" />
              <h3 className="text-xl font-semibold">Biblioteca de Vozes</h3>
              {!hasContentAgentFeature && <Lock className="w-4 h-4 text-gray-500" />}
            </div>
            {hasContentAgentFeature ? (
              <p className="text-gray-400">Ouça, compare e favorite as vozes dos seus projetos</p>
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
