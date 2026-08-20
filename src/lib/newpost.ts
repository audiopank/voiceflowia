// Publicar direto no feed da NewPost-IA (rede social própria — ver src/lib/socialLinks.ts).
//
// O post sai no nome do PRÓPRIO cliente: a rota /api/newpost/sessao cria (ou reusa) a conta
// dele lá com o mesmo e-mail do VoiceFlow e devolve um access_token curto. Daqui pra frente
// é o navegador que fala com a NewPost-IA — de propósito: função da Vercel tem teto de
// ~4,5MB por requisição, e os cards em PNG mais a locução em MP3 estouram isso em base64.
//
// O que vai no post, e por quê:
//   - texto  -> hook + legenda (é o que o cliente publicaria manualmente)
//   - imagens-> os mesmos PNGs 1080x1350 do carrossel (bucket post-media)
//   - áudio  -> a locução em MP3 (bucket post-audio). A NewPost-IA é a ÚNICA rede que
//               aceita áudio no post; no Instagram a locução não teria pra onde ir.

import { supabase } from './supabase'

export interface SessaoNewPost {
  accessToken: string
  newpostUserId: string
  supabaseUrl: string
  anonKey: string
  contaCriadaAgora: boolean
  senhaGerada: string | null
  email: string
}

// Erro que o chamador consegue tratar: quando o cliente já tinha conta na NewPost-IA,
// precisamos da senha dele uma única vez.
export class PrecisaSenhaNewPost extends Error {
  email: string
  constructor(mensagem: string, email: string) {
    super(mensagem)
    this.name = 'PrecisaSenhaNewPost'
    this.email = email
  }
}

// O cliente ainda nao escolheu como quer aparecer na rede. So acontece na PRIMEIRA
// publicacao — depois o vinculo existe e ninguem pergunta mais nada.
export class PrecisaNomeNewPost extends Error {
  sugestao: string
  constructor(sugestao: string) {
    super('Escolha o nome do seu perfil na NewPost-IA.')
    this.name = 'PrecisaNomeNewPost'
    this.sugestao = sugestao
  }
}

// Teto da bio do perfil — mesmo valor no gerador (api/gemini/gerar-bio.ts) e na rota que
// grava (api/newpost/sessao.ts). Bio maior que isso é cortada na tela do perfil.
export const LIMITE_BIO = 160

// Corta a bio no limite SEM quebrar emoji. `.slice()` conta unidade UTF-16, então um
// emoji (par substituto) que caia em cima do índice 160 é partido ao meio e a metade
// órfã aparece como "�" na tela e no perfil público. Descarta a metade solta.
export function limitarBio(texto: string): string {
  return texto.slice(0, LIMITE_BIO).replace(/[\uD800-\uDBFF]$/, '')
}

// Pede à IA uma bio a partir do nome do perfil e do nicho que o cliente já digitou.
// Falhar aqui NÃO pode travar a publicação: sem bio o perfil nasce sem bio, e o cliente
// escreve a dele na rede depois. Por isso devolve string vazia em vez de estourar.
export async function sugerirBioNewPost(marca: string, nicho: string): Promise<string> {
  try {
    const res = await fetch('/api/gemini/gerar-bio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marca, nicho }),
    })
    if (!res.ok) return ''
    // Corpo pode não ser JSON (504 da Vercel devolve HTML) — mesmo cuidado do resto do arquivo.
    const bruto = await res.text()
    try {
      const dados = JSON.parse(bruto)
      return typeof dados?.bio === 'string' ? limitarBio(dados.bio) : ''
    } catch {
      return ''
    }
  } catch {
    return ''
  }
}

export async function obterSessaoNewPost(
  marca: string,
  opcoes: { nomePerfil?: string; senhaNewpost?: string; bio?: string } = {},
): Promise<SessaoNewPost> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Faça login no VoiceFlow para publicar.')

  const res = await fetch('/api/newpost/sessao', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ marca, nomePerfil: opcoes.nomePerfil, senhaNewpost: opcoes.senhaNewpost, bio: opcoes.bio }),
  })

  // Resposta pode não ser JSON (502/504 da Vercel devolvem HTML) — ler como texto
  // primeiro evita o "Unexpected token '<'" que já nos mordeu antes.
  const bruto = await res.text()
  let dados: any = {}
  try { dados = JSON.parse(bruto) } catch { /* mantém {} */ }

  if (!res.ok) {
    if (dados?.precisaNome) throw new PrecisaNomeNewPost(dados.sugestao || '')
    if (dados?.precisaSenha) throw new PrecisaSenhaNewPost(dados.error || 'Informe a senha da NewPost-IA.', dados.email || '')
    throw new Error(dados?.error || `Falha ao conectar na NewPost-IA (HTTP ${res.status}).`)
  }
  return dados as SessaoNewPost
}

