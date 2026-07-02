import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

type AppRoute = '/precos' | '/login' | '/cadastro' | '/dashboard' | '/editor' | '/agente'

interface BackButtonProps {
  to: AppRoute
  label?: string
  className?: string
}

export function BackButton({ to, label = 'Voltar', className = '' }: BackButtonProps) {
  const navigate = useNavigate()

  return (
    <button
      type="button"
      onClick={() => navigate({ to })}
      className={`inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm font-medium ${className}`}
    >
      <ArrowLeft className="w-5 h-5" />
      {label}
    </button>
  )
}
