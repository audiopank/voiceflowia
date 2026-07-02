import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Lock, Loader2, Plus, Trash2, Save, X, AlertCircle, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAllPlans, ADMIN_EMAIL, type Plan } from '../lib/plans'
import { Button } from '../components/ui/button'
import { BackButton } from '../components/BackButton'

export const Route = createFileRoute('/admin')({
  component: Admin,
})

function emptyPlan(order: number): Plan {
  return {
    slug: '',
    name: 'Novo Plano',
    price: 'R$ 0',
    period: '/mês',
    features: [],
    cta_label: 'Assinar',
    kiwify_url: '',
    badge: null,
    highlight: false,
    sort_order: order,
    active: true,
  }
}

function Admin() {
  const navigate = useNavigate()
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        navigate({ to: '/login' })
        return
      }
      const admin = user.email === ADMIN_EMAIL
      setIsAdmin(admin)
      setCheckingAuth(false)
      if (admin) {
        const rows = await fetchAllPlans()
        setPlans(rows)
        setLoading(false)
      }
    }
    init()
  }, [navigate])

  function updatePlan(index: number, patch: Partial<Plan>) {
    setPlans((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  function updateFeature(planIndex: number, featIndex: number, patch: Partial<Plan['features'][number]>) {
    setPlans((prev) =>
      prev.map((p, i) =>
        i === planIndex
          ? { ...p, features: p.features.map((f, j) => (j === featIndex ? { ...f, ...patch } : f)) }
          : p
      )
    )
  }

  function addFeature(planIndex: number) {
    setPlans((prev) =>
      prev.map((p, i) =>
        i === planIndex ? { ...p, features: [...p.features, { text: '', included: true }] } : p
      )
    )
  }

  function removeFeature(planIndex: number, featIndex: number) {
    setPlans((prev) =>
      prev.map((p, i) =>
        i === planIndex ? { ...p, features: p.features.filter((_, j) => j !== featIndex) } : p
      )
    )
  }

  function addPlan() {
    setPlans((prev) => [...prev, emptyPlan(prev.length + 1)])
  }

  async function removePlan(index: number) {
    const plan = plans[index]
    if (!confirm(`Remover o plano "${plan.name}"? Esta ação não pode ser desfeita.`)) return

    if (plan.id) {
      const { error: delError } = await supabase.from('plans').delete().eq('id', plan.id)
      if (delError) {
        setError(`Erro ao remover: ${delError.message}`)
        return
      }
    }
    setPlans((prev) => prev.filter((_, i) => i !== index))
    setSuccess('Plano removido.')
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSuccess('')

    // Validação: slug único e não vazio
    const slugs = plans.map((p) => p.slug.trim())
    if (slugs.some((s) => !s)) {
      setError('Todo plano precisa de um identificador (slug).')
      setSaving(false)
      return
    }
    if (new Set(slugs).size !== slugs.length) {
      setError('Existem identificadores (slug) repetidos. Cada plano precisa de um slug único.')
      setSaving(false)
      return
    }

    const payload = plans.map((p) => ({
      ...(p.id ? { id: p.id } : {}),
      slug: p.slug.trim(),
      name: p.name,
      price: p.price,
      period: p.period,
      features: p.features,
      cta_label: p.cta_label,
      kiwify_url: p.kiwify_url?.trim() || null,
      badge: p.badge?.trim() || null,
      highlight: p.highlight,
      sort_order: p.sort_order,
      active: p.active,
    }))

    const { error: upsertError } = await supabase
      .from('plans')
      .upsert(payload, { onConflict: 'slug' })

    if (upsertError) {
      setError(`Erro ao salvar: ${upsertError.message}`)
      setSaving(false)
      return
    }

    // Recarrega para obter ids gerados
    const rows = await fetchAllPlans()
    setPlans(rows)
    setSuccess('Planos salvos com sucesso! A página de Preços já reflete as mudanças.')
    setSaving(false)
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A]">
        <Loader2 className="w-8 h-8 animate-spin text-[#8B5CF6]" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] relative">
        <BackButton to="/dashboard" label="Voltar ao Painel" className="absolute top-6 left-6" />
        <div className="text-center p-8 bg-[#111111] border border-gray-800 rounded-2xl max-w-md">
          <Lock className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Acesso Restrito</h2>
          <p className="text-gray-400">
            Esta área é exclusiva do administrador. Você não tem permissão para acessá-la.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] p-6">
      <div className="max-w-4xl mx-auto">
        <BackButton to="/dashboard" label="Voltar ao Painel" className="mb-6" />

        <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-white mb-1">Painel Admin — Planos</h1>
            <p className="text-gray-400">Edite preços, features e cole os links da Kiwify. Sem precisar de deploy.</p>
          </div>
          <Button onClick={addPlan} className="bg-[#1A1A1A] hover:bg-[#252525] flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Adicionar Plano
          </Button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <span className="text-red-300">{error}</span>
          </div>
        )}
        {success && (
          <div className="mb-6 p-4 bg-green-900/30 border border-green-700 rounded-xl flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
            <span className="text-green-300">{success}</span>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-[#8B5CF6]" />
          </div>
        ) : plans.length === 0 ? (
          <div className="text-center py-12 bg-[#111111] border border-gray-800 rounded-2xl">
            <p className="text-gray-400 mb-4">
              Nenhum plano encontrado. Rode o script <code className="text-[#8B5CF6]">CREATE_PLANS_TABLE.sql</code> no
              Supabase ou adicione um plano manualmente.
            </p>
            <Button onClick={addPlan} className="bg-[#8B5CF6] hover:bg-[#7C3AED]">
              Adicionar Primeiro Plano
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {plans.map((plan, index) => (
              <div key={plan.id || `new-${index}`} className="bg-[#111111] border border-gray-800 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-white">{plan.name || 'Plano sem nome'}</h3>
                  <button
                    onClick={() => removePlan(index)}
                    className="text-red-400 hover:text-red-300 flex items-center gap-1 text-sm"
                  >
                    <Trash2 className="w-4 h-4" />
                    Remover
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Nome do Plano">
                    <input
                      value={plan.name}
                      onChange={(e) => updatePlan(index, { name: e.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Identificador (slug)" hint="Único, sem espaços. Ex: crescimento">
                    <input
                      value={plan.slug}
                      onChange={(e) => updatePlan(index, { slug: e.target.value })}
                      className={inputClass}
                      placeholder="ex: crescimento"
                    />
                  </Field>
                  <Field label="Preço">
                    <input
                      value={plan.price}
                      onChange={(e) => updatePlan(index, { price: e.target.value })}
                      className={inputClass}
                      placeholder="R$ 297"
                    />
                  </Field>
                  <Field label="Período">
                    <input
                      value={plan.period}
                      onChange={(e) => updatePlan(index, { period: e.target.value })}
                      className={inputClass}
                      placeholder="/mês"
                    />
                  </Field>
                  <Field label="Texto do Botão">
                    <input
                      value={plan.cta_label}
                      onChange={(e) => updatePlan(index, { cta_label: e.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Selo (badge)" hint="Deixe vazio para nenhum. Ex: MAIS VENDIDO">
                    <input
                      value={plan.badge || ''}
                      onChange={(e) => updatePlan(index, { badge: e.target.value })}
                      className={inputClass}
                      placeholder="(nenhum)"
                    />
                  </Field>
                  <div className="md:col-span-2">
                    <Field label="Link da Kiwify" hint="Cole aqui o link de checkout gerado na Kiwify">
                      <input
                        value={plan.kiwify_url || ''}
                        onChange={(e) => updatePlan(index, { kiwify_url: e.target.value })}
                        className={inputClass}
                        placeholder="https://pay.kiwify.com.br/..."
                      />
                    </Field>
                  </div>
                  <Field label="Ordem de exibição">
                    <input
                      type="number"
                      value={plan.sort_order}
                      onChange={(e) => updatePlan(index, { sort_order: Number(e.target.value) || 0 })}
                      className={inputClass}
                    />
                  </Field>
                  <div className="flex items-end gap-6 pb-1">
                    <label className="flex items-center gap-2 text-gray-300 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={plan.highlight}
                        onChange={(e) => updatePlan(index, { highlight: e.target.checked })}
                        className="w-4 h-4 accent-[#8B5CF6]"
                      />
                      Destaque
                    </label>
                    <label className="flex items-center gap-2 text-gray-300 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={plan.active}
                        onChange={(e) => updatePlan(index, { active: e.target.checked })}
                        className="w-4 h-4 accent-[#22C55E]"
                      />
                      Ativo (visível na página)
                    </label>
                  </div>
                </div>

                {/* Features */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-300">Itens do Plano</span>
                    <button
                      onClick={() => addFeature(index)}
                      className="text-[#8B5CF6] hover:text-[#a78bfa] flex items-center gap-1 text-sm"
                    >
                      <Plus className="w-4 h-4" />
                      Adicionar item
                    </button>
                  </div>
                  <div className="space-y-2">
                    {plan.features.map((feat, fi) => (
                      <div key={fi} className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer shrink-0" title="Incluído no plano?">
                          <input
                            type="checkbox"
                            checked={feat.included}
                            onChange={(e) => updateFeature(index, fi, { included: e.target.checked })}
                            className="w-4 h-4 accent-[#22C55E]"
                          />
                          {feat.included ? 'Sim' : 'Não'}
                        </label>
                        <input
                          value={feat.text}
                          onChange={(e) => updateFeature(index, fi, { text: e.target.value })}
                          className={inputClass}
                          placeholder="Ex: 30 Projetos de Voz / mês"
                        />
                        <button
                          onClick={() => removeFeature(index, fi)}
                          className="text-gray-500 hover:text-red-400 shrink-0"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    {plan.features.length === 0 && (
                      <p className="text-gray-600 text-sm">Nenhum item. Clique em "Adicionar item".</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && plans.length > 0 && (
          <div className="sticky bottom-6 mt-8">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-[#22C55E] hover:bg-[#16A34A] disabled:opacity-50 text-lg py-6 font-bold flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  Salvar Alterações
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

const inputClass =
  'w-full p-2.5 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-[#8B5CF6] text-sm'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-600 mt-1">{hint}</p>}
    </div>
  )
}
