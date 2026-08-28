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
  // Quando presente, o post sai como EPISÓDIO desta série na NewPost-IA (a série é
  // criada na primeira publicação e reusada nas seguintes; o número do episódio é
  // automático, por trigger no banco da rede).
  serie?: SerieNewPost | null
}

export interface SerieNewPost {
  titulo: string
  descricao?: string
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

// Nome da temporada a partir do calendário do cliente: "{marca} — Temporada de {mês} de {ano}".
// O ano entra no título de propósito: a busca de série é por (autor, título), e sem o ano o
// setembro do ano que vem cairia DENTRO da temporada de setembro deste ano.
export function serieDoCalendario(nicho: string, dataInicio: string): SerieNewPost {
  let d = new Date(`${dataInicio}T12:00:00`) // meio-dia: fuso não volta o dia
  if (isNaN(d.getTime())) {
    const m = dataInicio.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    d = m ? new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00`) : new Date()
  }
  const mes = MESES[d.getMonth()]
  const ano = d.getFullYear()
  const marca = nicho.trim() || 'Minha marca'
  return {
    titulo: `${marca} — Temporada de ${mes} de ${ano}`,
    descricao: `Os conteúdos de ${mes} de ${ano}, um episódio por vez — com locução pronta. Siga a série pra não perder o próximo.`,
  }
}

// Acha (ou cria) a série do cliente na rede. Série é EXTRA: se qualquer passo falhar,
// devolve null e o post sai avulso — publicar nunca trava por causa da série.
async function garantirSerie(
  sessao: SessaoNewPost,
  serie: SerieNewPost,
  coverUrl: string | null,
): Promise<string | null> {
  const H = {
    apikey: sessao.anonKey,
    Authorization: `Bearer ${sessao.accessToken}`,
    'Content-Type': 'application/json',
  }
  try {
    const filtro = `author_id=eq.${sessao.newpostUserId}&title=eq.${encodeURIComponent(serie.titulo)}`
    const busca = await fetch(`${sessao.supabaseUrl}/rest/v1/series?${filtro}&select=id&limit=1`, { headers: H })
    if (busca.ok) {
      const linhas = await busca.json().catch(() => null)
      if (Array.isArray(linhas) && linhas[0]?.id) return linhas[0].id
    }
    const cria = await fetch(`${sessao.supabaseUrl}/rest/v1/series`, {
      method: 'POST',
      headers: { ...H, Prefer: 'return=representation' },
      body: JSON.stringify({
        author_id: sessao.newpostUserId,
        title: serie.titulo,
        description: serie.descricao ?? null,
        cover_url: coverUrl, // capa da temporada = primeiro card publicado nela
      }),
    })
    if (cria.ok) {
      const novas = await cria.json().catch(() => null)
      const id = Array.isArray(novas) ? (novas[0]?.id ?? null) : (novas?.id ?? null)
      if (id) return id
    }
    // INSERT recusado (ex.: outro clique criou a série um instante antes — há unique de
    // autor+título na rede): re-busca uma vez; se ainda assim nada, o post sai avulso.
    const rebusca = await fetch(`${sessao.supabaseUrl}/rest/v1/series?${filtro}&select=id&limit=1`, { headers: H })
    if (!rebusca.ok) return null
    const achadas = await rebusca.json().catch(() => null)
    return Array.isArray(achadas) ? (achadas[0]?.id ?? null) : null
  } catch {
    return null
  }
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
  // Preenchidos quando o post saiu como episódio de série (null = saiu avulso).
  serieId: string | null
  serieTitulo: string | null
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

  // Série (temporada): resolvida DEPOIS dos uploads pra usar o 1º card como capa.
  // null aqui = segue avulso; a publicação nunca depende da série dar certo.
  const serieId = post.serie ? await garantirSerie(sessao, post.serie, mediaUrls[0] ?? null) : null

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
      // Episódio de série: o número vem sozinho (trigger na rede numera na ordem).
      // A chave só entra no corpo quando HÁ série: mandar `series_id: null` parece
      // inofensivo, mas se a coluna ainda não existir no banco da rede o PostgREST
      // recusa o INSERT inteiro (PGRST204) — e aí TODA publicação quebraria, não só
      // as de série. Omitir a chave mantém o post avulso funcionando sempre.
      ...(serieId ? { series_id: serieId } : {}),
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
    serieId,
    serieTitulo: serieId ? (post.serie?.titulo ?? null) : null,
  }
}

// O endereço mora em socialLinks.ts (arquivo sem dependência nenhuma) e é reexportado
// aqui pra não quebrar quem já importava daqui. Antes ele estava escrito à mão nos dois
// arquivos — que é como se troca um e esquece o outro.
export { URL_NEWPOST } from './socialLinks'
