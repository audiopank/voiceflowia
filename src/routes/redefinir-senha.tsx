import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { supabase } from '../lib/supabase'
import { Logo } from '../components/Logo'

export const Route = createFileRoute("/redefinir-senha")({
  component: RedefinirSenha,
})

function RedefinirSenha() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  // O link do email carrega um token na URL que o Supabase troca por uma
  // sessao de recuperacao automaticamente (evento PASSWORD_RECOVERY).
  // Enquanto isso nao acontece, nao da pra saber se o link e valido.
  const [ready, setReady] = useState(false)
  const [invalidLink, setInvalidLink] = useState(false)

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })

    // Se a sessao de recuperacao ja tiver sido processada antes do listener
    // montar, confirma direto pela sessao atual.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true)
    })

    const timeout = setTimeout(() => {
      setReady((r) => {
        if (!r) setInvalidLink(true)
        return r
      })
    }, 5000)

    return () => {
      listener.subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('A senha precisa ter pelo menos 6 caracteres.')
      return
    }
    if (password !== confirmPassword) {
      setError('As senhas não são iguais.')
      return
    }

    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setSuccess(true)
    setTimeout(() => navigate({ to: '/dashboard' }), 2000)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] relative">
      <div className="w-full max-w-sm p-8 bg-[#111111] border border-gray-800 rounded-2xl shadow-lg space-y-4">
        <div className="flex justify-center pb-2">
          <Logo />
        </div>

        {success ? (
          <p className="text-center text-[#22C55E]">Senha atualizada! Redirecionando...</p>
        ) : invalidLink ? (
          <div className="text-center space-y-4">
            <p className="text-gray-300">Este link de redefinição é inválido ou já expirou.</p>
            <button
              onClick={() => navigate({ to: '/esqueci-senha' })}
              className="w-full bg-[#22C55E] text-white font-bold py-3 rounded-lg hover:bg-[#16A34A]"
            >
              Pedir um novo link
            </button>
          </div>
        ) : !ready ? (
          <p className="text-center text-gray-400">Verificando o link...</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-gray-400 text-sm text-center">Escolha sua nova senha.</p>
            <input
              className="w-full border border-gray-700 rounded-lg p-3 bg-[#1A1A1A] text-white focus:outline-none focus:border-[#8B5CF6]"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Nova senha"
              required
            />
            <input
              className="w-full border border-gray-700 rounded-lg p-3 bg-[#1A1A1A] text-white focus:outline-none focus:border-[#8B5CF6]"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirme a nova senha"
              required
            />
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            <button
              disabled={loading}
              className="w-full bg-[#22C55E] text-white font-bold py-3 rounded-lg hover:bg-[#16A34A] disabled:opacity-50"
            >
              {loading ? 'Salvando...' : 'Salvar nova senha'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
