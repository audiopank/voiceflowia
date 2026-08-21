// Links das redes sociais do próprio cliente, salvos por usuário no navegador
// (localStorage) — mesmo padrão das vozes favoritas em src/routes/biblioteca.tsx.
// Usados no Super Agente pra "postar sem sair do app": abrir a rede + copiar a
// legenda do post. Sem persistência no Supabase (decisão de produto: simples,
// por dispositivo).

// Domínio próprio da NewPost-IA desde 21/08/2026. O antigo (plugpost-ai.lovable.app)
// redireciona pra cá, então nada quebra — mas é isto que o cliente vê no botão "Ver no
// feed" e no painel de redes, e endereço de subdomínio de plataforma parece protótipo.
//
// FONTE ÚNICA, e mora AQUI e não em newpost.ts de propósito: este arquivo é só
// localStorage e não tem dependência nenhuma, enquanto newpost.ts arrasta o cliente do
// Supabase junto. Quem depende de quem importa pro tamanho do bundle.
export const URL_NEWPOST = 'https://www.newpostia.app'

export interface SocialNetwork {
  key: string // 'instagram' | 'facebook' | ...
  label: string
  placeholder: string
  defaultUrl?: string // só a NewPost-IA tem URL fixa
}

export const SOCIAL_NETWORKS: SocialNetwork[] = [
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/seuusuario' },
  { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/suapagina' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/in/seuusuario' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@seucanal' },
  {
    // A chave NÃO muda junto com o domínio: ela identifica o link que cada cliente já
    // salvou no navegador (voiceflow:social-links:<userId>). Renomear pra "newpost"
    // deixaria órfão o que todo mundo configurou — some da tela sem erro nenhum.
    key: 'plugpost',
    label: 'NewPost-IA (rede BR)',
    placeholder: `${URL_NEWPOST}/`,
    defaultUrl: `${URL_NEWPOST}/`,
  },
]

const KEY_PREFIX = 'voiceflow:social-links'

export type SocialLinks = Record<string, string>

export function socialKey(userId: string | null | undefined): string {
  return `${KEY_PREFIX}:${userId ?? 'anon'}`
}

// Endereços antigos da NewPost-IA, de antes do domínio próprio. Ficaram salvos no
// navegador de todo cliente que já configurou as redes — e `defaultUrl` só preenche quem
// nunca salvou nada, então sem isto eles carregariam o endereço velho pra sempre.
const HOSTS_ANTIGOS_NEWPOST = ['plugpost-ai.lovable.app', 'plugpost-ai.lovableproject.com']

// Conserta na LEITURA, não numa migração de uma vez só: o dado mora no navegador de cada
// cliente, então não existe "rodar uma vez pra todo mundo". Mesmo padrão do código de país
// do WhatsApp em src/lib/brandWhatsapp.ts — quem abre, já abre certo.
function migrarLinks(links: SocialLinks): SocialLinks {
  const atual = links.plugpost
  if (typeof atual !== 'string' || !atual.trim()) return links
  const migrado = migrarUrlNewPost(atual.trim())
  return migrado ? { ...links, plugpost: migrado } : links
}

// Troca só o endereço e PRESERVA o caminho. Quem salvou o link do próprio perfil no
// domínio antigo (.../perfil/fulano) tem que continuar caindo no perfil — mandar todo
// mundo pra home é perder, calado, o link que o cliente configurou.
// Devolve null quando não é endereço antigo da NewPost-IA (aí não se mexe em nada).
function migrarUrlNewPost(url: string): string | null {
  let parsed: URL
  try {
    // O campo é texto livre: tem cliente que digita sem "https://".
    const temEsquema = /^https?:/i.test(url)
    parsed = new URL(temEsquema ? url : 'https://' + url)
  } catch {
    return null
  }
  const bruto = parsed.hostname.toLowerCase()
  const host = bruto.startsWith('www.') ? bruto.slice(4) : bruto
  if (!HOSTS_ANTIGOS_NEWPOST.includes(host)) return null
  return `${URL_NEWPOST}${parsed.pathname}${parsed.search}${parsed.hash}`
}

export function loadSocialLinks(key: string): SocialLinks {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return migrarLinks(JSON.parse(raw))
  } catch {
    // localStorage indisponível/JSON inválido — cai no default abaixo.
  }
  // Sem nada salvo: pré-preenche as redes que têm URL fixa (NewPost-IA).
  const init: SocialLinks = {}
  for (const n of SOCIAL_NETWORKS) if (n.defaultUrl) init[n.key] = n.defaultUrl
  return init
}

export function saveSocialLinks(key: string, links: SocialLinks): void {
  try {
    localStorage.setItem(key, JSON.stringify(links))
  } catch {
    // localStorage indisponível — ignora (o cliente reconfigura na sessão).
  }
}
