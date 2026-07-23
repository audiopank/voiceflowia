import { useState } from 'react'
import { Gift, Loader2, AlertCircle } from 'lucide-react'
import { TRIAL_DAYS, TRIAL_GENERATIONS } from '../lib/trial'

interface Props {
  // Ação que chama a RPC start_trial (vem do useSubscription da página, para não
  // abrir uma segunda leitura de perfil só por causa deste botão).
  onAtivar: () => Promise<boolean>
  className?: string
}

// Rede de segurança do funil. Quem criou conta e ficou sem plano nenhum — o caso
// clássico é a confirmação de e-mail cortando o start_trial no meio do cadastro —
// só via "Acesso Restrito / faça upgrade" e ia embora sem nunca ter usado o
// produto. Este botão dá o trial na hora. A RPC no banco é anti-abuso: se a pessoa
// já usou o trial antes, nada acontece e ela continua vendo a tela de planos.
export function AtivarTrial({ onAtivar, className = '' }: Props) {
  const [ativando, setAtivando] = useState(false)
  const [erro, setErro] = useState('')

  async function handleClick() {
    setAtivando(true)
    setErro('')
    const ok = await onAtivar()
    if (!ok) {
      setErro('Não consegui ativar agora. Tente de novo em instantes.')
      setAtivando(false)
    }
    // Sucesso: o refresh do useSubscription libera a tela e este bloco some.
  }

  return (
    <div className={`bg-[#22C55E]/5 border border-[#22C55E]/40 rounded-xl p-5 text-left ${className}`}>
      <div className="flex items-center gap-2 mb-1">
        <Gift className="w-5 h-5 text-[#22C55E]" />
        <h3 className="font-bold text-white">Você ainda não usou seu teste grátis</h3>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        {TRIAL_DAYS} dias com tudo liberado e {TRIAL_GENERATIONS} gerações de conteúdo. Sem cartão.
      </p>
      <button
        onClick={handleClick}
        disabled={ativando}
        className="w-full bg-[#22C55E] hover:bg-[#16A34A] disabled:opacity-50 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        {ativando ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Ativando...</>
        ) : (
          <>Ativar meus {TRIAL_DAYS} dias grátis 🚀</>
        )}
      </button>
      {erro && (
        <p className="mt-3 text-sm text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {erro}
        </p>
      )}
    </div>
  )
}
