import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import {
  Lock, Loader2, Radar as RadarIcon, AlertTriangle, TrendingUp, Save,
  CheckCircle2, AlertCircle, ExternalLink, RefreshCw, Bell,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSubscription } from '../lib/useSubscription'
import { Button } from '../components/ui/button'
import { BackButton } from '../components/BackButton'

export const Route = createFileRoute('/radar')({
  component: Radar,
})

const inputClass =
  'w-full p-2.5 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-[#8B5CF6] text-sm'

const SENT_COLORS: Record<string, string> = {
  positivo: '#22C55E',
  neutro: '#9CA3AF',
  negativo: '#F59E0B',
  crise: '#EF4444',
}

interface RadarConfig {
  id?: string
  marca_nome: string
  marca_instagram: string
  nicho: string
  concorrentes: string[]
  palavras_chave_alerta: string[]
  alert_email: string
}

interface Mencao {
  fonte: string
  texto: string
  url: string
  classificacao: string
  motivo: string
}

interface Relatorio {
  id: string
  created_at: string
  resumo: string
  sentimento: Record<string, number>
  mencoes: Mencao[]
  tendencias: string[]
  palavras: Record<string, number>
}

interface Alerta {
  id: string
  created_at: string
  mencao_texto: string
  fonte: string
  url: string
  classificacao: string
  motivo: string
}

const DEFAULT_KEYWORDS = ['golpe', 'não recomendo', 'processo', 'lixo', 'péssimo', 'horrível']

function emptyConfig(email: string): RadarConfig {
  return {
    marca_nome: '',
    marca_instagram: '',
    nicho: '',
    concorrentes: ['', '', '', '', ''],
    palavras_chave_alerta: DEFAULT_KEYWORDS,
    alert_email: email,
  }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-600 mt-1">{hint}</p>}
    </div>
  )
}

