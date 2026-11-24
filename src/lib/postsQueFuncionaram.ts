// 👍 "Esse funcionou" (24/11/2026): o dono marca, em Meus Conteúdos, os posts que deram certo; o
// Super Agente manda até 3 do mesmo nicho pra IA como exemplo de ESTILO (tabela
// posts_que_funcionaram — MIGRATION_POSTS_QUE_FUNCIONARAM.sql). É a opinião do dono, não métrica.
// Nada aqui derruba tela: sem tabela, sem login ou sem rede = "nenhum marcado".
import { supabase } from './supabase'
import { chaveNicho, exemplosDoNicho, nichosUnicos, type ExemploQueFuncionou } from './exemplosDoNicho'

export { chaveNicho }

// Nichos que o usuário já usou (mais recentes primeiro) — sugestões do campo Nicho. Falhou = [].
export async function nichosJaUsados(): Promise<string[]> {
  try {
    const u = await uid()
    if (!u) return []
    const { data, error } = await supabase.from('contents').select('nicho').eq('user_id', u).order('created_at', { ascending: false }).limit(200)
    if (error || !Array.isArray(data)) return []
    return nichosUnicos(data.map((l: any) => l?.nicho))
  } catch {
    return []
  }
}

export const chaveDoPost = (contentId: string, index: number) => `${contentId}:${index}`

async function uid(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user?.id ?? null
}

// Chaves "content_id:indice" já marcadas. null = não deu pra ler (tela esconde o botão em vez de mentir).
export async function listarMarcados(): Promise<Set<string> | null> {
  try {
    const u = await uid()
    if (!u) return null
    const { data, error } = await supabase.from('posts_que_funcionaram').select('content_id, post_index').eq('user_id', u)
    if (error || !Array.isArray(data)) return null
    return new Set(data.map((l: any) => chaveDoPost(String(l.content_id), Number(l.post_index))))
  } catch {
    return null
  }
}

// Devolve a mensagem de erro, ou '' se deu certo.
export async function marcarFuncionou(contentId: string, index: number, nicho: string, post: { hook?: string; roteiro?: string; legenda?: string }): Promise<string> {
  const u = await uid()
  if (!u) return 'Entre na sua conta para marcar.'
  const { error } = await supabase.from('posts_que_funcionaram').insert({
    user_id: u, content_id: contentId, post_index: index, nicho: nicho.slice(0, 200),
    hook: (post.hook ?? '').slice(0, 300), roteiro: (post.roteiro ?? '').slice(0, 2000), legenda: (post.legenda ?? '').slice(0, 3000),
  })
  // Já marcado (clique duplo / outra aba): o resultado que o cliente quer já existe.
  if (error && error.code !== '23505') return `Não consegui marcar agora (${error.message}).`
  return ''
}

export async function desmarcarFuncionou(contentId: string, index: number): Promise<string> {
  const u = await uid()
  if (!u) return 'Entre na sua conta para desmarcar.'
  const { error } = await supabase.from('posts_que_funcionaram').delete().eq('user_id', u).eq('content_id', contentId).eq('post_index', index)
  return error ? `Não consegui desmarcar agora (${error.message}).` : ''
}

// Pro Super Agente: até 3 exemplos marcados do mesmo nicho. Falhou = [] (gera como antes).
export async function exemplosQueFuncionaram(nicho: string): Promise<ExemploQueFuncionou[]> {
  try {
    const u = await uid()
    if (!u) return []
    const { data, error } = await supabase
      .from('posts_que_funcionaram')
      .select('nicho, hook, roteiro, legenda')
      .eq('user_id', u)
      .order('created_at', { ascending: false })
      .limit(30)
    if (error || !Array.isArray(data)) return []
    return exemplosDoNicho(data, nicho)
  } catch {
    return []
  }
}
