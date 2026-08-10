import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Loader2, AlertCircle, Bookmark, Copy, Check, Trash2, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { listarTemplates, apagarTemplate, type Template } from '../lib/templates'
import { BackButton } from '../components/BackButton'
import { Button } from '../components/ui/button'

export const Route = createFileRoute('/meus-templates')({
  component: MeusTemplates,
})

function TemplateCard({ template, onApagado }: { template: Template; onApagado: (id: string) => void }) {
  const [copiado, setCopiado] = useState(false)
  const [apagando, setApagando] = useState(false)

  async function copiar() {
    const texto = template.conteudo.hook
      ? `${template.conteudo.hook}\n\n${template.conteudo.cta}`
      : template.conteudo.cta
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Clipboard bloqueado — sem feedback falso de "copiado".
    }
  }

  async function apagar() {
    setApagando(true)
    const { error } = await apagarTemplate(template.id)
    if (!error) onApagado(template.id)
    else setApagando(false)
  }

  return (
    <div className="bg-[#111111] border border-gray-800 rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-white font-bold">{template.nome}</h3>
        <span className="text-xs px-2 py-0.5 rounded-full bg-[#1A1A1A] border border-gray-700 text-gray-400 shrink-0">
          {template.tipo === 'hook_cta' ? 'Hook + CTA' : 'CTA'}
        </span>
      </div>

      {template.conteudo.hook && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Hook</p>
          <p className="text-gray-300 text-sm">{template.conteudo.hook}</p>
        </div>
      )}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">CTA</p>
        <p className="text-gray-300 text-sm">{template.conteudo.cta}</p>
      </div>

      <div className="flex gap-2">
        <Button
          onClick={copiar}
          className="flex-1 bg-[#1A1A1A] hover:bg-[#252525] flex items-center justify-center gap-2 text-sm"
        >
          {copiado ? (
            <>
              <Check className="w-4 h-4 text-[#22C55E]" />
              Copiado!
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              Copiar
            </>
          )}
        </Button>
        <Button
          onClick={apagar}
          disabled={apagando}
          className="bg-[#1A1A1A] hover:bg-red-900/30 disabled:opacity-50 flex items-center justify-center gap-2 px-3"
          title="Apagar template"
        >
          {apagando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 text-red-400" />}
        </Button>
      </div>
    </div>
  )
}

function MeusTemplates() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState<Template[]>([])
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

      try {
        const data = await listarTemplates(user.id)
        if (!cancelado) setTemplates(data)
      } catch {
        if (!cancelado) setErro(true)
      }
      if (!cancelado) setLoading(false)
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

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-2">
            <Bookmark className="w-8 h-8 text-[#8B5CF6]" />
            Meus Templates
          </h1>
          <p className="text-gray-400">
            CTAs e ganchos que já converteram, salvos pra reusar em 1 clique na próxima geração.
          </p>
        </div>

        {erro ? (
          <div className="p-4 bg-red-900/30 border border-red-700 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <span className="text-red-300">
              Não consegui carregar seus templates agora. Tente recarregar a página.
            </span>
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-16 bg-[#111111] border border-gray-800 rounded-2xl">
            <Sparkles className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Nenhum template salvo ainda</h2>
            <p className="text-gray-400">
              Gere um CTA no Agente, Super Agente ou Card Mágico e clique no ícone de salvar pra
              guardar aqui os que mais converterem.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                onApagado={(id) => setTemplates((prev) => prev.filter((x) => x.id !== id))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