function Radar() {
  const { hasRadar, loading: subLoading, radar } = useSubscription()

  const [userId, setUserId] = useState<string | null>(null)
  const [config, setConfig] = useState<RadarConfig | null>(null)
  const [savingConfig, setSavingConfig] = useState(false)
  const [configMsg, setConfigMsg] = useState('')
  const [configErr, setConfigErr] = useState('')

  const [relatorio, setRelatorio] = useState<Relatorio | null>(null)
  const [gerando, setGerando] = useState(false)
  const [reportErr, setReportErr] = useState('')

  const [alertas, setAlertas] = useState<Alerta[]>([])

  // Carrega config, último relatório e alertas dos últimos 7 dias.
  useEffect(() => {
    if (!hasRadar) return
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      const { data: cfg } = await supabase.from('radar_config').select('*').eq('user_id', user.id).maybeSingle()
      if (cfg) {
        const conc = Array.isArray(cfg.concorrentes) ? cfg.concorrentes : []
        setConfig({
          id: cfg.id,
          marca_nome: cfg.marca_nome ?? '',
          marca_instagram: cfg.marca_instagram ?? '',
          nicho: cfg.nicho ?? '',
          concorrentes: [...conc, '', '', '', '', ''].slice(0, 5),
          palavras_chave_alerta: Array.isArray(cfg.palavras_chave_alerta) ? cfg.palavras_chave_alerta : DEFAULT_KEYWORDS,
          alert_email: cfg.alert_email ?? user.email ?? '',
        })
      } else {
        setConfig(emptyConfig(user.email ?? ''))
      }

      const { data: rel } = await supabase
        .from('radar_relatorios').select('*').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (rel) setRelatorio(rel as Relatorio)

      const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const { data: alr } = await supabase
        .from('radar_alertas').select('*').eq('user_id', user.id)
        .gte('created_at', seteDiasAtras).order('created_at', { ascending: false })
      if (alr) setAlertas(alr as Alerta[])
    })()
  }, [hasRadar])

  async function saveConfig() {
    if (!config || !userId) return
    setConfigErr('')
    setConfigMsg('')
    if (!config.marca_nome.trim()) {
      setConfigErr('Preencha o nome da marca.')
      return
    }
    setSavingConfig(true)
    const payload = {
      user_id: userId,
      marca_nome: config.marca_nome.trim(),
      marca_instagram: config.marca_instagram.trim() || null,
      nicho: config.nicho.trim() || null,
      concorrentes: config.concorrentes.map((c) => c.trim()).filter(Boolean),
      palavras_chave_alerta: config.palavras_chave_alerta.map((k) => k.trim()).filter(Boolean),
      alert_email: config.alert_email.trim() || null,
    }
    const { error } = await supabase.from('radar_config').upsert(payload, { onConflict: 'user_id' })
    setSavingConfig(false)
    if (error) {
      setConfigErr(`Erro ao salvar: ${error.message}`)
      return
    }
    setConfigMsg('Monitoramento salvo!')
    setTimeout(() => setConfigMsg(''), 2000)
  }

  async function gerarRelatorio() {
    setReportErr('')
    setGerando(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/radar/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || `Erro na API: ${res.status}`)
      setRelatorio(data as Relatorio)
      // Recarrega alertas (o relatório pode ter gerado novos).
      if (userId) {
        const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        const { data: alr } = await supabase
          .from('radar_alertas').select('*').eq('user_id', userId)
          .gte('created_at', seteDiasAtras).order('created_at', { ascending: false })
        if (alr) setAlertas(alr as Alerta[])
      }
    } catch (e) {
      setReportErr(e instanceof Error ? e.message : 'Erro ao gerar relatório')
    } finally {
      setGerando(false)
    }
  }

  if (subLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A]">
        <Loader2 className="w-8 h-8 animate-spin text-[#8B5CF6]" />
      </div>
    )
  }

  if (!hasRadar) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] relative">
        <BackButton to="/dashboard" label="Voltar ao Painel" className="absolute top-6 left-6" />
        <div className="text-center p-8 bg-[#111111] border border-gray-800 rounded-2xl max-w-md">
          <Lock className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Acesso Restrito</h2>
          <p className="text-gray-400 mb-6">
            O <span className="text-[#8B5CF6] font-bold">VoiceFlow Radar</span> está disponível no plano{' '}
            <span className="text-[#22C55E] font-bold">RADAR PRO</span>.
          </p>
          <Button className="bg-[#8B5CF6] hover:bg-[#7C3AED]" onClick={() => (window.location.href = '/precos')}>
            Ver Planos
          </Button>
        </div>
      </div>
    )
  }

  const sentData = relatorio
    ? Object.entries(relatorio.sentimento)
        .filter(([, v]) => Number(v) > 0)
        .map(([k, v]) => ({ name: k.charAt(0).toUpperCase() + k.slice(1), key: k, value: Number(v) }))
    : []

  const palavrasOrdenadas = relatorio
    ? Object.entries(relatorio.palavras).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 30)
    : []
  const maxFreq = palavrasOrdenadas.length ? Number(palavrasOrdenadas[0][1]) : 1

  return (
    <div className="min-h-screen bg-[#0A0A0A] p-6">
      <div className="max-w-5xl mx-auto">
        <BackButton to="/dashboard" label="Voltar ao Painel" className="mb-6" />

        <div className="flex items-center gap-3 mb-2">
          <RadarIcon className="w-8 h-8 text-[#8B5CF6]" />
          <h1 className="text-3xl font-bold text-white">VoiceFlow Radar</h1>
        </div>
        <p className="text-gray-400 mb-8">
          Monitore a reputação da sua marca na web, receba alertas de crise e descubra tendências do seu nicho.
          {radar.expiresAt && (
            <span className="block text-xs text-gray-600 mt-1">
              Acesso ativo até {radar.expiresAt.toLocaleDateString('pt-BR')} · {radar.daysLeft} dias restantes
            </span>
          )}
        </p>

        <div className="space-y-6">
          {/* Card 1: Monitor de Marca */}
          <div className="bg-[#111111] border border-gray-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <RadarIcon className="w-5 h-5 text-[#8B5CF6]" />
              <h2 className="text-xl font-bold text-white">Monitor de Marca</h2>
            </div>

            {configErr && (
              <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span className="text-red-300 text-sm">{configErr}</span>
              </div>
            )}
            {configMsg && (
              <div className="p-3 bg-green-900/30 border border-green-700 rounded-lg flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                <span className="text-green-300 text-sm">{configMsg}</span>
              </div>
            )}

            {config && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Nome da marca">
                    <input value={config.marca_nome} onChange={(e) => setConfig({ ...config, marca_nome: e.target.value })} className={inputClass} placeholder="Ex: Otobel Aparelhos Auditivos" />
                  </Field>
                  <Field label="Nicho" hint="Usado pra classificar as menções e sugerir tendências">
                    <input value={config.nicho} onChange={(e) => setConfig({ ...config, nicho: e.target.value })} className={inputClass} placeholder="Ex: aparelhos auditivos" />
                  </Field>
                  <Field label="@ Instagram da marca" hint="Guardado pra Fase 2 (monitoramento direto do Instagram)">
                    <input value={config.marca_instagram} onChange={(e) => setConfig({ ...config, marca_instagram: e.target.value })} className={inputClass} placeholder="@suamarca" />
                  </Field>
                  <Field label="Email pra alerta de crise" hint="Onde chega o alerta quando detectamos menção negativa">
                    <input value={config.alert_email} onChange={(e) => setConfig({ ...config, alert_email: e.target.value })} className={inputClass} placeholder="voce@email.com" />
                  </Field>
                </div>

                <Field label="Concorrentes (até 5)" hint="@ ou nome — monitorados junto da sua marca">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {config.concorrentes.map((c, i) => (
                      <input
                        key={i}
                        value={c}
                        onChange={(e) => {
                          const next = [...config.concorrentes]
                          next[i] = e.target.value
                          setConfig({ ...config, concorrentes: next })
                        }}
                        className={inputClass}
                        placeholder={`Concorrente ${i + 1}`}
                      />
                    ))}
                  </div>
                </Field>

                <Field label="Palavras-chave de alerta" hint="Separadas por vírgula. Menção com uma dessas dispara alerta de crise.">
                  <input
                    value={config.palavras_chave_alerta.join(', ')}
                    onChange={(e) => setConfig({ ...config, palavras_chave_alerta: e.target.value.split(',').map((s) => s.trim()) })}
                    className={inputClass}
                  />
                </Field>

                <Button onClick={saveConfig} disabled={savingConfig} className="bg-[#8B5CF6] hover:bg-[#7C3AED] flex items-center gap-2">
                  {savingConfig ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Salvar Monitoramento
                </Button>
              </>
            )}
          </div>

          {/* Card 2: Relatório Semanal */}
          <div className="bg-[#111111] border border-gray-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-[#8B5CF6]" />
                <h2 className="text-xl font-bold text-white">Relatório Semanal</h2>
              </div>
              <Button onClick={gerarRelatorio} disabled={gerando || !config?.marca_nome} className="bg-[#22C55E] hover:bg-[#16A34A] disabled:opacity-50 flex items-center gap-2">
                {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Gerar Relatório
              </Button>
            </div>

            {reportErr && (
              <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span className="text-red-300 text-sm">{reportErr}</span>
              </div>
            )}

            {!relatorio && !gerando && (
              <p className="text-gray-500 text-sm">Salve seu monitoramento e clique em "Gerar Relatório" pra ver sentimento, menções e tendências da semana.</p>
            )}

            {relatorio && (
              <div className="space-y-6">
                {relatorio.resumo && <p className="text-gray-300 text-sm">{relatorio.resumo}</p>}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Pizza de sentimento */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-400 mb-2">Sentimento das menções</h3>
                    {sentData.length ? (
                      <div style={{ width: '100%', height: 220 }}>
                        <ResponsiveContainer>
                          <PieChart>
                            <Pie data={sentData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                              {sentData.map((d) => (
                                <Cell key={d.key} fill={SENT_COLORS[d.key] ?? '#8B5CF6'} />
                              ))}
                            </Pie>
                            <Tooltip contentStyle={{ background: '#1A1A1A', border: '1px solid #374151', borderRadius: 8, color: '#fff' }} />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-gray-600 text-sm">Sem menções classificadas ainda.</p>
                    )}
                  </div>

                  {/* Nuvem de palavras */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-400 mb-2">Nuvem de palavras</h3>
                    {palavrasOrdenadas.length ? (
                      <div className="flex flex-wrap gap-x-3 gap-y-1 items-center">
                        {palavrasOrdenadas.map(([palavra, freq]) => {
                          const scale = 0.85 + (Number(freq) / maxFreq) * 1.4
                          const opacity = 0.45 + (Number(freq) / maxFreq) * 0.55
                          return (
                            <span key={palavra} style={{ fontSize: `${scale}rem`, opacity }} className="text-[#8B5CF6] font-medium leading-tight">
                              {palavra}
                            </span>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-gray-600 text-sm">Sem palavras suficientes.</p>
                    )}
                  </div>
                </div>

                {/* Tendências */}
                {relatorio.tendencias?.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-1">
                      <TrendingUp className="w-4 h-4" /> Tendências do nicho (sugeridas por IA)
                    </h3>
                    <ul className="space-y-2">
                      {relatorio.tendencias.map((t, i) => (
                        <li key={i} className="text-gray-300 text-sm bg-[#0A0A0A] border border-gray-800 rounded-lg p-3">{t}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Tabela de menções */}
                {relatorio.mencoes?.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-400 mb-2">Menções analisadas</h3>
                    <div className="bg-[#0A0A0A] border border-gray-800 rounded-lg overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-500 text-left border-b border-gray-800">
                            <th className="p-2 font-medium">Menção</th>
                            <th className="p-2 font-medium">Sentimento</th>
                            <th className="p-2 font-medium">Motivo</th>
                            <th className="p-2 font-medium">Fonte</th>
                          </tr>
                        </thead>
                        <tbody>
                          {relatorio.mencoes.map((m, i) => (
                            <tr key={i} className="border-b border-gray-900 last:border-0">
                              <td className="p-2 text-gray-300 max-w-xs">{m.texto}</td>
                              <td className="p-2">
                                <span className="text-xs font-medium" style={{ color: SENT_COLORS[m.classificacao?.toLowerCase()] ?? '#9CA3AF' }}>
                                  {m.classificacao}
                                </span>
                              </td>
                              <td className="p-2 text-gray-500">{m.motivo}</td>
                              <td className="p-2">
                                {m.url ? (
                                  <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-[#8B5CF6] hover:underline flex items-center gap-1">
                                    <ExternalLink className="w-3 h-3" /> {m.fonte || 'link'}
                                  </a>
                                ) : (
                                  <span className="text-gray-600">{m.fonte}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Card 3: Alertas */}
          <div className="bg-[#111111] border border-gray-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-[#EF4444]" />
              <h2 className="text-xl font-bold text-white">Alertas (últimos 7 dias)</h2>
            </div>

            {alertas.length === 0 ? (
              <p className="text-gray-500 text-sm flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#22C55E]" /> Nenhum alerta de crise nos últimos 7 dias.
              </p>
            ) : (
              <div className="bg-[#0A0A0A] border border-gray-800 rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-left border-b border-gray-800">
                      <th className="p-2 font-medium">Data</th>
                      <th className="p-2 font-medium">Menção</th>
                      <th className="p-2 font-medium">Motivo</th>
                      <th className="p-2 font-medium">Fonte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alertas.map((a) => (
                      <tr key={a.id} className="border-b border-gray-900 last:border-0">
                        <td className="p-2 text-gray-500 whitespace-nowrap">{new Date(a.created_at).toLocaleDateString('pt-BR')}</td>
                        <td className="p-2 text-gray-300 max-w-xs">
                          <span className="flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-[#EF4444] shrink-0" /> {a.mencao_texto}
                          </span>
                        </td>
                        <td className="p-2 text-gray-500">{a.motivo}</td>
                        <td className="p-2">
                          {a.url ? (
                            <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-[#8B5CF6] hover:underline flex items-center gap-1">
                              <ExternalLink className="w-3 h-3" /> {a.fonte || 'link'}
                            </a>
                          ) : (
                            <span className="text-gray-600">{a.fonte}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
