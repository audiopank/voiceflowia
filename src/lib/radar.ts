// Acesso ao módulo VoiceFlow Radar (add-on). Mesmo mecanismo do courtesy/trial:
// expiração calculada no client a partir de um timestamp, sem cron. É um
// entitlement PARALELO ao subscription_plan (cliente pode ter Dominação + Radar).

const DAY_MS = 24 * 60 * 60 * 1000

export interface RadarAccessState {
  active: boolean
  expiresAt: Date | null
  daysLeft: number
  expired: boolean
}

interface ProfileLike {
  radar_expires_at?: string | null
}

export function computeRadarAccess(profile: ProfileLike | null | undefined): RadarAccessState {
  const expiresAt = profile?.radar_expires_at ? new Date(profile.radar_expires_at) : null
  if (!expiresAt) return { active: false, expiresAt: null, daysLeft: 0, expired: false }

  const remainingMs = expiresAt.getTime() - Date.now()
  const expired = remainingMs <= 0
  const daysLeft = Math.max(0, Math.ceil(remainingMs / DAY_MS))

  return { active: !expired, expiresAt, daysLeft, expired }
}

// DOMINAÇÃO INCLUI O RADAR (20/10/2026): Dominação = Crescimento + Radar. Espelho no front da
// regra do servidor (api/_lib/radarAcesso.ts) — mudar os dois juntos. `acessoPagoValido` é o
// mesmo critério do acesso ao conteúdo (plano pago com cortesia válida, se houver).
export function temRadarPeloPlano(plan: string | null, acessoPagoValido: boolean): boolean {
  return plan === 'dominacao' && acessoPagoValido
}
