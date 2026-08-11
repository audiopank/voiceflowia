import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Logo } from '../components/Logo'
import { VideosSection } from '../components/VideosSection'

export const Route = createFileRoute('/videos')({
  component: Videos,
})

function Videos() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <header className="container mx-auto px-6 py-6 flex items-center justify-between">
        <Logo />
        <Button
          onClick={() => navigate({ to: '/precos' })}
          className="bg-[#1A1A1A] hover:bg-[#252525] text-sm"
        >
          Ver planos
        </Button>
      </header>

      <section className="container mx-auto px-6 pt-8 pb-12 text-center">
        <h1 className="text-3xl md:text-5xl font-bold mb-4">
          Veja o VoiceFlow IA <span className="text-[#8B5CF6]">funcionando</span>
        </h1>
        <p className="text-lg text-gray-400 max-w-2xl mx-auto">
          Roteiro, legenda e a locução em áudio prontos em minutos. Você só grava lendo — ou usa o
          áudio direto no seu vídeo.
        </p>
      </section>

      <VideosSection titulo="" subtitulo="" avisarSeVazio />

      <section className="container mx-auto px-6 pb-24 text-center">
        <div className="max-w-2xl mx-auto bg-[#111111] border border-gray-800 rounded-2xl p-8">
          <h2 className="text-2xl font-bold mb-2">Testa você mesmo</h2>
          <p className="text-gray-400 mb-6">7 dias grátis · 10 gerações · sem cartão.</p>
          <Button
            onClick={() => navigate({ to: '/cadastro', search: { trial: '1' } })}
            className="bg-[#8B5CF6] hover:bg-[#7C3AED] font-bold text-lg py-6 px-8 flex items-center gap-2 mx-auto"
          >
            Começar meus 7 dias grátis
            <ArrowRight className="w-5 h-5" />
          </Button>
        </div>
      </section>
    </div>
  )
}
