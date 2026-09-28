import { supabase } from './supabase'

// NEWSLETTER SEMANAL — F1 (28/09). Lê a Memória da Marca (tabela `contents`, RLS do
// próprio usuário) pra alimentar a newsletter só com o que a marca JÁ publicou, e
// monta o texto/HTML do resultado. Nada aqui envia e-mail (envio = F2).

export interface NewsletterBloco {
  titulo: string
  texto: string
}

export interface Newsletter {
  assunto: string
  preheader: string
  abertura: string
  blocos: NewsletterBloco[]
  fechamento: string
}

export interface PostDaMemoria {
  gancho: string
  texto: string
}

export interface LinhaMemoria {
  nicho: string
  created_at: string
  posts: PostDaMemoria[]
}

// Mesma normalização do Super Agente: "Estética", "estetica" e "Estética " são o mesmo nicho.
export function chaveNicho(v: string): string {
  return v.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Últimas gerações do usuário. null = a consulta FALHOU (a tela não pode dizer "você não
// tem conteúdo" num soluço de rede — erro ≠ vazio).
export async function lerMemoriaDaMarca(): Promise<LinhaMemoria[] | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { data, error } = await supabase
      .from('contents')
      .select('nicho, posts_json, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(60)
    if (error || !Array.isArray(data)) return null
    return data.map((row: any) => ({
      nicho: typeof row?.nicho === 'string' ? row.nicho : '',
      created_at: typeof row?.created_at === 'string' ? row.created_at : '',
      posts: (Array.isArray(row?.posts_json) ? row.posts_json : [])
        .map((p: any) => ({
          gancho: typeof p?.hook === 'string' ? p.hook.trim() : '',
          texto: typeof p?.legenda === 'string' ? p.legenda.trim() : '',
        }))
        .filter((p: PostDaMemoria) => p.gancho || p.texto),
    }))
  } catch {
    return null
  }
}

// Nichos distintos da memória (pra sugerir no campo), na ordem do mais recente.
export function nichosDaMemoria(linhas: LinhaMemoria[]): string[] {
  const vistos = new Set<string>()
  const out: string[] = []
  for (const l of linhas) {
    const k = chaveNicho(l.nicho)
    if (!k || vistos.has(k)) continue
    vistos.add(k)
    out.push(l.nicho.trim())
  }
  return out
}

// Posts do nicho dentro da janela (semanas), do mais recente pro mais antigo.
export function postsDoPeriodo(linhas: LinhaMemoria[], nicho: string, semanas: number, limite = 15) {
  const alvo = chaveNicho(nicho)
  const desde = Date.now() - semanas * 7 * 24 * 60 * 60 * 1000
  let kits = 0
  const posts: PostDaMemoria[] = []
  for (const l of linhas) {
    if (!alvo || chaveNicho(l.nicho) !== alvo) continue
    const t = new Date(l.created_at).getTime()
    if (Number.isNaN(t) || t < desde) continue
    kits++
    for (const p of l.posts) {
      if (posts.length < limite) posts.push(p)
    }
  }
  return { kits, posts }
}

export function textoDaNewsletter(n: Newsletter): string {
  const partes = [`ASSUNTO: ${n.assunto}`, `PRÉ-VISUALIZAÇÃO: ${n.preheader}`, '', n.abertura]
  for (const b of n.blocos) partes.push('', b.titulo.toUpperCase(), b.texto)
  partes.push('', n.fechamento)
  return partes.join('\n').trim()
}

function esc(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function paragrafos(s: string): string {
  return esc(s).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;line-height:1.6">${p.replace(/\n/g, '<br>')}</p>`).join('')
}

// HTML de e-mail simples, com estilo inline (é o que os clientes de e-mail respeitam).
export function htmlDaNewsletter(n: Newsletter, marca: string): string {
  const blocos = n.blocos
    .map((b) => `<tr><td style="padding:8px 0 4px"><h2 style="margin:0 0 8px;font-size:18px;color:#111">${esc(b.titulo)}</h2>${paragrafos(b.texto)}</td></tr>`)
    .join('')
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(n.assunto)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#222">
<span style="display:none;max-height:0;overflow:hidden">${esc(n.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;padding:28px">
<tr><td style="font-size:13px;color:#666;padding-bottom:12px">${esc(marca)}</td></tr>
<tr><td>${paragrafos(n.abertura)}</td></tr>
${blocos}
<tr><td style="padding-top:8px">${paragrafos(n.fechamento)}</td></tr>
</table></td></tr></table>
</body></html>`
}
