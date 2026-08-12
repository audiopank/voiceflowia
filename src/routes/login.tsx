import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { supabase } from '../lib/supabase'
import { BackButton } from '../components/BackButton'
import { Logo } from '../components/Logo'

export const Route = createFileRoute("/login")({
  component: Login,
})

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  // Quem JÁ está logado e cai aqui (ex: clicou "Entrar" numa página pública sem
  // perceber que a sessão continuava viva) via o formulário e digitava a senha
  // de novo à toa. Manda direto pro painel.
  //
  // A checagem é getUser() (e NÃO getSession()) de propósito: o /dashboard —
  // como toda tela protegida — só deixa entrar quem passa no getUser(), que
  // valida o token no servidor. Se aqui a porta fosse o getSession(), que só lê
  // o token do localStorage sem validar, dava pra existir um token que abre o
  // /login e é recusado pelo /dashboard (usuário offline, por exemplo: o
  // getUser falha por rede e devolve user null sem apagar a sessão). Nesse caso
  // as duas telas ficariam se empurrando em loop infinito. Mesma fonte de
  // verdade nos dois lados = se o getUser falhar aqui, a pessoa fica no
  // formulário e o loop nunca começa.
  //
  // `replace` pra não empilhar histórico: sem ele o "voltar" do navegador cai de
  // novo no /login, que redireciona outra vez, e a pessoa fica presa.
  useEffect(() => {
    let cancelado = false
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelado && data.user) navigate({ to: '/dashboard', replace: true })
    })
    return () => {
      cancelado = true
    }
  }, [navigate])

  // Esta tela SÓ faz login. O cadastro que existia aqui era um segundo caminho
  // paralelo ao /cadastro que nunca chamava start_trial: quem entrava por ele
  // criava conta com subscription_plan NULL e batia direto na tela "Upgrade para
  // Crescimento", sem nunca ter tido o teste grátis a que tinha direito.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setLoading(false)
      console.error('Erro no login:', error)
      return alert(`Erro no login: ${error.message}`)
    }

    navigate({ to: '/dashboard' })
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] relative">
      <BackButton to="/precos" className="absolute top-6 left-6" />
      <form onSubmit={handleSubmit} className="w-full max-w-sm p-8 bg-[#111111] border border-gray-800 rounded-2xl shadow-lg space-y-4">
        <div className="flex justify-center pb-2">
          <Logo />
        </div>
        <input 
          className="w-full border border-gray-700 rounded-lg p-3 bg-[#1A1A1A] text-white focus:outline-none focus:border-[#8B5CF6]" 
          type="email" 
          value={email} 
          onChange={e => setEmail(e.target.value)} 
          placeholder="Seu email" 
          required
        />
        <input 
          className="w-full border border-gray-700 rounded-lg p-3 bg-[#1A1A1A] text-white focus:outline-none focus:border-[#8B5CF6]" 
          type="password" 
          value={password} 
          onChange={e => setPassword(e.target.value)} 
          placeholder="Sua senha" 
          required
        />
        <button
          disabled={loading}
          className="w-full bg-[#22C55E] text-white font-bold py-3 rounded-lg hover:bg-[#16A34A] disabled:opacity-50"
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
        {/* Quem não tem conta vai pro cadastro COM trial — o único caminho que
            entrega os 7 dias grátis. */}
        <button
          type="button"
          onClick={() => navigate({ to: '/cadastro', search: { trial: '1' } })}
          className="w-full text-gray-400 text-sm hover:text-white"
        >
          Não tem conta? Comece com 7 dias grátis
        </button>
        <button
          type="button"
          onClick={() => navigate({ to: '/esqueci-senha' })}
          className="w-full text-gray-500 text-xs hover:text-gray-300"
        >
          Esqueci minha senha
        </button>
      </form>
    </div>
  )
}