async function subirArquivo(
  sessao: SessaoNewPost,
  bucket: string,
  caminho: string,
  blob: Blob,
): Promise<string> {
  const res = await fetch(`${sessao.supabaseUrl}/storage/v1/object/${bucket}/${caminho}`, {
    method: 'POST',
    headers: {
      apikey: sessao.anonKey,
      Authorization: `Bearer ${sessao.accessToken}`,
      'Content-Type': blob.type || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: blob,
  })
  if (!res.ok) throw new Error(`Falha ao subir arquivo (${bucket}): ${(await res.text()).slice(0, 140)}`)
  return `${sessao.supabaseUrl}/storage/v1/object/public/${bucket}/${caminho}`
}

export interface PostNewPost {
  texto: string
  imagens?: Blob[]
  audio?: Blob | null
  tags?: string[]
  // Mesma chave = mesmo post. Protege contra clique duplo e contra o cliente publicar
  // duas vezes quando a conexão cai no meio.
  chaveUnica: string
}

// Hash curto e estável do texto (djb2). Entra na chave de idempotência pra separar
// "clicou duas vezes no mesmo post" de "regerou o kit e quer publicar de novo": a
// posição no calendário se repete, mas o texto muda. Sem isso, o cliente que
// regerasse o conteúdo da mesma data tomaria erro de chave duplicada do banco.
function hashTexto(texto: string): string {
  let h = 5381
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export interface ResultadoPublicacao {
  postId: string
  contaCriadaAgora: boolean
  senhaGerada: string | null
  email: string
}

export async function publicarNaNewPost(post: PostNewPost, sessao: SessaoNewPost): Promise<ResultadoPublicacao> {
  const carimbo = Date.now()
  const uid = sessao.newpostUserId

  // Os arquivos seguem o mesmo padrão de caminho que a própria NewPost-IA usa:
  // {author_id}/{timestamp}-{n}.{ext} — as policies do Storage esperam a pasta do usuário.
  const mediaUrls: string[] = []
  const mediaTypes: string[] = []
  for (let i = 0; i < (post.imagens?.length ?? 0); i++) {
    const url = await subirArquivo(sessao, 'post-media', `${uid}/${carimbo}-${i}.png`, post.imagens![i])
    mediaUrls.push(url)
    mediaTypes.push('image')
  }

  let audioUrl: string | null = null
  if (post.audio) {
    const ext = post.audio.type.includes('mpeg') ? 'mp3' : post.audio.type.includes('ogg') ? 'ogg' : 'wav'
    audioUrl = await subirArquivo(sessao, 'post-audio', `${uid}/${carimbo}-locucao.${ext}`, post.audio)
  }

  const res = await fetch(`${sessao.supabaseUrl}/rest/v1/posts`, {
    method: 'POST',
    headers: {
      apikey: sessao.anonKey,
      Authorization: `Bearer ${sessao.accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      author_id: uid,
      content: post.texto,
      media_urls: mediaUrls.length ? mediaUrls : null,
      media_types: mediaTypes.length ? mediaTypes : null,
      audio_url: audioUrl,
      tags: post.tags?.length ? post.tags : [],
      status: 'published',
      privacy: 'public',
      // Marca a origem: o feed sabe distinguir o que veio do VoiceFlow, e o campo
      // is_ia_generated é honesto — o roteiro foi gerado por IA.
      is_ia_generated: true,
      network: 'voiceflow',
      // O índice único de idempotency_key na NewPost-IA é GLOBAL, não por autor: sem o uid
      // no prefixo, dois clientes diferentes que gerassem o kit pra mesma data cairiam na
      // mesma chave ("...-dia-01-manha-09h00-0") e o segundo teria a publicação recusada.
      // O hash do texto no fim libera republicar depois de regerar/editar o conteúdo.
      idempotency_key: `${uid}-${post.chaveUnica}-${hashTexto(post.texto)}`,
    }),
  })

  if (!res.ok) throw new Error(`Falha ao publicar: ${(await res.text()).slice(0, 200)}`)
  // Aqui o post JÁ está publicado (res.ok). Se o corpo vier sem ser JSON, não dá pra
  // gritar "falhou" pro cliente — o id é só um extra. Por isso .catch em vez de estourar.
  const linhas = await res.json().catch(() => null)
  return {
    postId: Array.isArray(linhas) ? linhas[0]?.id : linhas?.id,
    contaCriadaAgora: sessao.contaCriadaAgora,
    senhaGerada: sessao.senhaGerada,
    email: sessao.email,
  }
}

export const URL_NEWPOST = 'https://plugpost-ai.lovable.app'
