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
    active: true,
  },
  {
    slug: 'crescimento',
    name: 'Plano Crescimento',
    price: 'R$ 97,90',
    period: '/mês',
    features: [
      { text: 'Tudo do Plano Inicial', included: true },
      { text: 'Agente de Conteúdo IA 24h', included: true },
      { text: '15 Projetos de Voz / mês', included: true },
    ],
    cta_label: 'Começar Agora',
    kiwify_url: import.meta.env.VITE_KIWIFY_CRESCIMENTO_URL || null,
    referral_kiwify_url: null,
    badge: 'MAIS VENDIDO',
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
      { text: 'Atendimento por Voz no WhatsApp', included: true },
      { text: 'Estratégia com posts gerados com IA', included: true },
      { text: 'Vagas Limitadas: 5 vagas', included: true },
    ],
    cta_label: 'Quero Dominar',
    kiwify_url: import.meta.env.VITE_KIWIFY_DOMINACAO_URL || null,
    referral_kiwify_url: null,
    badge: null,
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
