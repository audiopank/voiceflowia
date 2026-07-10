import { supabase } from './supabase'

export interface ExpanderAgent {
  id?: string
  slug: string
  display_name: string
  contact_email: string
  courtesy_plan: string
  courtesy_days: number
  active: boolean
  created_at?: string
}

export interface ReferredProfile {
  email: string
  subscription_plan: string | null
  subscription_status: string | null
  created_at: string
}

export interface AgentProfileStatus {
  subscription_plan: string | null
  subscription_status: string | null
  courtesy_expires_at: string | null
}

// O desconto de indicacao NAO vem de cupom (a Kiwify desta conta nao tem
// cupom avulso) — vem de uma "Oferta" separada criada manualmente em cada
// produto, com o preco ja reduzido. `referralKiwifyUrl` e o link dessa
// oferta (plans.referral_kiwify_url); aqui so acrescentamos o parametro de
// rastreio (s1) pra saber QUEM indicou (ver api/kiwify/webhook.ts).
export function buildReferralLink(referralKiwifyUrl: string, slug: string): string {
  const separator = referralKiwifyUrl.includes('?') ? '&' : '?'
  return `${referralKiwifyUrl}${separator}s1=${encodeURIComponent(slug)}`
}

// Normalizacao "ao vivo" (enquanto digita): minuscula, sem acento, espacos
// viram hifen — mas preserva hifen no final pra nao atrapalhar quem esta
// no meio de digitar "pc-otobel".
export function slugLive(v: string): string {
  return v
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
}

// Normalizacao final (ao salvar): igual slugLive, mas tambem remove hifen
// solto nas pontas. Precisa bater com o CHECK constraint slug ~ '^[a-z0-9-]+$'
// de expander_agents (ver MIGRATION_REFERRALS.sql).
export function slugFinal(v: string): string {
  return slugLive(v).replace(/^-+|-+$/g, '')
}

export function emptyAgent(): ExpanderAgent {
  return {
    slug: '',
    display_name: '',
    contact_email: '',
    courtesy_plan: 'dominacao',
    courtesy_days: 30,
    active: true,
  }
}

export async function fetchAllAgents(): Promise<ExpanderAgent[]> {
  const { data, error } = await supabase
    .from('expander_agents')
    .select('*')
    .order('created_at', { ascending: true })

  if (error || !data) return []
  return data as ExpanderAgent[]
}

export async function fetchReferredProfiles(agentSlug: string): Promise<ReferredProfile[]> {
  const { data, error } = await supabase.rpc('admin_list_referred_profiles', { p_agent_slug: agentSlug })
  if (error || !data) return []
  return data as ReferredProfile[]
}

export async function fetchAgentProfileStatus(email: string): Promise<AgentProfileStatus | null> {
  const { data, error } = await supabase.rpc('admin_get_profile_status', { p_email: email })
  if (error || !data || data.length === 0) return null
  return data[0] as AgentProfileStatus
}

export async function grantCourtesyAccess(email: string, agentSlug: string) {
  return supabase.rpc('grant_courtesy_access', { p_email: email, p_agent_slug: agentSlug })
}
