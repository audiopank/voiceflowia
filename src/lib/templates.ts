import { supabase } from './supabase'

export interface Template {
  id: string
  nome: string
  tipo: 'cta' | 'hook_cta'
  conteudo: { hook?: string; cta: string }
  created_at: string
}

export async function salvarTemplate(
  userId: string,
  nome: string,
  tipo: Template['tipo'],
  conteudo: Template['conteudo']
) {
  return supabase.from('templates').insert({ user_id: userId, nome, tipo, conteudo })
}

export async function listarTemplates(userId: string): Promise<Template[]> {
  const { data, error } = await supabase
    .from('templates')
    .select('id, nome, tipo, conteudo, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data ?? []) as Template[]
}

export async function apagarTemplate(id: string) {
  return supabase.from('templates').delete().eq('id', id)
}
