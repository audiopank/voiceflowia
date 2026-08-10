// Numero de WhatsApp da marca + mensagem pre-preenchida, salvos por usuario no
// navegador (localStorage) — mesmo padrao de src/lib/socialLinks.ts. E config
// estatica da marca (nao varia por post), por isso e montada no client em vez
// de gerada pela IA a cada CTA.

export interface BrandWhatsapp {
  numero: string
  mensagem: string
  // Desmarcado por padrão: link só com o número (curto, sem cara de phishing).
  // Marcado, entra a mensagem pré-preenchida via ?text= — deixa o link maior.
  incluirMensagem: boolean
}

const KEY_PREFIX = 'voiceflow:brand-whatsapp'
const EVENT_NAME = 'voiceflow:brand-whatsapp-updated'

export const MENSAGEM_PADRAO = 'Vim pelo Instagram e quero testar o VoiceFlow IA grátis!'

const WHATSAPP_VAZIO: BrandWhatsapp = { numero: '', mensagem: MENSAGEM_PADRAO, incluirMensagem: false }

export function brandWhatsappKey(userId?: string | null): string {
  return `${KEY_PREFIX}:${userId ?? 'anon'}`
}

export function loadBrandWhatsapp(key: string): BrandWhatsapp {
  try {
    const raw = localStorage.getItem(key)
    // Merge com o default: registros salvos antes do checkbox existir não têm
    // `incluirMensagem` no JSON e cairiam undefined sem isso.
    if (raw) return { ...WHATSAPP_VAZIO, ...JSON.parse(raw) }
  } catch {
    // localStorage indisponível/JSON inválido — cai no default abaixo.
  }
  return WHATSAPP_VAZIO
}

export function saveBrandWhatsapp(key: string, data: BrandWhatsapp): void {
  try {
    localStorage.setItem(key, JSON.stringify(data))
    window.dispatchEvent(new Event(EVENT_NAME))
  } catch {
    // localStorage indisponível — ignora (o cliente reconfigura na sessão).
  }
}

// Outras instâncias de CtaObjetivo (1 por card) escutam isso pra sincronizar na
// hora quando o número é salvo em outro card, sem precisar fechar/reabrir.
export function onBrandWhatsappUpdated(cb: () => void): () => void {
  window.addEventListener(EVENT_NAME, cb)
  return () => window.removeEventListener(EVENT_NAME, cb)
}

export function buildWaLink(numero: string, mensagem: string, incluirMensagem: boolean): string {
  const digits = numero.replace(/\D/g, '') // wa.me exige só dígitos (DDI+DDD+número)
  const base = `https://wa.me/${digits}`
  return incluirMensagem ? `${base}?text=${encodeURIComponent(mensagem)}` : base
}
