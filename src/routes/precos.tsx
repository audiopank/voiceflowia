import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export const Route = createFileRoute("/precos")({
  component: Precos,
})

function Precos() {
  const navigate = useNavigate()

  const kiwifyLinks = {
    barbeiro: import.meta.env.VITE_KIWIFY_BARBEIRO_URL || "COLE_AQUI_LINK_KIWIFY_BARBEIRO",
    crescimento: import.meta.env.VITE_KIWIFY_CRESCIMENTO_URL || "COLE_AQUI_LINK_KIWIFY_CRESCIMENTO",
    dominacao: import.meta.env.VITE_KIWIFY_DOMINACAO_URL || "COLE_AQUI_LINK_KIWIFY_DOMINACAO"
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      {/* Header */}
      <header className="container mx-auto px-6 py-6 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-white">VoiceFlow IA</h1>
        <Button
          variant="outline"
          onClick={() => navigate({ to: "/login" })}
        >
          Entrar
        </Button>
      </header>

      {/* Hero */}
      <section className="container mx-auto px-6 py-16 text-center">
        <h2 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
          Crie Vozes e Conteúdos com IA em 1 Clique.<br />
          <span className="text-[#8B5CF6]">Para Marcas, Agências e Criadores.</span>
        </h2>
        <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
          A IA que gerencia seus áudios, conteúdos e agentes para sua empresa.
        </p>
        <Button
          size="lg"
          onClick={() => window.open(kiwifyLinks.crescimento, "_blank")}
        >
          Testar 7 Dias Grátis
        </Button>
      </section>

      {/* Pricing Cards */}
      <section className="container mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {/* Plano Inicial */}
          <Card className="bg-[#111111] border border-gray-800 rounded-xl overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl font-bold">Plano Inicial</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <span className="text-4xl font-bold">R$ 97</span>
                <span className="text-gray-400">/mês</span>
              </div>
              <ul className="space-y-4">
                <li className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-[#22C55E] shrink-0 mt-0.5" />
                  <span className="text-gray-300">Dashboard de Métricas Completo</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-[#22C55E] shrink-0 mt-0.5" />
                  <span className="text-gray-300">10 Projetos de Voz / mês</span>
                </li>
                <li className="flex items-start gap-3">
                  <X className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <span className="text-gray-500">Sem Agente de Conteúdo IA</span>
                </li>
              </ul>
            </CardContent>
            <CardFooter>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.open(kiwifyLinks.barbeiro, "_blank")}
              >
                Começar Agora
              </Button>
            </CardFooter>
          </Card>

          {/* Plano Crescimento - Destaque */}
          <Card className="bg-[#111111] border-2 border-[#8B5CF6] rounded-xl overflow-hidden shadow-[0_0_30px_rgba(139,92,246,0.3)] relative">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <Badge className="px-4 py-1 text-sm">MAIS VENDIDO</Badge>
            </div>
            <CardHeader className="pb-4 pt-8">
              <CardTitle className="text-xl font-bold">Plano Crescimento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <span className="text-4xl font-bold">R$ 297</span>
                <span className="text-gray-400">/mês</span>
              </div>
              <ul className="space-y-4">
                <li className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-[#22C55E] shrink-0 mt-0.5" />
                  <span className="text-gray-300">Tudo do Plano Inicial</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-[#22C55E] shrink-0 mt-0.5" />
                  <span className="text-gray-300">Agente de Conteúdo IA 24h</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-[#22C55E] shrink-0 mt-0.5" />
                  <span className="text-gray-300">30 Projetos de Voz / mês</span>
                </li>
              </ul>
            </CardContent>
            <CardFooter>
              <Button
                variant="default"
                className="w-full"
                onClick={() => window.open(kiwifyLinks.crescimento, "_blank")}
              >
                Testar 7 Dias Grátis
              </Button>
            </CardFooter>
          </Card>

          {/* Plano Dominação */}
          <Card className="bg-[#111111] border border-gray-800 rounded-xl overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl font-bold">Plano Dominação</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <span className="text-4xl font-bold">R$ 497</span>
                <span className="text-gray-400">/mês</span>
              </div>
              <ul className="space-y-4">
                <li className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-[#22C55E] shrink-0 mt-0.5" />
                  <span className="text-gray-300">Tudo do Plano Crescimento</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-[#22C55E] shrink-0 mt-0.5" />
                  <span className="text-gray-300">Atendimento por Voz no WhatsApp</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-[#22C55E] shrink-0 mt-0.5" />
                  <span className="text-gray-300">Estratégia 1x1 com o Mestre 2x/mês</span>
                </li>
                <li className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-[#22C55E] shrink-0 mt-0.5" />
                  <span className="text-gray-300">Vagas Limitadas: 5 vagas</span>
                </li>
              </ul>
            </CardContent>
            <CardFooter>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.open(kiwifyLinks.dominacao, "_blank")}
              >
                Quero Dominar
              </Button>
            </CardFooter>
          </Card>
        </div>
      </section>

      {/* Para quem é? */}
      <section className="container mx-auto px-6 pb-20">
        <h3 className="text-3xl font-bold text-center mb-12">Para quem é?</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          <Card className="bg-[#111111] border border-gray-800 rounded-xl overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl font-bold text-[#8B5CF6]">Agências de Marketing</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-400">Gere 100 locuções/mês para seus clientes, crie conteúdos em massa e economize horas de trabalho.</p>
            </CardContent>
          </Card>

          <Card className="bg-[#111111] border border-gray-800 rounded-xl overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl font-bold text-[#22C55E]">Lojas e E-commerces</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-400">Crie anúncios de áudio para Instagram, Rádio e YouTube Shorts. Converta mais com vozes humanas.</p>
            </CardContent>
          </Card>

          <Card className="bg-[#111111] border border-gray-800 rounded-xl overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl font-bold text-[#8B5CF6]">Criadores e Coaches</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-400">Duble seus vídeos, crie audiobooks e produza conteúdos de voz para todas as plataformas.</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="container mx-auto px-6 pb-10 text-center">
        <p className="text-gray-500 text-sm">Cancele quando quiser. Sem fidelidade.</p>
      </footer>
    </div>
  )
}
