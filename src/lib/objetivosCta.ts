export type ObjetivoCta = 'vender' | 'lead' | 'seguidor' | 'whatsapp'

export const OBJETIVOS_CTA: { value: ObjetivoCta; label: string; emoji: string }[] = [
  { value: 'vender', label: 'Vender', emoji: '🛒' },
  { value: 'lead', label: 'Gerar Lead', emoji: '📋' },
  { value: 'seguidor', label: 'Ganhar Seguidor', emoji: '➕' },
  { value: 'whatsapp', label: 'Levar pro WhatsApp', emoji: '💬' }
]
