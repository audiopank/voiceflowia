import { useState } from 'react'
import { createFileRoute } from "@tanstack/react-router"
import { supabase } from '../lib/supabase'
import { BackButton } from '../components/BackButton'
import { Logo } from '../components/Logo'

export const Route = createFileRoute("/esqueci-senha")({
  component: EsqueciSenha,
})

function EsqueciSenha() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    })

    // Mensagem generica sempre, independente do email existir ou nao —
    // evita expor pra quem tenta adivinhar quais emails tem conta.
    setLoading(false)
    setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] relative">
      <BackButton to="/login" className="absolute top-6 left-6" />
      <div className="w-full max-w-sm p-8 bg-[#111111] border border-gray-800 rounded-2xl shadow-lg space-y-4">
        <div className="flex justify-center pb-2">
          <Logo />
        </div>
        {sent ? (
          <div className="text-center space-y-4">
            <p className="text-gray-300">
              Se existir uma conta com o email <span className="text-white">{email}</span>, você vai
              receber um link pra redefinir sua senha em instantes.
            </p>
            <p className="text-gray-500 text-sm">Verifique também a caixa de spam.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-gray-400 text-sm text-center">
              Digite seu email e enviaremos um link pra você criar uma senha nova.
            </p>
            <input
              className="w-full border border-gray-700 rounded-lg p-3 bg-[#1A1A1A] text-white focus:outline-none focus:border-[#8B5CF6]"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Seu email"
              required
            />
            <button
              disabled={loading}
              className="w-full bg-[#22C55E] text-white font-bold py-3 rounded-lg hover:bg-[#16A34A] disabled:opacity-50"
            >
              {loading ? 'Enviando...' : 'Enviar link de recuperação'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
