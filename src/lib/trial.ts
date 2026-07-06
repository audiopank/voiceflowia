// Regras do plano Trial de 7 dias (User_7_dias_Free).
// Acesso igual ao Crescimento; bloqueia quando acaba o tempo OU as gerações.

export const TRIAL_PLAN = 'User_7_dias_Free'
export const TRIAL_DAYS = 7
export const TRIAL_GENERATIONS = 10

const DAY_MS = 24 * 60 * 60 * 1000

export interface TrialState {
  isTrial: boolean
  startedAt: Date | null
  daysLeft: number // dias inteiros restantes (0..7)
  generationsUsed: number
  generationsLeft: number // 0..10
  timeExpired: boolean
  limitReached: boolean
  expired: boolean // timeExpired || limitReached
  active: boolean // isTrial && !expired
}

interface ProfileLike {
  subscription_plan?: string | null
  trial_started_at?: string | null
  trial_generations_used?: number | null
}

export function computeTrial(profile: ProfileLike | null | undefined): TrialState {
  const isTrial = profile?.subscription_plan === TRIAL_PLAN
  const startedAt = profile?.trial_started_at ? new Date(profile.trial_started_at) : null
  const used = profile?.trial_generations_used ?? 0

  let daysLeft = 0
  if (startedAt) {
    const remainingMs = TRIAL_DAYS * DAY_MS - (Date.now() - startedAt.getTime())
    daysLeft = Math.max(0, Math.ceil(remainingMs / DAY_MS))
  }

  const generationsLeft = Math.max(0, TRIAL_GENERATIONS - used)
  const timeExpired = isTrial && startedAt !== null && daysLeft <= 0
  const limitReached = isTrial && generationsLeft <= 0
  const expired = isTrial && (timeExpired || limitReached)
  const active = isTrial && !expired

  return {
    isTrial,
    startedAt,
    daysLeft,
    generationsUsed: used,
    generationsLeft,
    timeExpired,
    limitReached,
    expired,
    active,
  }
}
