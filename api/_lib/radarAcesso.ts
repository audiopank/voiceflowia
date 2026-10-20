// QUEM TEM RADAR (20/10/2026) — regra ÚNICA do servidor, usada pelo cron de alertas e pelo
// relatório. Duas portas:
//   1. comprou o Radar avulso (radar_expires_at no futuro — o webhook da Kiwify grava);
//   2. tem o PLANO DOMINAÇÃO ativo: desde 20/10 o Dominação = Crescimento + Radar incluso
//      (decisão do Mestre: o plano mais caro precisa entregar algo a mais, de verdade).
// Cortesia com prazo vencido não conta (mesma regra do acesso ao conteúdo no front).
// O espelho no front é `temRadarPeloPlano` em src/lib/radar.ts — mudar os dois juntos.

export const COLUNAS_RADAR = 'id, radar_expires_at, subscription_plan, subscription_status, courtesy_expires_at'

export interface PerfilRadar {
  radar_expires_at?: string | null
  subscription_plan?: string | null
  subscription_status?: string | null
  courtesy_expires_at?: string | null
}

export function temRadar(p: PerfilRadar | null | undefined, agora = Date.now()): boolean {
  if (!p) return false
  if (p.radar_expires_at && new Date(p.radar_expires_at).getTime() > agora) return true
  const cortesiaOk = !p.courtesy_expires_at || new Date(p.courtesy_expires_at).getTime() > agora
  return p.subscription_plan === 'dominacao' && p.subscription_status === 'active' && cortesiaOk
}
