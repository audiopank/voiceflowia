// "Minha marca" (12/11/2026): a descrição da marca e as cores dos cards, guardadas NA CONTA
// (tabela marca_perfil — MIGRATION_MARCA_PERFIL.sql). Escrita uma vez no Dashboard e lida por
// todas as telas. Nunca derruba uma tela: sem tabela, sem login ou sem rede = "sem marca".
import { supabase } from './supabase'

export const LIMITE_DESCRICAO = 4000

export interface MinhaMarca {
  descricao: string
  corFundo: string | null
  corDestaque: string | null
}

// Uma leitura por página: Dashboard, Super Agente e o hook de cores pedem juntos.
// Chaveado pelo usuário: sair e entrar com outra conta na mesma aba (SPA) não herda a marca anterior.
let emCache: { uid: string; marca: Promise<MinhaMarca | null> } | null = null

async function ler(uid: string): Promise<MinhaMarca | null> {
  try {
    const { data, error } = await supabase
      .from('marca_perfil')
      .select('descricao, cor_fundo, cor_destaque')
      .eq('user_id', uid)
      .maybeSingle()
    if (error || !data) return null
    return { descricao: data.descricao ?? '', corFundo: data.cor_fundo, corDestaque: data.cor_destaque }
  } catch {
    return null
  }
}

export async function carregarMinhaMarca(): Promise<MinhaMarca | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id
    if (!uid) return null
    if (emCache?.uid !== uid) emCache = { uid, marca: ler(uid) }
    return emCache.marca
  } catch {
    return null
  }
}

// Grava só os campos passados (upsert por user_id). Devolve a mensagem de erro, ou '' se deu certo.
async function gravar(campos: Record<string, string>): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  const uid = session?.user?.id
  if (!uid) return 'Entre na sua conta para salvar.'
  const { error } = await supabase
    .from('marca_perfil')
    .upsert({ user_id: uid, ...campos, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  emCache = null // a próxima leitura já vê o que foi salvo
  return error ? `Não consegui salvar (${error.message}).` : ''
}

export function salvarDescricaoMarca(descricao: string): Promise<string> {
  return gravar({ descricao: descricao.trim().slice(0, LIMITE_DESCRICAO) })
}

export function salvarCoresMarca(corFundo: string, corDestaque: string): Promise<string> {
  return gravar({ cor_fundo: corFundo, cor_destaque: corDestaque })
}
