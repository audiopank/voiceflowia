// Links das redes sociais do próprio cliente, salvos por usuário no navegador
// (localStorage) — mesmo padrão das vozes favoritas em src/routes/biblioteca.tsx.
// Usados no Super Agente pra "postar sem sair do app": abrir a rede + copiar a
// legenda do post. Sem persistência no Supabase (decisão de produto: simples,
// por dispositivo).

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
    key: 'plugpost',
    label: 'NewPost-IA (rede BR)',
    placeholder: 'https://plugpost-ai.lovable.app/',
    defaultUrl: 'https://plugpost-ai.lovable.app/',
  },
]

const KEY_PREFIX = 'voiceflow:social-links'

export type SocialLinks = Record<string, string>

export function socialKey(userId: string | null | undefined): string {
  return `${KEY_PREFIX}:${userId ?? 'anon'}`
}

export function loadSocialLinks(key: string): SocialLinks {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw)
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
