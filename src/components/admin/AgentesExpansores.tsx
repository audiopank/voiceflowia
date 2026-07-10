import { useEffect, useState } from 'react'
import { Loader2, Plus, Save, AlertCircle, CheckCircle2, Copy, Gift, Users, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fetchActivePlans, type Plan } from '../../lib/plans'
import {
  fetchAllAgents,
  fetchReferredProfiles,
  fetchAgentProfileStatus,
  grantCourtesyAccess,
  buildReferralLink,
  emptyAgent,
  slugLive,
  slugFinal,
  type ExpanderAgent,
  type ReferredProfile,
  type AgentProfileStatus,
} from '../../lib/referrals'
import { Button } from '../ui/button'
import { Field, inputClass } from './shared'

function formatDate(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('pt-BR')
}

function CourtesyBadge({ status, loading }: { status: AgentProfileStatus | null; loading: boolean }) {
  if (loading) return <span className="text-xs text-gray-500">Verificando...</span>
  if (!status) return <span className="text-xs text-yellow-500">Sem perfil cadastrado ainda</span>

  if (status.courtesy_expires_at) {
    const expires = new Date(status.courtesy_expires_at)
    const expired = expires.getTime() < Date.now()
    return expired ? (
      <span className="text-xs text-red-400">Cortesia expirada em {formatDate(status.courtesy_expires_at)}</span>
    ) : (
      <span className="text-xs text-[#22C55E]">Cortesia ativa até {formatDate(status.courtesy_expires_at)}</span>
    )
  }

  if (status.subscription_plan === 'crescimento' || status.subscription_plan === 'dominacao') {
    return <span className="text-xs text-gray-400">Assinante pago ({status.subscription_plan}) — sem cortesia ativa</span>
  }

  return <span className="text-xs text-gray-500">Sem cortesia concedida</span>
}

