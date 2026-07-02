import { useState } from 'react'
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router"
import { supabase } from '../lib/supabase'

export const Route = createFileRoute("/cadastro")({
  component: Cadastro,
})

function Cadastro() {
  const search = useSearch({ from: "/cadastro" })
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    
    const { data, error } = await supabase.auth.signUp({ email, password })
    
    if (error) {
      setLoading(false)
      return alert('Erro no cadastro: ' + error.message)
    }
    
    if (data?.user) {
      navigate({ to: '/dashboard' })
    } else {
      alert('Cadastro realizado! Verifique seu email para confirmar.')
    }
    
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-md p-8 bg-[#111111] rounded-2xl shadow-lg space-y-6 border border-gray-800">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-2">Crie sua Conta</h1>
          {search.plano && (
            <p className="text-[#8B5CF6] font-medium">
              Plano selecionado: {search.plano === 'crescimento' ? 'Crescimento' : search.plano}
            </p>
          )}
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
          {loading ? 'Criando conta...' : 'Criar Conta'}
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
