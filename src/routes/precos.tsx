import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { fetchActivePlans, DEFAULT_PLANS, type Plan } from "../lib/plans"

export const Route = createFileRoute("/precos")({
  component: Precos,
})

function openCheckout(url: string | null) {
  if (url) window.open(url, "_blank")
}

function PlanCard({ plan, fallbackUrl }: { plan: Plan; fallbackUrl: string | null }) {
  // Plano-isca (sem link proprio, ex: R$49) nao abre checkout dele mesmo:
  // o clique e funilado para o checkout do plano em destaque (R$197).
  const checkoutUrl = plan.kiwify_url?.trim() || fallbackUrl
  return (
    <Card
      className={
        plan.highlight
          ? "bg-[#111111] border-2 border-[#8B5CF6] rounded-xl overflow-hidden shadow-[0_0_30px_rgba(139,92,246,0.3)] relative"
          : "bg-[#111111] border border-gray-800 rounded-xl overflow-hidden"
      }
    >
      {plan.badge && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <Badge className="px-4 py-1 text-sm">{plan.badge}</Badge>
        </div>
      )}
      <CardHeader className={plan.highlight ? "pb-4 pt-8" : "pb-4"}>
        <CardTitle className="text-xl font-bold">{plan.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <span className="text-4xl font-bold">{plan.price}</span>
          <span className="text-gray-400">{plan.period}</span>
        </div>
        <ul className="space-y-4">
          {plan.features.map((feat, i) => (
            <li key={i} className="flex items-start gap-3">
              {feat.included ? (
                <Check className="w-5 h-5 text-[#22C55E] shrink-0 mt-0.5" />
              ) : (
                <X className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              )}
              <span className={feat.included ? "text-gray-300" : "text-gray-500"}>{feat.text}</span>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <Button
          variant={plan.highlight ? "default" : "outline"}
          className="w-full"
          disabled={!checkoutUrl}
          onClick={() => openCheckout(checkoutUrl)}
        >
          {plan.cta_label}
        </Button>
      </CardFooter>
    </Card>
  )
}

function Precos() {
  const navigate = useNavigate()
  const [plans, setPlans] = useState<Plan[]>(DEFAULT_PLANS)

  useEffect(() => {
    fetchActivePlans().then(setPlans)
  }, [])

  const heroPlan = plans.find((p) => p.highlight) ?? plans[0]
  // Checkout usado pela isca e pelo hero: sempre o plano em destaque (R$197).
  const anchorUrl = heroPlan?.kiwify_url ?? null

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      {/* Header */}
      <header className="container mx-auto px-6 py-6 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-white">VoiceFlow IA</h1>
        <Button variant="outline" onClick={() => navigate({ to: "/login" })}>
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
        {heroPlan && (
          <Button size="lg" onClick={() => openCheckout(heroPlan.kiwify_url)}>
            {heroPlan.cta_label}
          </Button>
        )}
      </section>

      {/* Pricing Cards */}
      <section className="container mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {plans.map((plan) => (
            <PlanCard key={plan.slug} plan={plan} fallbackUrl={anchorUrl} />
          ))}
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
