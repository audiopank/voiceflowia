// Regras do acesso cortesia (concedido a Agentes Expansores pelo Admin).
// Mesmo mecanismo do trial de 7 dias: expiração calculada no client a
// partir de um timestamp, sem cron — ver src/lib/trial.ts.

const DAY_MS = 24 * 60 * 60 * 1000

export interface CourtesyState {
  active: boolean
  expiresAt: Date | null
  daysLeft: number
  expired: boolean
}

interface ProfileLike {
  courtesy_expires_at?: string | null
}

export function computeCourtesy(profile: ProfileLike | null | undefined): CourtesyState {
  const expiresAt = profile?.courtesy_expires_at ? new Date(profile.courtesy_expires_at) : null
  if (!expiresAt) return { active: false, expiresAt: null, daysLeft: 0, expired: false }

  const remainingMs = expiresAt.getTime() - Date.now()
  const expired = remainingMs <= 0
  const daysLeft = Math.max(0, Math.ceil(remainingMs / DAY_MS))

  return { active: !expired, expiresAt, daysLeft, expired }
}
