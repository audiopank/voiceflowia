import { useState } from 'react'
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { supabase } from '../lib/supabase'
import { BackButton } from '../components/BackButton'

export const Route = createFileRoute("/login")({
  component: Login,
})

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    console.log('Iniciando processo...', { email, password, isSignUp })
    
    if (isSignUp) {
      console.log('Tentando cadastrar usuário...')
      const { data, error } = await supabase.auth.signUp({ email, password })
      console.log('Resposta do cadastro:', { data, error })
      
      if (error) {
        setLoading(false)
        console.error('Erro no cadastro:', error)
        return alert(`Erro no cadastro: ${error.message}\n\nVerifique o console para mais detalhes.`)
      }
      
      // Se o usuário foi criado sem precisar confirmar email, faz login automático
      if (data?.user) {
        console.log('Usuário criado com sucesso!')
        alert('Cadastro realizado com sucesso! Redirecionando...')
        navigate({ to: '/dashboard' })
      } else {
        alert('Cadastro realizado! Verifique seu email para confirmar a conta.')
      }
    } else {
      console.log('Tentando fazer login...')
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      console.log('Resposta do login:', { data, error })
      
      if (error) {
        setLoading(false)
        console.error('Erro no login:', error)
        return alert(`Erro no login: ${error.message}\n\nDica: Verifique se a conta existe no Supabase Auth e se o email foi confirmado.`)
      }
      console.log('Login realizado com sucesso:', data)
      navigate({ to: '/dashboard' })
    }
    
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] relative">
      <BackButton to="/precos" className="absolute top-6 left-6" />
      <form onSubmit={handleSubmit} className="w-full max-w-sm p-8 bg-[#111111] border border-gray-800 rounded-2xl shadow-lg space-y-4">
        <h1 className="text-2xl font-bold text-center text-white">VoiceFlow IA</h1>
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
          {loading ? (isSignUp ? 'Cadastrando...' : 'Entrando...') : (isSignUp ? 'Cadastrar' : 'Entrar')}
        </button>
        <button
          type="button"
          onClick={() => setIsSignUp(!isSignUp)}
          className="w-full text-gray-400 text-sm hover:text-white"
        >
          {isSignUp ? 'Já tem conta? Entre aqui' : 'Não tem conta? Cadastre-se'}
        </button>
      </form>
    </div>
  )
}
