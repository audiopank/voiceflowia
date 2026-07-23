import { useState } from 'react'
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router"
import { supabase } from '../lib/supabase'
import { BackButton } from '../components/BackButton'
import { TRIAL_INTENT_KEY } from '../lib/trial'

export const Route = createFileRoute("/cadastro")({
  // O router faz JSON.parse de cada valor da query. Um link escrito à mão —
  // "/cadastro?trial=1", que é como um link de divulgação sempre vai ser digitado —
  // chega aqui como o NÚMERO 1, não como a string "1". Exigir string descartava o
  // parâmetro em silêncio: a pessoa se cadastrava, não ganhava trial nenhum e batia
  // na tela trancada. Normaliza para texto e aceita as duas formas.
  validateSearch: (search: Record<string, unknown>): { plano?: string; trial?: string } => ({
    plano: search.plano == null ? undefined : String(search.plano),
    trial: search.trial == null ? undefined : String(search.trial),
  }),
  component: Cadastro,
})

// Formas que valem como "quero o trial" — cobre ?trial=1 e ?trial=true, digitados
// à mão ou gerados pelo app.
const VALORES_DE_TRIAL = ['1', 'true', 'sim']

function Cadastro() {
  const search = useSearch({ from: "/cadastro" })
  const navigate = useNavigate()
  const isTrial = VALORES_DE_TRIAL.includes((search.trial || '').toLowerCase())
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    // A intencao de trial vai gravada NO USUARIO, nao so nesta aba: se o Supabase
    // exigir confirmacao de email, o start_trial abaixo nao roda, e o resgate no
    // useSubscription precisa saber (em qualquer dispositivo) que esta pessoa pediu
    // o trial. Sem isso, ela confirma o email, entra e ve "Acesso Restrito".
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        ...(isTrial ? { data: { [TRIAL_INTENT_KEY]: true } } : {}),
        emailRedirectTo: `${window.location.origin}/login`,
      },
    })

    if (error) {
      setLoading(false)
      return alert('Erro no cadastro: ' + error.message)
    }

    // Sem sessao = confirmacao de email ligada no Supabase. O trial precisa de
    // sessao ativa para iniciar, entao ele so comeca quando a pessoa entrar.
    if (!data?.session) {
      setLoading(false)
      alert(
        isTrial
          ? 'Cadastro realizado! Confirme seu email e faca login — seus 7 dias gratis comecam assim que voce entrar.'
          : 'Cadastro realizado! Confirme seu email para entrar.',
      )
      navigate({ to: '/login' })
      return
    }

    if (isTrial) {
      // Ativa o plano User_7_dias_Free (RPC anti-abuso no banco).
      const { error: trialError } = await supabase.rpc('start_trial')
      setLoading(false)
      if (trialError) {
        // Nao some com o erro: sem trial a pessoa cai numa tela bloqueada sem
        // entender por que. O painel tem o botao de ativar como segunda chance.
        console.error('Erro ao iniciar trial:', trialError)
        alert('Sua conta foi criada, mas nao consegui ativar o trial agora. Abra o painel e clique em "Ativar meus 7 dias gratis".')
        navigate({ to: '/dashboard' })
        return
      }
      // Vai direto pro Super Agente, onde o Agente Guia abre sozinho.
      navigate({ to: '/super-agente' })
      return
    }

    setLoading(false)
    navigate({ to: '/dashboard' })
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-6 relative">
      <BackButton to="/precos" className="absolute top-6 left-6" />
      <form onSubmit={handleSubmit} className="w-full max-w-md p-8 bg-[#111111] rounded-2xl shadow-lg space-y-6 border border-gray-800">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-2">
            {isTrial ? 'Comece seu Trial Grátis' : 'Crie sua Conta'}
          </h1>
          {isTrial ? (
            <p className="text-[#22C55E] font-medium">7 dias grátis · 10 gerações · sem cartão</p>
          ) : search.plano ? (
            <p className="text-[#8B5CF6] font-medium">
              Plano selecionado: {search.plano === 'crescimento' ? 'Crescimento' : search.plano}
            </p>
          ) : null}
        </div>
        <div className="space-y-4">
          <input
            className="w-full px-4 py-3 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#8B5CF6]"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Seu email"
            required
          />
          <input
            className="w-full px-4 py-3 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-[#8B5CF6]"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Sua senha"
            required
          />
        </div>
        <button
          disabled={loading}
          className="w-full bg-[#22C55E] text-white font-bold py-3 rounded-lg hover:bg-[#16A34A] transition-colors disabled:opacity-50"
        >
          {loading ? 'Criando conta...' : isTrial ? 'Começar Trial de 7 Dias 🚀' : 'Criar Conta'}
        </button>
        <div className="text-center">
          <button
            type="button"
            onClick={() => navigate({ to: '/login' })}
            className="text-gray-400 hover:text-white transition-colors text-sm"
          >
            Já tem conta? Entre aqui
          </button>
        </div>
      </form>
    </div>
  )
}
