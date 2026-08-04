import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Loader2, AlertCircle, Brain, History, ChevronDown, ChevronUp, Copy, Check, Sparkles, ArrowRight,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { BackButton } from '../components/BackButton'
import { Button } from '../components/ui/button'

export const Route = createFileRoute('/meus-conteudos')({
  component: MeusConteudos,
})

// O que a IA devolve num post (mesmo shape do Agente e do Super Agente). Campos
// opcionais de propósito: isto renderiza JSON gravado ao longo de meses de
// versões diferentes do produto — o que faltar vira fallback, nunca crash.
interface PostSalvo {
  dia?: number
  periodo?: string
  horario?: string
  hook?: string
  roteiro?: string
  legenda?: string
  vozSugerida?: string
}

interface KitSalvo {
  id: string
  nicho: string
  posts: PostSalvo[]
  created_at: string
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function textoDoPost(post: PostSalvo): string {
  const partes: string[] = []
  if (post.hook) partes.push(`HOOK:\n${post.hook}`)
  if (post.roteiro) partes.push(`ROTEIRO:\n${post.roteiro}`)
  if (post.legenda) partes.push(`LEGENDA:\n${post.legenda}`)
  return partes.join('\n\n')
}

function KitCard({ kit }: { kit: KitSalvo }) {
  const [open, setOpen] = useState(false)
  // Chaveado pelo índice do post na lista, NUNCA por post.dia: a IA às vezes
  // repete/pula o número do dia, e dois posts passariam a dividir o mesmo botão.
  const [copiado, setCopiado] = useState<number | null>(null)

  async function copiar(post: PostSalvo, index: number) {
    try {
      await navigator.clipboard.writeText(textoDoPost(post))
      setCopiado(index)
      setTimeout(() => setCopiado((atual) => (atual === index ? null : atual)), 2000)
    } catch {
      // Clipboard bloqueado (permissão/contexto): sem feedback falso de "copiado".
    }
  }

  return (
    <div className="bg-[#111111] border border-gray-800 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full p-5 flex items-center justify-between gap-4 text-left hover:bg-[#161616] transition-colors"
      >
        <div>
          <h3 className="text-white font-bold text-lg">{kit.nicho || 'Sem nicho'}</h3>
          <p className="text-gray-500 text-sm mt-0.5">
            {formatDate(kit.created_at)} · {kit.posts.length} {kit.posts.length === 1 ? 'post' : 'posts'}
          </p>
        </div>
        {open ? (
          <ChevronUp className="w-5 h-5 text-gray-500 shrink-0" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-500 shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t border-gray-800 p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {kit.posts.map((post, index) => (
            <div key={index} className="bg-[#0F0F0F] border border-gray-800 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#8B5CF6] font-bold text-sm">
                  {post.dia != null ? `Dia ${post.dia}` : `Post ${index + 1}`}
                  {post.periodo ? ` · ${post.periodo}` : ''}
                  {post.horario ? ` · ${post.horario}` : ''}
                </span>
                {post.vozSugerida && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[#1A1A1A] border border-gray-700 text-gray-400 shrink-0">
                    Voz: {post.vozSugerida}
                  </span>
                )}
              </div>
              {post.hook && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Hook</p>
                  <p className="text-white text-sm font-medium">{post.hook}</p>
                </div>
              )}
              {post.roteiro && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Roteiro</p>
                  <p className="text-gray-300 text-sm whitespace-pre-wrap">{post.roteiro}</p>
                </div>
              )}
              {post.legenda && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Legenda</p>
                  <p className="text-gray-300 text-sm whitespace-pre-wrap">{post.legenda}</p>
                </div>
              )}
              <Button
                onClick={() => copiar(post, index)}
                className="w-full bg-[#1A1A1A] hover:bg-[#252525] flex items-center justify-center gap-2 text-sm"
              >
                {copiado === index ? (
                  <>
                    <Check className="w-4 h-4 text-[#22C55E]" />
                    Copiado!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copiar post
                  </>
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MeusConteudos() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [kits, setKits] = useState<KitSalvo[]>([])
  // Erro ≠ vazio: "você ainda não gerou nada" só pode aparecer quando a consulta
  // respondeu de verdade — num hiccup de rede seria uma afirmação falsa.
  const [erro, setErro] = useState(false)

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelado) return
      if (!user) {
        navigate({ to: '/login' })
        return
      }

      // RLS de `contents` garante que só vêm as linhas do próprio usuário.
      const { data, error } = await supabase
        .from('contents')
        .select('id, nicho, posts_json, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (cancelado) return
      if (error || !Array.isArray(data)) {
        setErro(true)
      } else {
        setKits(
          data.map((row: any) => ({
            id: String(row.id),
            nicho: typeof row.nicho === 'string' ? row.nicho : '',
            posts: Array.isArray(row.posts_json) ? row.posts_json : [],
            created_at: typeof row.created_at === 'string' ? row.created_at : '',
          })),
        )
      }
      setLoading(false)
    })()
    return () => {
      cancelado = true
    }
  }, [navigate])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A]">
        <Loader2 className="w-8 h-8 animate-spin text-[#8B5CF6]" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] p-6">
      <div className="max-w-5xl mx-auto">
        <BackButton to="/dashboard" label="Voltar ao Painel" className="mb-6" />

        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-2">
            <History className="w-8 h-8 text-[#8B5CF6]" />
            Meus Conteúdos
          </h1>
          <p className="text-gray-400">
            Tudo que você já gerou fica guardado aqui — reabra, copie e reaproveite quando quiser.
          </p>
        </div>

        {/* A Memória da Marca é o diferencial: este mesmo histórico é o que a IA relê
            antes de cada geração pra nunca repetir um ângulo já entregue. Por isso a
            página é só leitura — apagar histórico aqui seria apagar a memória. */}
        <div className="mb-8 p-4 bg-[#8B5CF6]/10 border border-[#8B5CF6]/40 rounded-xl flex items-start gap-3">
          <Brain className="w-5 h-5 text-[#8B5CF6] shrink-0 mt-0.5" />
          <p className="text-sm text-gray-300">
            <b className="text-white">Memória da Marca ativa:</b> a IA relê este histórico antes de
            cada nova geração pra nunca repetir um ângulo que você já usou. Quanto mais você gera,
            mais única fica a voz da sua marca.
          </p>
        </div>

        {erro ? (
          <div className="p-4 bg-red-900/30 border border-red-700 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <span className="text-red-300">
              Não consegui carregar seus conteúdos agora. Tente recarregar a página.
            </span>
          </div>
        ) : kits.length === 0 ? (
          <div className="text-center py-16 bg-[#111111] border border-gray-800 rounded-2xl">
            <Sparkles className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Você ainda não gerou nenhum conteúdo</h2>
            <p className="text-gray-400 mb-6">
              Seu primeiro kit sai em ~2 minutos — e a partir dele a IA começa a construir a
              memória da sua marca.
            </p>
            <Button
              onClick={() => navigate({ to: '/super-agente' })}
              className="bg-[#8B5CF6] hover:bg-[#7C3AED] font-bold flex items-center gap-2 mx-auto"
            >
              Criar meu primeiro kit
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {kits.map((kit) => (
              <KitCard key={kit.id} kit={kit} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
