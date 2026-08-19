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

// Normaliza o numero pro formato que o wa.me exige: so digitos, comecando pelo
// codigo do pais.
//
// Por que existe: o cliente digita o numero como fala — "85 99226-2297" — e o link
// saia como wa.me/85992262297, que o WhatsApp recusa com "o codigo do pais 55 nao
// foi inserido". O placeholder do campo ja pedia DDI+DDD e mesmo assim acontecia:
// pedir pro usuario formatar nunca funciona, quem tem que consertar e o codigo.
//
// Regras (numeracao brasileira):
//   10 digitos = DDD + fixo de 8      -> falta o 55
//   11 digitos = DDD + celular de 9   -> falta o 55
//   12 digitos = 55 + DDD + fixo      -> ja tem
//   13 digitos = 55 + DDD + celular   -> ja tem
// Um DDD 55 (Santa Maria/RS) nao confunde a conta: 5533334444 tem 10 digitos, cai
// na primeira regra e vira 555533334444, que e o certo.
// LIMITE ASSUMIDO: 10 ou 11 digitos sao SEMPRE tratados como brasileiros. Um numero
// dos EUA (11 digitos com o 1 na frente) tambem ganharia o 55 e sairia errado. E
// aceitavel porque o produto e para o mercado brasileiro; quem for de fora precisa
// digitar com o DDI, e ai o tamanho passa de 11 e o numero segue intacto.
export function normalizarWhatsapp(numero: string): string {
  let digits = numero.replace(/\D/g, '')
  // "085 99226-2297": zero antes do DDD e habito de ligacao interurbana e nao entra
  // no formato internacional.
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '')
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  return digits
}

// Numero curto demais pra ser telefone — usado pra avisar o cliente ANTES de ele
// publicar um CTA com link quebrado.
// Texto sem digito nenhum ("meu whats") tambem conta como incompleto: normaliza pra
// string vazia, que geraria wa.me/ pelado. Quem chama e responsavel por so perguntar
// quando o campo nao esta vazio (o CtaObjetivo faz isso com numero.trim()).
export function whatsappIncompleto(numero: string): boolean {
  const digits = normalizarWhatsapp(numero)
  return digits.length < 12
}

export function buildWaLink(numero: string, mensagem: string, incluirMensagem: boolean): string {
  const digits = normalizarWhatsapp(numero)
  const base = `https://wa.me/${digits}`
  return incluirMensagem ? `${base}?text=${encodeURIComponent(mensagem)}` : base
}
