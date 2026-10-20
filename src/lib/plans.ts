import { supabase } from './supabase'

export interface PlanFeature {
  text: string
  included: boolean
}

export interface Plan {
  id?: string
  slug: string
  name: string
  price: string
  period: string
  features: PlanFeature[]
  cta_label: string
  kiwify_url: string | null
  // Link de checkout de uma "Oferta" separada na Kiwify, com o preço já
  // reduzido (10% off) — usado nos links de indicação dos Agentes
  // Expansores. A Kiwify desta conta não tem cupom avulso, então o
  // desconto vem de uma Oferta própria, não de um parâmetro na URL.
  referral_kiwify_url: string | null
  badge: string | null
  highlight: boolean
  sort_order: number
  active: boolean
}

// Email do admin (quem pode abrir /admin). A seguranca real e feita pela RLS
// do Supabase; isto controla apenas a exibicao da interface.
export const ADMIN_EMAIL =
  (import.meta.env.VITE_ADMIN_EMAIL as string) || 'novaaudiopank@gmail.com'

// Fallback usado enquanto a tabela `plans` nao existe / esta vazia, para a
// pagina de Precos nunca renderizar em branco (importante em demo).
export const DEFAULT_PLANS: Plan[] = [
  {
    slug: 'inicial',
    name: 'Escolha seu plano',
    price: 'Assinatura',
    period: '/mês',
    features: [
      { text: 'Dashboard de Métricas Completo', included: true },
      { text: 'Gerações de Vozes com IA / mês', included: true },
      { text: 'Conteúdos para suas redes sociais', included: true },
    ],
    cta_label: 'Começar Agora',
    // ISCA DE ANCORAGEM: sem link proprio de proposito. O clique e funilado
    // para o checkout do plano em destaque (R$97,90).
    kiwify_url: null,
    referral_kiwify_url: null,
    badge: 'Melhor custo-benefício',
    highlight: false,
    sort_order: 1,
    // 20/10/2026: card-isca DESLIGADO (a página mostra o teste grátis como 1º degrau).
    active: false,
  },
  {
    slug: 'crescimento',
    name: 'Plano Crescimento',
    price: 'R$ 97,90',
    period: '/mês',
    features: [
      { text: 'Mês de conteúdo com IA: gancho, roteiro, legenda, locução e cards', included: true },
      { text: 'Catálogo → Posts com conferência de preço, números e promessas', included: true },
      { text: 'Kit de Respostas de WhatsApp em texto e áudio', included: true },
      { text: 'Briefing por voz e objetivo do mês (alcance, leads ou vendas)', included: true },
      { text: 'Locução com escolha de voz e Modo Diálogo (2 vozes)', included: true },
    ],
    cta_label: 'Assinar o Crescimento',
    kiwify_url: import.meta.env.VITE_KIWIFY_CRESCIMENTO_URL || null,
    referral_kiwify_url: null,
    badge: null,
    highlight: true,
    sort_order: 2,
    active: true,
  },
  {
    slug: 'dominacao',
    name: 'Plano Dominação',
    price: 'R$ 167,90',
    period: '/mês',
    features: [
      { text: 'Tudo do Plano Crescimento', included: true },
      { text: 'VoiceFlow Radar incluso: menções da sua marca no Google todos os dias', included: true },
      { text: 'Alerta por e-mail quando aparece menção negativa', included: true },
      { text: 'Relatório de sentimento e tendências quando você pedir', included: true },
      { text: 'Economia de R$ 37,90/mês (separado sairia R$ 205,80)', included: true },
    ],
    cta_label: 'Assinar o Dominação',
    kiwify_url: import.meta.env.VITE_KIWIFY_DOMINACAO_URL || null,
    referral_kiwify_url: null,
    badge: 'MAIS COMPLETO',
    highlight: false,
    sort_order: 3,
    active: true,
  },
]

// Planos ativos para a pagina publica de Precos.
export async function fetchActivePlans(): Promise<Plan[]> {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true })

  if (error || !data || data.length === 0) return DEFAULT_PLANS
  return data as Plan[]
}

// Todos os planos (ativos e inativos) para o Painel Admin.
export async function fetchAllPlans(): Promise<Plan[]> {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error || !data) return []
  return data as Plan[]
}