function AgentLeads({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [leads, setLeads] = useState<ReferredProfile[]>([])

  async function toggle() {
    if (!open && leads.length === 0) {
      setLoading(true)
      const rows = await fetchReferredProfiles(slug)
      setLeads(rows)
      setLoading(false)
    }
    setOpen((v) => !v)
  }

  return (
    <div className="mt-3">
      <button onClick={toggle} className="text-sm text-[#8B5CF6] hover:text-[#a78bfa] flex items-center gap-1">
        <Users className="w-4 h-4" />
        Ver leads indicados
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && (
        <div className="mt-2 bg-[#0A0A0A] border border-gray-800 rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-4 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-[#8B5CF6]" />
            </div>
          ) : leads.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">Nenhum lead trazido por este agente ainda.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-left border-b border-gray-800">
                  <th className="p-2 font-medium">Email</th>
                  <th className="p-2 font-medium">Plano</th>
                  <th className="p-2 font-medium">Status</th>
                  <th className="p-2 font-medium">Data</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.email} className="border-b border-gray-900 last:border-0">
                    <td className="p-2 text-gray-300">{lead.email}</td>
                    <td className="p-2 text-gray-300">{lead.subscription_plan || '—'}</td>
                    <td className="p-2 text-gray-300">{lead.subscription_status || '—'}</td>
                    <td className="p-2 text-gray-500">{formatDate(lead.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function AgentCard({
  agent,
  index,
  plans,
  onChange,
}: {
  agent: ExpanderAgent
  index: number
  plans: Plan[]
  onChange: (index: number, patch: Partial<ExpanderAgent>) => void
}) {
  const [status, setStatus] = useState<AgentProfileStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [granting, setGranting] = useState(false)
  const [grantError, setGrantError] = useState('')
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)

  async function refreshStatus() {
    if (!agent.contact_email.trim()) return
    setStatusLoading(true)
    const s = await fetchAgentProfileStatus(agent.contact_email.trim())
    setStatus(s)
    setStatusLoading(false)
  }

  useEffect(() => {
    if (agent.id) refreshStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id])

  async function handleGrant() {
    setGrantError('')
    setGranting(true)
    const { error } = await grantCourtesyAccess(agent.contact_email.trim(), agent.slug.trim())
    setGranting(false)
    if (error) {
      setGrantError(error.message)
      return
    }
    await refreshStatus()
  }

  async function copyLink(planSlug: string, url: string) {
    await navigator.clipboard.writeText(url)
    setCopiedSlug(planSlug)
    setTimeout(() => setCopiedSlug((s) => (s === planSlug ? null : s)), 1500)
  }

  return (
    <div className="bg-[#111111] border border-gray-800 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-white">{agent.display_name || 'Agente sem nome'}</h3>
        <label className="flex items-center gap-2 text-gray-300 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={agent.active}
            onChange={(e) => onChange(index, { active: e.target.checked })}
            className="w-4 h-4 accent-[#22C55E]"
          />
          Ativo
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Nome de exibição" hint='Ex: "PC (Otobel)" — nome ainda fictício, ok trocar depois'>
          <input
            value={agent.display_name}
            onChange={(e) => onChange(index, { display_name: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Identificador (slug)" hint="Único, minúsculo, sem espaços. Gerado automaticamente. Ex: pc-otobel">
          <input
            value={agent.slug}
            onChange={(e) => onChange(index, { slug: slugLive(e.target.value) })}
            className={inputClass}
            placeholder="ex: pc-otobel"
          />
        </Field>
        <Field label="Email de contato" hint="O email de login do agente no VoiceFlow (recebe a cortesia)">
          <input
            value={agent.contact_email}
            onChange={(e) => onChange(index, { contact_email: e.target.value })}
            className={inputClass}
            placeholder="email@exemplo.com"
          />
        </Field>
        <Field label="Dias de cortesia">
          <input
            type="number"
            value={agent.courtesy_days}
            onChange={(e) => onChange(index, { courtesy_days: Number(e.target.value) || 0 })}
            className={inputClass}
          />
        </Field>
      </div>

      {agent.id && (
        <div className="bg-[#0A0A0A] border border-gray-800 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Gift className="w-4 h-4 text-[#8B5CF6]" />
              <CourtesyBadge status={status} loading={statusLoading} />
            </div>
            <Button
              onClick={handleGrant}
              disabled={granting || !agent.contact_email.trim()}
              className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-sm py-2 px-3 flex items-center gap-2"
            >
              {granting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
              Conceder acesso cortesia
            </Button>
          </div>
          {grantError && <p className="text-xs text-red-400">{grantError}</p>}

          <div className="space-y-2">
            <span className="text-sm font-medium text-gray-300">Links de indicação (com desconto)</span>
            {plans.length === 0 && <p className="text-xs text-gray-600">Nenhum plano ativo cadastrado ainda.</p>}
            {plans.map((plan) => {
              const url = plan.referral_kiwify_url?.trim()
              return (
                <div key={plan.slug} className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-28 shrink-0">{plan.name}</span>
                  {url ? (
                    <>
                      <input readOnly value={buildReferralLink(url, agent.slug)} className={inputClass + ' text-xs'} />
                      <button
                        onClick={() => copyLink(plan.slug, buildReferralLink(url, agent.slug))}
                        className="text-gray-400 hover:text-white shrink-0"
                        title="Copiar link"
                      >
                        {copiedSlug === plan.slug ? (
                          <span className="text-xs text-[#22C55E]">Copiado!</span>
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-yellow-500">
                      Este plano não tem "Link com desconto (indicação)" configurado — cole na aba Planos.
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          <AgentLeads slug={agent.slug} />
        </div>
      )}
      {!agent.id && (
        <p className="text-xs text-gray-600">Salve o agente para liberar cortesia e links de indicação.</p>
      )}
    </div>
  )
}

export function AgentesExpansores() {
  const [agents, setAgents] = useState<ExpanderAgent[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function load() {
    setLoading(true)
    const [agentRows, planRows] = await Promise.all([fetchAllAgents(), fetchActivePlans()])
    setAgents(agentRows)
    setPlans(planRows)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function updateAgent(index: number, patch: Partial<ExpanderAgent>) {
    setAgents((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)))
  }

  function addAgent() {
    setAgents((prev) => [...prev, emptyAgent()])
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSuccess('')

    const slugs = agents.map((a) => slugFinal(a.slug))
    if (slugs.some((s) => !s)) {
      setError('Todo agente precisa de um identificador (slug) válido — use letras, números e hífen.')
      setSaving(false)
      return
    }
    if (new Set(slugs).size !== slugs.length) {
      setError('Existem identificadores (slug) repetidos. Cada agente precisa de um slug único.')
      setSaving(false)
      return
    }
    if (agents.some((a) => !a.contact_email.trim())) {
      setError('Todo agente precisa de um email de contato.')
      setSaving(false)
      return
    }

    const payload = agents.map((a) => ({
      // Sempre inclui um id (ver mesmo comentario em admin.tsx handleSave):
      // upsert em lote heterogeneo manda NULL pros que faltam, nao o DEFAULT.
      id: a.id || crypto.randomUUID(),
      slug: slugFinal(a.slug),
      display_name: a.display_name.trim(),
      contact_email: a.contact_email.trim(),
      courtesy_plan: a.courtesy_plan,
      courtesy_days: a.courtesy_days,
      active: a.active,
    }))

    const { error: upsertError } = await supabase.from('expander_agents').upsert(payload, { onConflict: 'slug' })

    if (upsertError) {
      setError(`Erro ao salvar: ${upsertError.message}`)
      setSaving(false)
      return
    }

    await load()
    setSuccess('Agentes salvos com sucesso.')
    setSaving(false)
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button onClick={addAgent} className="bg-[#1A1A1A] hover:bg-[#252525] flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Adicionar Agente
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
      ) : agents.length === 0 ? (
        <div className="text-center py-12 bg-[#111111] border border-gray-800 rounded-2xl">
          <p className="text-gray-400 mb-4">
            Nenhum Agente Expansor cadastrado. Rode o script{' '}
            <code className="text-[#8B5CF6]">MIGRATION_REFERRALS.sql</code> no Supabase, se ainda não rodou, e
            adicione o primeiro agente.
          </p>
          <Button onClick={addAgent} className="bg-[#8B5CF6] hover:bg-[#7C3AED]">
            Adicionar Primeiro Agente
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {agents.map((agent, index) => (
            <AgentCard key={agent.id || `new-${index}`} agent={agent} index={index} plans={plans} onChange={updateAgent} />
          ))}
        </div>
      )}

      {!loading && agents.length > 0 && (
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
                Salvar Agentes
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
