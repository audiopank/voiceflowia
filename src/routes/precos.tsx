import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { supabase } from "../lib/supabase"
import { fetchActivePlans, DEFAULT_PLANS, type Plan } from "../lib/plans"
import { Logo } from "../components/Logo"
import { VideosSection } from "../components/VideosSection"

export const Route = createFileRoute("/precos")({
  component: Precos,
})

function openCheckout(url: string | null) {
  if (url) window.open(url, "_blank")
}

// Para quem é cada degrau (o cliente se reconhece em vez de ler uma lista solta).
const PARA_QUEM: Record<string, string> = {
  crescimento: 'Para CRIAR o seu conteúdo',
  dominacao: 'Para CRIAR e PROTEGER a sua marca',
}

// Recursos no ar em 20/10/2026 — cada linha conferida no código antes de entrar aqui.
const RECURSOS: { icone: string; titulo: string; texto: string }[] = [
  { icone: '🗓️', titulo: 'Mês de conteúdo', texto: 'Até 30 dias, 2 posts por dia: gancho, roteiro, legenda, locução e cards em imagem. Escolha o objetivo do mês: alcance, leads ou vendas.' },
  { icone: '🎙️', titulo: 'Briefing por voz', texto: 'Fale sobre a marca por até 1 minuto. A IA transcreve e preenche o briefing — você confere antes.' },
  { icone: '🛍️', titulo: 'Catálogo → Posts', texto: 'Cole seus produtos e cada um vira um post. O sistema confere preço, números e promessas contra o seu catálogo.' },
  { icone: '💬', titulo: 'Kit de Respostas de WhatsApp', texto: 'Respostas na voz da marca, em texto e áudio, para você enviar aos clientes. Não é robô: quem envia é você.' },
  { icone: '🔊', titulo: 'Locução com IA', texto: 'Escolha a voz, use o Modo Diálogo com 2 vozes e coloque trilha de fundo.' },
  { icone: '✅', titulo: 'Qualidade antes de publicar', texto: 'Aviso e correção de texto sem acento, e a memória da marca evita repetir ganchos de meses anteriores.' },
]

