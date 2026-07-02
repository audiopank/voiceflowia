import { useState } from 'react'
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { supabase } from '../lib/supabase'

export const Route = createFileRoute("/login")({
  component: Login,
})

function Login() {
  const [email, setEmail] = useState('cliente1@demo.com')
  const [password, setPassword] = useState('123456')
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="w-full max-w-sm p-8 bg-white rounded-2xl shadow-lg space-y-4">
        <h1 className="text-2xl font-bold text-center">Locutores IA</h1>
        <input 
          className="w-full border rounded-lg p-2" 
          type="email" 
          value={email} 
          onChange={e => setEmail(e.target.value)} 
          placeholder="Email" 
          required
        />
        <input 
          className="w-full border rounded-lg p-2" 
          type="password" 
          value={password} 
          onChange={e => setPassword(e.target.value)} 
          placeholder="Senha" 
          required
        />
        <button 
          disabled={loading} 
          className="w-full bg-indigo-600 text-white font-bold py-2 rounded-lg disabled:opacity-50"
        >
          {loading ? (isSignUp ? 'Cadastrando...' : 'Entrando...') : (isSignUp ? 'Cadastrar' : 'Entrar')}
        </button>
        <button
          type="button"
          onClick={() => setIsSignUp(!isSignUp)}
          className="w-full text-indigo-600 text-sm hover:underline"
        >
          {isSignUp ? 'Já tem conta? Entre aqui' : 'Não tem conta? Cadastre-se'}
        </button>
      </form>
    </div>
  )
}
