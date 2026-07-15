import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import {
  Lock, Loader2, Radar as RadarIcon, AlertTriangle, TrendingUp, Save,
  CheckCircle2, AlertCircle, ExternalLink, RefreshCw, Bell, Users, FileDown,
  MessageSquare, Copy, X, Mic,
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

// Chaves reais de sentimento — separa dos metadados que viajam no mesmo JSONB (ex: `classificado`).
const SENT_KEYS = ['positivo', 'neutro', 'negativo', 'crise']

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

interface Concorrente {
  nome: string
  total: number
  sentimento: Record<string, number>
  score: number
}

interface Relatorio {
  id: string
  created_at: string
  resumo: string
  sentimento: Record<string, number>
  mencoes: Mencao[]
  tendencias: string[]
  palavras: Record<string, number>
  concorrentes?: Concorrente[]
}

// Nota de Reputação 0-100 (mesma fórmula do backend), pra calcular a nota da própria
// marca no client a partir do sentimento agregado.
function reputationScore(s: Record<string, number>): number {
  const pos = Number(s.positivo || 0)
  const neu = Number(s.neutro || 0)
  const neg = Number(s.negativo || 0)
  const cri = Number(s.crise || 0)
  const total = pos + neu + neg + cri
  if (!total) return 0
  const raw = (pos * 1 + neu * 0.5 + neg * 0 + cri * -0.5) / total
  return Math.max(0, Math.min(100, Math.round(raw * 100)))
}

function scoreColor(score: number): string {
  if (score >= 70) return '#22C55E'
  if (score >= 40) return '#F59E0B'
  return '#EF4444'
}

// Chave usada pra levar a resposta gerada pro Editor de Voz (lida lá no mount).
const EDITOR_PRESET_KEY = 'vfia:editor-preset-text'

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
  const navigate = useNavigate()

  const [userId, setUserId] = useState<string | null>(null)
  const [config, setConfig] = useState<RadarConfig | null>(null)
  const [savingConfig, setSavingConfig] = useState(false)
  const [configMsg, setConfigMsg] = useState('')
  const [configErr, setConfigErr] = useState('')

  const [relatorio, setRelatorio] = useState<Relatorio | null>(null)
  const [gerando, setGerando] = useState(false)
  const [reportErr, setReportErr] = useState('')

  const [alertas, setAlertas] = useState<Alerta[]>([])

  const [exportingPdf, setExportingPdf] = useState(false)
  const reportRef = useRef<HTMLDivElement | null>(null)

  // Modal "Detectou → Responde"
  const [resp, setResp] = useState<{ open: boolean; mencao: string; classificacao: string; loading: boolean; texto: string; erro: string }>(
    { open: false, mencao: '', classificacao: '', loading: false, texto: '', erro: '' },
  )

  async function gerarResposta(mencao: string, classificacao: string) {
    setResp({ open: true, mencao, classificacao, loading: true, texto: '', erro: '' })
    try {
      const res = await fetch('/api/radar/generate-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marca: config?.marca_nome, nicho: config?.nicho, mencao, classificacao }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || `Erro na API: ${res.status}`)
      setResp((r) => ({ ...r, loading: false, texto: data?.resposta || '' }))
    } catch (e) {
      setResp((r) => ({ ...r, loading: false, erro: e instanceof Error ? e.message : 'Erro ao gerar resposta' }))
    }
  }

  function ouvirNoEditor(texto: string) {
    try {
      sessionStorage.setItem(EDITOR_PRESET_KEY, texto)
    } catch {
      // sessionStorage indisponível — segue sem pré-preencher
    }
    navigate({ to: '/editor' })
  }

  async function exportarPdf() {
    const node = reportRef.current
    if (!node) return
    setExportingPdf(true)
    try {
      const [{ toPng }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')])
      const dataUrl = await toPng(node, { backgroundColor: '#0A0A0A', pixelRatio: 2 })

      const img = new Image()
      img.src = dataUrl
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
      })

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const imgH = (img.height / img.width) * pageW

      // Paginação: fatia a imagem alta em várias páginas A4.
      let heightLeft = imgH
      let position = 0
      pdf.addImage(dataUrl, 'PNG', 0, position, pageW, imgH)
      heightLeft -= pageH
      while (heightLeft > 0) {
        position -= pageH
        pdf.addPage()
        pdf.addImage(dataUrl, 'PNG', 0, position, pageW, imgH)
        heightLeft -= pageH
      }

      const nome = (config?.marca_nome || 'relatorio').replace(/\s+/g, '-').toLowerCase()
      pdf.save(`radar-${nome}.pdf`)
    } catch (e) {
      console.error('Erro ao exportar PDF:', e)
      setReportErr('Não consegui gerar o PDF. Tente novamente.')
    } finally {
      setExportingPdf(false)
    }
  }

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
        .filter(([k, v]) => SENT_KEYS.includes(k) && Number(v) > 0)
        .map(([k, v]) => ({ name: k.charAt(0).toUpperCase() + k.slice(1), key: k, value: Number(v) }))
    : []

  // A IA classificou o sentimento nesta rodada? `classificado === 0` = caiu no fallback
  // (Gemini sobrecarregado) e tudo virou "Neutro" — não é reputação neutra real.
  // Relatórios antigos não têm o flag (undefined) → tratados como classificados (legado).
  const mencoesCount = relatorio?.mencoes?.length || 0
  const sentimentoOk = relatorio ? Number((relatorio.sentimento as Record<string, number>).classificado) !== 0 : true
  const semClassificacao = !!relatorio && mencoesCount > 0 && !sentimentoOk

  const palavrasOrdenadas = relatorio
    ? Object.entries(relatorio.palavras).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 30)
    : []
  const maxFreq = palavrasOrdenadas.length ? Number(palavrasOrdenadas[0][1]) : 1

  // Nota da própria marca + comparativo com concorrentes (você no topo, destacado).
  const brandScore = relatorio ? reputationScore(relatorio.sentimento) : 0
  const comparativo = relatorio
    ? [
        { nome: `${config?.marca_nome || 'Sua marca'}`, score: brandScore, total: relatorio.mencoes?.length || 0, voce: true },
        ...(relatorio.concorrentes || []).map((c) => ({ nome: c.nome, score: c.score, total: c.total, voce: false })),
      ]
    : []

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
              <div className="flex items-center gap-2">
                {relatorio && (
                  <Button onClick={exportarPdf} disabled={exportingPdf} variant="secondary" className="bg-[#1A1A1A] hover:bg-[#252525] text-gray-200 flex items-center gap-2">
                    {exportingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                    Baixar PDF
                  </Button>
                )}
                <Button onClick={gerarRelatorio} disabled={gerando || !config?.marca_nome} className="bg-[#22C55E] hover:bg-[#16A34A] disabled:opacity-50 flex items-center gap-2">
                  {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Gerar Relatório
                </Button>
              </div>
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
              <div ref={reportRef} className="space-y-6 bg-[#111111] p-1">
                {/* Cabeçalho de marca (aparece no PDF) */}
                <div className="flex items-center justify-between border-b border-gray-800 pb-3">
                  <div className="flex items-center gap-2">
                    <RadarIcon className="w-5 h-5 text-[#8B5CF6]" />
                    <span className="text-white font-bold">VoiceFlow Radar</span>
                    <span className="text-gray-500">·</span>
                    <span className="text-gray-300">{config?.marca_nome || 'Sua marca'}</span>
                  </div>
                  <span className="text-xs text-gray-500">
                    {new Date(relatorio.created_at).toLocaleDateString('pt-BR')}
                  </span>
                </div>

                {relatorio.resumo && <p className="text-gray-300 text-sm">{relatorio.resumo}</p>}

                {/* Aviso quando a IA não classificou o sentimento (fallback = tudo Neutro) */}
                {semClassificacao && (
                  <div className="p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-lg flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                    <span className="text-yellow-200 text-sm">
                      A IA não conseguiu classificar o sentimento nesta rodada (sobrecarga temporária do Gemini). As {mencoesCount} menções foram coletadas, mas <strong>não estão classificadas</strong> — o "Neutro" abaixo não reflete a reputação real. Clique em <strong>Gerar Relatório</strong> de novo em alguns instantes.
                    </span>
                  </div>
                )}

                {/* Nota de Reputação da marca */}
                <div className="flex items-center gap-4 bg-[#0A0A0A] border border-gray-800 rounded-lg p-4">
                  {semClassificacao ? (
                    <div className="shrink-0 w-16 h-16 rounded-full flex items-center justify-center font-bold text-xl text-gray-600 border-[3px] border-gray-700">
                      —
                    </div>
                  ) : (
                    <div className="shrink-0 w-16 h-16 rounded-full flex items-center justify-center font-bold text-xl" style={{ color: scoreColor(brandScore), border: `3px solid ${scoreColor(brandScore)}` }}>
                      {brandScore}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-white">Nota de Reputação da sua marca</p>
                    <p className="text-xs text-gray-500">
                      {semClassificacao
                        ? 'Indisponível nesta rodada — o sentimento não foi classificado.'
                        : '0 a 100 — quanto maior, melhor a reputação nas menções da web.'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Pizza de sentimento */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-400 mb-2">Sentimento das menções</h3>
                    {semClassificacao ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500 h-[220px]">
                        <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
                        Sentimento não classificado nesta rodada — gere o relatório novamente.
                      </div>
                    ) : sentData.length ? (
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

                {/* Comparativo com concorrentes */}
                <div>
                  <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-1">
                    <Users className="w-4 h-4" /> Sua marca vs Concorrentes
                    <span className="text-xs text-gray-600 font-normal">(nota de reputação)</span>
                  </h3>
                  {comparativo.length > 1 ? (
                    <div className="space-y-2">
                      {comparativo
                        .slice()
                        .sort((a, b) => b.score - a.score)
                        .map((row) => (
                          <div key={row.nome} className={`flex items-center gap-3 rounded-lg p-2 ${row.voce ? 'bg-[#8B5CF6]/10 border border-[#8B5CF6]/40' : 'bg-[#0A0A0A] border border-gray-800'}`}>
                            <span className={`w-40 shrink-0 text-sm truncate ${row.voce ? 'text-white font-semibold' : 'text-gray-300'}`}>
                              {row.nome} {row.voce && <span className="text-[10px] text-[#a78bfa]">você</span>}
                            </span>
                            <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${row.score}%`, background: scoreColor(row.score) }} />
                            </div>
                            <span className="w-8 text-right text-sm font-bold tabular-nums" style={{ color: scoreColor(row.score) }}>
                              {row.score}
                            </span>
                            <span className="w-16 text-right text-[11px] text-gray-600">{row.total} menç.</span>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className="text-gray-600 text-sm">
                      Cadastre concorrentes no <span className="text-gray-400">Monitor de Marca</span> e gere um novo relatório pra comparar sua reputação com a deles.
                    </p>
                  )}
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
                            <th className="p-2 font-medium">Ação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {relatorio.mencoes.map((m, i) => {
                            const cl = m.classificacao?.toLowerCase()
                            const respondivel = cl === 'negativo' || cl === 'crise'
                            return (
                              <tr key={i} className="border-b border-gray-900 last:border-0">
                                <td className="p-2 text-gray-300 max-w-xs">{m.texto}</td>
                                <td className="p-2">
                                  {semClassificacao ? (
                                    <span className="text-xs text-gray-600" title="IA não classificou nesta rodada">—</span>
                                  ) : (
                                    <span className="text-xs font-medium" style={{ color: SENT_COLORS[cl] ?? '#9CA3AF' }}>
                                      {m.classificacao}
                                    </span>
                                  )}
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
                                <td className="p-2">
                                  {respondivel && (
                                    <button
                                      type="button"
                                      onClick={() => gerarResposta(m.texto, m.classificacao)}
                                      className="text-xs font-medium text-[#22C55E] hover:underline flex items-center gap-1 whitespace-nowrap"
                                    >
                                      <MessageSquare className="w-3 h-3" /> Responder
                                    </button>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
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
                      <th className="p-2 font-medium">Ação</th>
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
                        <td className="p-2">
                          <button
                            type="button"
                            onClick={() => gerarResposta(a.mencao_texto, a.classificacao || 'Negativo')}
                            className="text-xs font-medium text-[#22C55E] hover:underline flex items-center gap-1 whitespace-nowrap"
                          >
                            <MessageSquare className="w-3 h-3" /> Responder
                          </button>
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

      {/* Modal: Detectou → Responde */}
      {resp.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setResp((r) => ({ ...r, open: false }))}>
          <div className="bg-[#111111] border border-gray-800 rounded-2xl w-full max-w-lg p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-[#22C55E]" /> Resposta sugerida
              </h3>
              <button type="button" onClick={() => setResp((r) => ({ ...r, open: false }))} className="text-gray-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-[#0A0A0A] border border-gray-800 rounded-lg p-3">
              <p className="text-[11px] uppercase tracking-wide text-gray-600 mb-1">Menção original</p>
              <p className="text-sm text-gray-400">{resp.mencao}</p>
            </div>

            {resp.loading ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm py-6 justify-center">
                <Loader2 className="w-5 h-5 animate-spin" /> Escrevendo uma resposta profissional...
              </div>
            ) : resp.erro ? (
              <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-sm text-red-300">{resp.erro}</div>
            ) : (
              <>
                <textarea
                  value={resp.texto}
                  onChange={(e) => setResp((r) => ({ ...r, texto: e.target.value }))}
                  className="w-full h-32 p-3 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-[#8B5CF6] resize-none"
                />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => navigator.clipboard?.writeText(resp.texto)} variant="secondary" className="bg-[#1A1A1A] hover:bg-[#252525] text-gray-200 flex items-center gap-2">
                    <Copy className="w-4 h-4" /> Copiar
                  </Button>
                  <Button onClick={() => gerarResposta(resp.mencao, resp.classificacao)} variant="secondary" className="bg-[#1A1A1A] hover:bg-[#252525] text-gray-200 flex items-center gap-2">
                    <RefreshCw className="w-4 h-4" /> Gerar de novo
                  </Button>
                  <Button onClick={() => ouvirNoEditor(resp.texto)} className="bg-[#8B5CF6] hover:bg-[#7C3AED] flex items-center gap-2">
                    <Mic className="w-4 h-4" /> Ouvir no Editor de Voz
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
