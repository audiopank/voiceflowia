import { useState } from 'react'
import { Clock, Zap, X, Lock } from 'lucide-react'
import { useSubscription } from '../lib/useSubscription'
import { TRIAL_GENERATIONS } from '../lib/trial'

const KIWIFY_CRESCIMENTO = import.meta.env.VITE_KIWIFY_CRESCIMENTO_URL as string | undefined

function assinar197() {
  if (KIWIFY_CRESCIMENTO) window.open(KIWIFY_CRESCIMENTO, '_blank')
  else window.location.href = '/precos'
}

// Banner do topo + gatilhos de venda do Trial (dia 6 e bloqueio no fim).
// Montado no __root; se auto-oculta quando o usuario nao esta em trial.
export function TrialStatus() {
  const { loading, trial } = useSubscription()
  const [showDay6, setShowDay6] = useState(true)

  if (loading || !trial.isTrial) return null

  // 1) Trial acabou (tempo OU 10 geracoes) -> paywall bloqueante em cima de tudo.
  if (trial.expired) {
    return (
      <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-[#111111] border border-[#8B5CF6]/40 rounded-2xl p-8 text-center space-y-5">
          <Lock className="w-14 h-14 text-[#8B5CF6] mx-auto" />
          <h2 className="text-2xl font-bold text-white">Seu Trial de 7 dias acabou</h2>
          <p className="text-gray-400">
            {trial.limitReached
              ? `Você usou suas ${TRIAL_GENERATIONS} gerações grátis. `
              : 'Seus 7 dias grátis chegaram ao fim. '}
            Assine para continuar gerando conteúdo e voz sem parar.
          </p>
          <div className="space-y-3 pt-1">
            <button
              onClick={assinar197}
              className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-bold py-3 rounded-lg transition-colors"
            >
              Assinar Crescimento — R$197/mês
            </button>
            <button
              onClick={() => (window.location.href = '/precos')}
              className="w-full bg-[#1A1A1A] hover:bg-[#252525] border border-gray-700 text-gray-300 font-bold py-3 rounded-lg transition-colors"
            >
              Ver todos os planos
            </button>
          </div>
        </div>
      </div>
    )
  }

  // 2) Trial ativo -> banner do topo (+ modal no dia 6, quando falta 1 dia).
  return (
    <>
      <div className="w-full bg-gradient-to-r from-[#8B5CF6] to-[#6D28D9] text-white">
        <div className="container mx-auto px-4 py-2 flex items-center justify-center gap-x-4 gap-y-1 flex-wrap text-sm font-medium">
          <span className="flex items-center gap-1.5">
            <Clock className="w-4 h-4" />
            Trial de 7 dias — faltam <b>{trial.daysLeft}</b> {trial.daysLeft === 1 ? 'dia' : 'dias'}
          </span>
          <span className="flex items-center gap-1.5">
            <Zap className="w-4 h-4" />
            <b>{trial.generationsLeft}</b> {trial.generationsLeft === 1 ? 'geração restante' : 'gerações restantes'}
          </span>
          <button
            onClick={assinar197}
            className="underline underline-offset-2 hover:text-white/80 font-bold"
          >
            Assinar R$197 →
          </button>
        </div>
      </div>

      {trial.daysLeft <= 1 && showDay6 && (
        <div className="fixed inset-0 z-[90] bg-black/70 flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-[#111111] border border-[#8B5CF6]/40 rounded-2xl p-8 space-y-5 relative">
            <button
              onClick={() => setShowDay6(false)}
              className="absolute top-4 right-4 text-gray-500 hover:text-white"
              title="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-2xl font-bold text-white">Seu Trial acaba amanhã ⏳</h2>
            <p className="text-gray-400">
              Você já gerou <b className="text-white">{trial.generationsUsed}/{TRIAL_GENERATIONS}</b> conteúdos.
              Quer continuar sem parar?
            </p>
            <div className="space-y-3">
              <button
                onClick={assinar197}
                className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-bold py-3 rounded-lg transition-colors"
              >
                Assinar R$197/mês
              </button>
              <button
                onClick={() => (window.location.href = '/precos')}
                className="w-full bg-[#1A1A1A] hover:bg-[#252525] border border-gray-700 text-gray-300 font-bold py-3 rounded-lg transition-colors"
              >
                Ver outros planos
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
