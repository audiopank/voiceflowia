import { supabase } from './supabase'
import { TRIAL_PLAN, TRIAL_DAYS, TRIAL_GENERATIONS } from './trial'

// Linha crua devolvida pela RPC admin_list_trial_users (MIGRATION_TRIALS_ADMIN.sql).
export interface TrialUserRow {
  email: string
  cadastro_em: string
  trial_started_at: string | null
  trial_generations_used: number
  subscription_plan: string | null
  subscription_status: string | null
  pediu_trial_no_cadastro: boolean
}

export type TrialSituacao = 'assinante' | 'ativo' | 'expirado' | 'nao_iniciou'

const DAY_MS = 24 * 60 * 60 * 1000

// Mesma régua do computeTrial (src/lib/trial.ts), aplicada a uma linha de admin:
// pago ganha de tudo; depois vem tempo (7 dias) e cota (10 gerações).
export function situacaoTrial(row: TrialUserRow): TrialSituacao {
  if (
    (row.subscription_plan === 'crescimento' || row.subscription_plan === 'dominacao') &&
    row.subscription_status === 'active'
  ) {
    return 'assinante'
  }
  if (!row.trial_started_at) return 'nao_iniciou'

  const inicio = new Date(row.trial_started_at).getTime()
  const dentroDoPrazo = Date.now() - inicio <= TRIAL_DAYS * DAY_MS
  const temCota = (row.trial_generations_used ?? 0) < TRIAL_GENERATIONS

  return row.subscription_plan === TRIAL_PLAN && dentroDoPrazo && temCota ? 'ativo' : 'expirado'
}

// null = a consulta FALHOU (sem sessão de admin, RPC não migrada, rede). O chamador
// mostra erro em vez de lista vazia — lista vazia é uma afirmação ("ninguém pediu
// trial") que só vale quando a RPC respondeu de verdade.
export async function fetchTrialUsers(): Promise<TrialUserRow[] | null> {
  const { data, error } = await supabase.rpc('admin_list_trial_users')
  if (error || !Array.isArray(data)) return null
  return data as TrialUserRow[]
}