function PlanCard({ plan, fallbackUrl, degrau, paraQuem }: { plan: Plan; fallbackUrl: string | null; degrau?: number; paraQuem?: string }) {
  // Plano-isca (sem link proprio, ex: R$49) nao abre checkout dele mesmo:
  // o clique e funilado para o checkout do plano em destaque (R$197).
  const checkoutUrl = plan.kiwify_url?.trim() || fallbackUrl
  return (
    <Card
      className={
        plan.highlight
          ? "bg-[#111111] border-2 border-[#8B5CF6] rounded-xl shadow-[0_0_30px_rgba(139,92,246,0.3)] relative"
          : "bg-[#111111] border border-gray-800 rounded-xl relative"
      }
    >
      {(plan.badge || degrau) && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <Badge className="px-4 py-1 text-sm whitespace-nowrap">
            {degrau ? `${degrau}. ` : ''}{plan.badge || plan.name.replace(/^Plano\s+/i, '').toUpperCase()}
          </Badge>
        </div>
      )}
      <CardHeader className="pb-4 pt-8">
        <CardTitle className="text-xl font-bold">{plan.name}</CardTitle>
        {paraQuem && <p className="text-sm text-gray-400">{paraQuem}</p>}
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
  // Esta página é pública, mas quem chega nela vindo de DENTRO do app (ex: o
  // botão "Conheça o RADAR PRO" no painel) continua logado. Mostrar "Entrar"
  // pra essa pessoa dá a impressão de que a sessão caiu — e ela vai digitar a
  // senha de novo sem precisar. null = ainda checando (não mostra nada).
  const [logado, setLogado] = useState<boolean | null>(null)

  useEffect(() => {
    fetchActivePlans().then(setPlans)
  }, [])

  // Rolagem pro #radar precisa acontecer DEPOIS que os planos entram: eles
  // carregam por rede e mudam a altura da página, então o salto que o navegador
  // faz sozinho no load acaba parando no lugar errado (ou nem acontece, porque
  // a seção ainda não existia). Por isso é um efeito preso ao `plans`.
  useEffect(() => {
    if (window.location.hash !== '#radar') return
    const alvo = document.getElementById('radar')
    if (!alvo) return
    const t = setTimeout(() => alvo.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    return () => clearTimeout(t)
  }, [plans])

  // A checagem é local (lê o token do storage) e roda em paralelo: os planos e o
  // resto da página não esperam por ela em momento nenhum.
  //
  // Esta é a página pública que converte, então ela não pode depender dessa
  // resposta pra ter um botão no header. Se o getSession() demorar demais ou
  // nunca responder (trava de lock entre abas já causou isso), o `logado` ficaria
  // null pra sempre e o header ficaria SEM botão nenhum — some o "Entrar" do
  // visitante. O timer abaixo devolve o comportamento antigo ("Entrar") nesse
  // caso; se a resposta chegar depois, ela ainda corrige o botão.
  useEffect(() => {
    let cancelado = false
    const fallback = setTimeout(() => {
      if (!cancelado) setLogado((atual) => (atual === null ? false : atual))
    }, 2500)
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelado) setLogado(!!data.session)
      })
      .catch(() => {
        if (!cancelado) setLogado(false)
      })
    return () => {
      cancelado = true
      clearTimeout(fallback)
    }
  }, [])

  // Degraus pagos = Crescimento e Dominação. O card-isca "inicial" (sem preço) nunca aparece,
  // mesmo que continue ativo no banco; o Radar vira a linha "avulso" + a seção própria.
  const ehRadar = (p: Plan) => /radar/i.test(p.name) || p.badge === 'RADAR'
  const planosPagos = plans.filter((p) => p.slug !== 'inicial' && !ehRadar(p))
  const planoRadar = plans.find(ehRadar) ?? null
  const heroPlan = planosPagos.find((p) => p.highlight) ?? planosPagos[0] ?? plans[0]
  // Checkout usado pela isca e pelo hero: sempre o plano em destaque (R$197).
  const anchorUrl = heroPlan?.kiwify_url ?? null

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      {/* Header */}
      <header className="container mx-auto px-6 py-6 flex justify-between items-center">
        <Logo />
        {logado === null ? null : logado ? (
          <Button variant="outline" onClick={() => navigate({ to: '/dashboard' })}>
            Voltar ao Painel
          </Button>
        ) : (
          <Button variant="outline" onClick={() => navigate({ to: '/login' })}>
            Entrar
          </Button>
        )}
      </header>

      {/* Hero — 20/10/2026: só o que o VoiceFlow faz de verdade (critério da casa: "só vendemos
          a verdade"). Saíram "em 1 Clique" e "a IA que gerencia…". */}
      <section className="container mx-auto px-6 py-16 text-center">
        <h2 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
          Roteiros, legendas e locuções com IA —<br />
          <span className="text-[#8B5CF6]">prontos para gravar e postar.</span>
        </h2>
        <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
          Para marcas, agências e criadores. Você conta sobre a marca (até por voz), o VoiceFlow monta o
          conteúdo e confere preço, números e acentos antes de você aprovar.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button
            size="lg"
            className="bg-[#22C55E] hover:bg-[#16A34A]"
            onClick={() => navigate({ to: '/cadastro', search: { trial: '1' } })}
          >
            Testar Grátis por 7 Dias 🚀
          </Button>
          {heroPlan && (
            <Button size="lg" variant="outline" onClick={() => openCheckout(heroPlan.kiwify_url)}>
              {heroPlan.cta_label}
            </Button>
          )}
        </div>
        <p className="text-sm text-gray-500 mt-4">Sem cartão. 10 gerações grátis para sentir o valor.</p>
      </section>

      {/* OS 3 DEGRAUS (20/10/2026): 1. teste grátis (a porta de entrada honesta — substitui o
          card-isca sem preço) → 2. Crescimento (criar) → 3. Dominação (criar + proteger: Radar
          incluso). O Radar avulso vira uma linha embaixo, pra quem só quer monitorar. */}
      <section className="container mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          <Card className="bg-[#111111] border border-[#22C55E]/50 rounded-xl relative">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <Badge className="px-4 py-1 text-sm bg-[#22C55E] hover:bg-[#22C55E]">1. COMECE AQUI</Badge>
            </div>
            <CardHeader className="pb-4 pt-8">
              <CardTitle className="text-xl font-bold">Teste grátis</CardTitle>
              <p className="text-sm text-gray-400">Para conhecer antes de assinar</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <span className="text-4xl font-bold">R$ 0</span>
                <span className="text-gray-400"> · 7 dias</span>
              </div>
              <ul className="space-y-4">
                {[
                  '10 gerações de conteúdo',
                  'Locuções não contam nas 10',
                  'Todos os recursos de conteúdo para testar',
                  'Sem cartão de crédito',
                ].map((t) => (
                  <li key={t} className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-[#22C55E] shrink-0 mt-0.5" />
                    <span className="text-gray-300">{t}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button className="w-full bg-[#22C55E] hover:bg-[#16A34A]" onClick={() => navigate({ to: '/cadastro', search: { trial: '1' } })}>
                Testar grátis
              </Button>
            </CardFooter>
          </Card>
          {planosPagos.map((plan, i) => (
            <PlanCard key={plan.slug} plan={plan} fallbackUrl={anchorUrl} degrau={i + 2} paraQuem={PARA_QUEM[plan.slug]} />
          ))}
        </div>
        {planoRadar && (
          <p className="text-center text-sm text-gray-400 mt-8">
            Só quer monitorar a marca?{' '}
            <button type="button" onClick={() => openCheckout(planoRadar.kiwify_url)} className="text-[#60A5FA] underline">
              Radar avulso: {planoRadar.price}{planoRadar.period}
            </button>
            {' '}— já incluso no Plano Dominação.
          </p>
        )}
      </section>

      {/* O QUE VOCÊ FAZ NO VOICEFLOW HOJE — só recurso que está no ar (conferido 20/10/2026). */}
      <section className="container mx-auto px-6 pb-20">
        <h3 className="text-3xl font-bold text-center mb-3">O que você faz no VoiceFlow hoje</h3>
        <p className="text-center text-gray-400 mb-10">Tudo isto já está no ar — nada de "em breve".</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {RECURSOS.map((r) => (
            <div key={r.titulo} className="bg-[#111111] border border-gray-800 rounded-xl p-6">
              <p className="text-2xl mb-2">{r.icone}</p>
              <p className="font-bold text-white mb-2">{r.titulo}</p>
              <p className="text-sm text-gray-400">{r.texto}</p>
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-gray-500 mt-6">
          O VoiceFlow entrega roteiro, legenda, locução e cards em imagem. Ele não grava nem edita vídeo — você grava por cima.
        </p>
      </section>

      {/* Vídeos do fundador — some sozinha enquanto não houver vídeo publicado. */}
      <VideosSection />

      {/* NOVO MÓDULO: VoiceFlow Radar — o id é o alvo do botão "Conheça o RADAR
          PRO" no painel: sem ele a pessoa caía no topo da página e tinha que
          procurar o que foi ver. */}
      <section id="radar" className="container mx-auto px-6 pb-20 scroll-mt-6">
        <div className="max-w-5xl mx-auto bg-gradient-to-br from-[#0A0F1E] to-[#0A0A0A] border border-[#1E3A5F] rounded-2xl p-8 md:p-12">
          <div className="text-center mb-8">
            <span className="inline-block px-3 py-1 rounded-full bg-[#2563EB]/20 border border-[#2563EB]/40 text-[#60A5FA] text-sm font-medium mb-4">
              INCLUSO NO PLANO DOMINAÇÃO
            </span>
            <h3 className="text-3xl md:text-4xl font-bold mb-3">
              VoiceFlow <span className="text-[#2563EB]">Radar</span>
            </h3>
            <p className="text-xl text-gray-400">Controle a narrativa da sua marca.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 max-w-3xl mx-auto">
            {[
              // 20/10/2026: o que o Radar faz de verdade (cron diário via Google + relatório sob pedido).
              'Busca menções da sua marca no Google todos os dias',
              'Classifica cada menção com IA (positiva, neutra ou negativa)',
              'Alerta por e-mail quando aparece menção negativa',
              'Relatório de sentimento e tendências do seu nicho quando você pedir',
            ].map((item) => (
              <div key={item} className="flex items-start gap-3">
                <Check className="w-5 h-5 text-[#2563EB] shrink-0 mt-0.5" />
                <span className="text-gray-300">{item}</span>
              </div>
            ))}
          </div>

          <p className="text-center text-sm text-gray-500">
            Incluso no <span className="text-gray-300 font-medium">Plano Dominação</span> ou avulso
            {planoRadar ? <> por <span className="text-[#60A5FA] font-medium">{planoRadar.price}{planoRadar.period}</span></> : null}.
          </p>
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
              <p className="text-gray-400">Monte o mês de cada cliente — até 60 posts por vez, com roteiro, legenda, locução e cards — em poucos minutos, e revise tudo antes de entregar. Economize horas de roteirização.</p>
            </CardContent>
          </Card>

          <Card className="bg-[#111111] border border-gray-800 rounded-xl overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl font-bold text-[#22C55E]">Lojas e E-commerces</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-400">Cole o seu catálogo e cada produto vira um post conferido (preço, números e promessas). No WhatsApp, responda clientes com o Kit de respostas em texto e áudio, enviado por você.</p>
            </CardContent>
          </Card>

          <Card className="bg-[#111111] border border-gray-800 rounded-xl overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl font-bold text-[#8B5CF6]">Criadores e Coaches</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-400">Fale o seu briefing, escolha o objetivo do mês e receba até 30 dias de ganchos, roteiros, legendas e locuções prontos para gravar. Constância sem passar horas escrevendo.</p>
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
