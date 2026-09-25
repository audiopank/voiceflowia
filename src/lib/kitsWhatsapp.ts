import { supabase } from './supabase'

// Meus Kits (F1, 25/09): persistência do Kit de Respostas de WhatsApp em tabela
// própria (`kits_whatsapp`, RLS de dono) — de propósito NÃO em `contents`, que é a
// Memória da Marca e conta como "Posts Gerados". Mesmo molde de `templates.ts`.
// O áudio não é guardado: é regerado sob demanda (voz é livre; texto é o que vale).

export interface KitRespostaSalva {
  pergunta: string
  resposta: string
}

export interface KitWhatsappBriefing {
  nicho: string
  fatos: string
  diferenciais: string
  cta: string
  tom: string
  voz: string
  respostas: KitRespostaSalva[]
}

export interface KitWhatsapp extends KitWhatsappBriefing {
  id: string
  created_at: string
  updated_at: string
}

const COLUNAS = 'id, nicho, fatos, diferenciais, cta, tom, voz, respostas, created_at, updated_at'

// Linha do banco → objeto seguro. Campos que faltarem viram fallback, nunca crash
// (JSON gravado hoje será lido por versões futuras do produto).
function normalizar(row: any): KitWhatsapp {
  const texto = (v: unknown) => (typeof v === 'string' ? v : '')
  const respostas: KitRespostaSalva[] = Array.isArray(row?.respostas)
    ? row.respostas
        .filter((r: any) => r && typeof r === 'object')
        .map((r: any) => ({ pergunta: texto(r.pergunta), resposta: texto(r.resposta) }))
    : []
  return {
    id: String(row?.id ?? ''),
    nicho: texto(row?.nicho),
    fatos: texto(row?.fatos),
    diferenciais: texto(row?.diferenciais),
    cta: texto(row?.cta),
    tom: texto(row?.tom),
    voz: texto(row?.voz),
    respostas,
    created_at: texto(row?.created_at),
    updated_at: texto(row?.updated_at),
  }
}

// Insere e devolve o id (o chamador guarda pra atualizar depois). Lança em erro:
// quem chama decide o que dizer na tela — nunca engolir (feature morta calada).
export async function salvarKit(userId: string, kit: KitWhatsappBriefing): Promise<string> {
  const { data, error } = await supabase
    .from('kits_whatsapp')
    .insert({ user_id: userId, ...kit })
    .select('id')
    .single()
  if (error) throw error
  if (!data?.id) throw new Error('o banco não devolveu o id do kit')
  return String(data.id)
}

// `.select('id')` de propósito: UPDATE em 0 linhas não é erro pro PostgREST, e a tela
// diria "Salvo" pra um kit apagado em outra aba. Zero linhas = lança.
export async function atualizarKit(id: string, patch: Partial<KitWhatsappBriefing>): Promise<void> {
  const { data, error } = await supabase.from('kits_whatsapp').update(patch).eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('esse kit não existe mais — foi apagado em outra aba?')
}

export async function listarKits(userId: string): Promise<KitWhatsapp[]> {
  const { data, error } = await supabase
    .from('kits_whatsapp')
    .select(COLUNAS)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(normalizar)
}

// null = não existe OU não é seu (a RLS não distingue, e nem deve).
export async function carregarKit(id: string): Promise<KitWhatsapp | null> {
  const { data, error } = await supabase.from('kits_whatsapp').select(COLUNAS).eq('id', id).maybeSingle()
  if (error) throw error
  return data ? normalizar(data) : null
}

export async function apagarKit(id: string) {
  return supabase.from('kits_whatsapp').delete().eq('id', id)
}

export function textoDoKitSalvo(kit: Pick<KitWhatsapp, 'respostas'>): string {
  return kit.respostas.map((r, i) => `${i + 1}. ${r.pergunta}\n${r.resposta}`).join('\n\n')
}
