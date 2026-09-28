import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Lock, Loader2, Sparkles, Download, Copy, Check, AlertCircle, Newspaper, Brain, Plus, X } from 'lucide-react'
import { useSubscription, devolverGeracaoTrial } from '../lib/useSubscription'
import { supabase } from '../lib/supabase'
import { fetchWithRetry, safeJson, friendlyApiError } from '../lib/apiRetry'
import { Button } from '../components/ui/button'
import { BackButton } from '../components/BackButton'
import { TONS, TOM_PADRAO } from '../lib/tons'
import {
  lerMemoriaDaMarca, nichosDaMemoria, postsDoPeriodo, textoDaNewsletter, htmlDaNewsletter,
  type LinhaMemoria, type Newsletter,
} from '../lib/newsletter'

export const Route = createFileRoute('/newsletter')({
  component: NewsletterPage,
})

// NEWSLETTER SEMANAL — F1 (28/09): a newsletter da semana escrita a partir do que a
// marca JÁ publicou no VoiceFlow (Memória da Marca) + os fatos informados. Gera,
// deixa editar, copiar e baixar o HTML. Envio pra lista = F2 (consentimento/LGPD).
// Regra de ouro: só o que a marca publicou ou informou — nenhuma oferta inventada.

const JANELAS = [
  { semanas: 1, rotulo: 'Última semana' },
  { semanas: 2, rotulo: 'Últimas 2 semanas' },
  { semanas: 4, rotulo: 'Último mês' },
]

function slug(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

function NewsletterPage() {
  const navigate = useNavigate()
  const { hasContentAgentFeature, trial, loading: subLoading, refresh, courtesyExpired } = useSubscription()

  const [nicho, setNicho] = useState('')
  const [semanas, setSemanas] = useState(1)
  const [fatos, setFatos] = useState('')
  const [cta, setCta] = useState('')
  const [tom, setTom] = useState(TOM_PADRAO)

  // Memória da Marca: null = ainda carregando OU falhou (distinguido por memoriaErro).
  const [memoria, setMemoria] = useState<LinhaMemoria[] | null>(null)
  const [memoriaErro, setMemoriaErro] = useState(false)

  const [newsletter, setNewsletter] = useState<Newsletter | null>(null)
  const [gerando, setGerando] = useState(false)
  const [erro, setErro] = useState('')
  const [rateNotice, setRateNotice] = useState('')
  const [modeloReserva, setModeloReserva] = useState('')
  const [postsUsados, setPostsUsados] = useState(0)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    let cancelado = false
    lerMemoriaDaMarca().then((linhas) => {
      if (cancelado) return
      if (linhas === null) setMemoriaErro(true)
      else {
        setMemoria(linhas)
        // Sugere o nicho mais recente — o dono confirma ou troca.
        const nichos = nichosDaMemoria(linhas)
        if (nichos[0]) setNicho((atual) => atual || nichos[0])
      }
    })
    return () => { cancelado = true }
  }, [])

  const nichos = useMemo(() => (memoria ? nichosDaMemoria(memoria) : []), [memoria])
  const periodo = useMemo(
    () => (memoria && nicho.trim() ? postsDoPeriodo(memoria, nicho, semanas) : null),
    [memoria, nicho, semanas],
  )

  // Memória ainda carregando: espera (senão geraria só com os fatos, ignorando posts que
  // estão chegando). Memória FALHOU: segue só com os fatos, como o painel promete.
  const carregandoMemoria = memoria === null && !memoriaErro
  const postsParaEnviar = periodo?.posts ?? []
  const podeGerar = nicho.trim().length > 0 && !gerando && !carregandoMemoria && (!!fatos.trim() || postsParaEnviar.length > 0)

  async function handleGerar() {
    if (!podeGerar) {
      if (!gerando && !carregandoMemoria && nicho.trim() && !fatos.trim()) setErro('Sem posts nesse período: informe os fatos da marca pra não inventar nada.')
      return
    }
    // Trial: a newsletter é conteúdo de IA = 1 geração. Débito ANTES, devolução em qualquer falha.
    if (trial.isTrial) {
      const { error: trialErr } = await supabase.rpc('use_trial_generation')
      if (trialErr) {
        await refresh()
        setErro('Seu trial acabou. Assine para continuar gerando.')
        return
      }
    }
    setGerando(true)
    setErro('')
    setRateNotice('')
    try {
      const response = await fetchWithRetry(
        '/api/gemini/gerar-newsletter',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nicho, tom, fatos, cta, semanas, posts: postsParaEnviar }),
        },
        // O endpoint já tenta 3 modelos por dentro (reserva) — insistir muito aqui só alonga a espera.
        { retries: 1, onWait: (s) => setRateNotice(`⏳ Muita procura agora — tentando de novo em ${s}s...`) },
      )
      setRateNotice('')
      if (!response.ok) {
        const errData = await response.json().catch(() => null)
        throw new Error(friendlyApiError(response.status, errData?.error))
      }
      const data = await safeJson(response)
      const n = data?.newsletter as Newsletter | undefined
      if (!n || !n.assunto || !Array.isArray(n.blocos) || n.blocos.length === 0) {
        throw new Error('A IA não devolveu a newsletter. Tente de novo.')
      }
      setNewsletter(n)
      setModeloReserva(data.reserva === true ? String(data.modelo || 'reserva') : '')
      setPostsUsados(Number(data.postsUsados) || 0)
      if (trial.isTrial) void refresh()
    } catch (err) {
      setRateNotice('')
      if (trial.isTrial) {
        await devolverGeracaoTrial()
        void refresh()
      }
      setErro(err instanceof Error ? err.message : 'Não foi possível gerar a newsletter agora.')
    } finally {
      setGerando(false)
    }
  }

  function editar<K extends keyof Newsletter>(campo: K, valor: Newsletter[K]) {
    setNewsletter((n) => (n ? { ...n, [campo]: valor } : n))
  }
  function editarBloco(idx: number, campo: 'titulo' | 'texto', valor: string) {
    setNewsletter((n) => (n ? { ...n, blocos: n.blocos.map((b, i) => (i === idx ? { ...b, [campo]: valor } : b)) } : n))
  }
  function removerBloco(idx: number) {
    setNewsletter((n) => (n ? { ...n, blocos: n.blocos.filter((_, i) => i !== idx) } : n))
  }
  function adicionarBloco() {
    setNewsletter((n) => (n ? { ...n, blocos: [...n.blocos, { titulo: '', texto: '' }] } : n))
  }

  async function copiar() {
    if (!newsletter) return
    try {
      await navigator.clipboard.writeText(textoDaNewsletter(newsletter))
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // clipboard bloqueado — sem feedback falso
    }
  }

  function baixarHtml() {
    if (!newsletter) return
    const blob = new Blob([htmlDaNewsletter(newsletter, nicho.trim())], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `newsletter-${slug(nicho) || 'marca'}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (subLoading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white">
        <div className="container mx-auto p-4 py-8">
          <h1 className="text-3xl font-bold mb-6">Carregando...</h1>
        </div>
      </div>
    )
  }

  if (!hasContentAgentFeature) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white">
        <div className="container mx-auto p-4 py-8 max-w-2xl">
          <BackButton to="/dashboard" label="Voltar" className="mb-6" />
          <div className="bg-[#111111] border border-gray-800 rounded-2xl p-10 text-center">
            <Lock className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Newsletter Semanal 🔒</h1>
            <p className="text-gray-400 mb-6">
              A newsletter da semana escrita a partir do que a sua marca já criou aqui no VoiceFlow.
              {courtesyExpired ? ' Sua cortesia encerrou — assine pra continuar.' : ' Disponível nos planos Crescimento e Dominação.'}
            </p>
            <Button onClick={() => navigate({ to: '/precos' })} className="bg-[#8B5CF6] hover:bg-[#7C3AED]">
              Ver Planos
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const campo = 'w-full bg-[#111111] border border-gray-800 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 focus:border-[#8B5CF6] focus:outline-none text-sm'

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <div className="container mx-auto p-4 py-8 max-w-5xl">
        <BackButton to="/dashboard" label="Voltar" className="mb-4" />

        <div className="mb-6">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Newspaper className="w-8 h-8 text-[#F59E0B]" />
            Newsletter Semanal
          </h1>
          <p className="text-gray-400 mt-1">
            A newsletter da semana escrita a partir do conteúdo que a sua marca já criou aqui no VoiceFlow — pro seu
            canal próprio, sem depender de algoritmo. Você edita, copia ou baixa o HTML e manda pela ferramenta
            de e-mail que já usa.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Briefing */}
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Seu negócio *</label>
              <input
                type="text"
                list="nichos-memoria"
                value={nicho}
                onChange={(e) => setNicho(e.target.value)}
                placeholder="Ex: Barbearia do Messias, em Fortaleza"
                className={campo}
              />
              <datalist id="nichos-memoria">
                {nichos.map((n) => <option key={n} value={n} />)}
              </datalist>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Período</label>
              <div className="flex flex-wrap gap-2">
                {JANELAS.map((j) => (
                  <button
                    key={j.semanas}
                    type="button"
                    onClick={() => setSemanas(j.semanas)}
                    aria-pressed={semanas === j.semanas}
                    className={`text-sm rounded-full border px-3 py-1.5 transition-colors ${
                      semanas === j.semanas
                        ? 'border-[#F59E0B] bg-[#F59E0B]/15 text-white'
                        : 'border-gray-700 bg-[#111111] text-gray-400 hover:border-gray-500 hover:text-white'
                    }`}
                  >
                    {j.rotulo}
                  </button>
                ))}
              </div>
            </div>

            {/* O que a IA vai ler — número real, nunca estimado. */}
            <div className="bg-[#8B5CF6]/10 border border-[#8B5CF6]/40 rounded-xl p-3 text-sm flex items-start gap-2">
              <Brain className="w-4 h-4 text-[#8B5CF6] shrink-0 mt-0.5" />
              <p className="text-gray-300">
                {memoriaErro
                  ? 'Não consegui ler sua Memória da Marca agora. Recarregue a página — ou gere só com os fatos.'
                  : memoria === null
                    ? 'Lendo sua Memória da Marca…'
                    : !nicho.trim()
                      ? 'Informe o negócio pra eu achar os posts que você já criou aqui.'
                      : periodo && periodo.posts.length > 0
                        ? `A newsletter vai nascer de ${periodo.posts.length} ${periodo.posts.length === 1 ? 'post' : 'posts'} que você gerou nesse período (${periodo.kits} ${periodo.kits === 1 ? 'geração' : 'gerações'}), mais os fatos abaixo.`
                        : 'Nenhum post desse negócio no período. A newsletter sai curta, só com os fatos que você informar — sem fingir novidade.'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Fatos da sua marca <span className="text-gray-500 font-normal">(a IA só afirma o que estiver aqui ou nos posts)</span>
              </label>
              <textarea
                value={fatos}
                onChange={(e) => setFatos(e.target.value)}
                rows={4}
                placeholder="Ex: Seg a sáb, 9h às 18h. Av. Barão de Studart, 2450 — Aldeota. Agendamento pelo WhatsApp."
                className={`${campo} resize-none`}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Chamada para ação <span className="text-gray-500 font-normal">(opcional)</span>
              </label>
              <input
                type="text"
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder="Ex: Responda este e-mail pra marcar seu horário"
                className={campo}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">🎭 Tom</label>
              <div className="flex flex-wrap gap-2">
                {TONS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTom(t.value)}
                    aria-pressed={tom === t.value}
                    className={`text-sm rounded-full border px-3 py-1.5 transition-colors ${
                      tom === t.value
                        ? 'border-[#8B5CF6] bg-[#8B5CF6]/15 text-white'
                        : 'border-gray-700 bg-[#111111] text-gray-400 hover:border-gray-500 hover:text-white'
                    }`}
                  >
                    {t.emoji} {t.value}
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={handleGerar}
              disabled={!podeGerar}
              className="w-full bg-[#F59E0B] hover:bg-[#D97706] py-6 text-lg font-bold disabled:opacity-50"
            >
              {gerando ? (
                <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Escrevendo a newsletter...</>
              ) : (
                <><Sparkles className="w-5 h-5 mr-2" /> {newsletter ? 'Gerar de novo' : 'Gerar newsletter'}</>
              )}
            </Button>
            {trial.isTrial && (
              <p className="text-xs text-gray-500 text-center">Usa 1 das suas {trial.generationsLeft} gerações do teste grátis.</p>
            )}
            {rateNotice && <p className="text-amber-400 text-sm text-center">{rateNotice}</p>}
            {erro && (
              <p className="text-red-400 text-sm flex items-center gap-1">
                <AlertCircle className="w-4 h-4 shrink-0" /> {erro}
              </p>
            )}
          </div>

          {/* Resultado */}
          <div className="space-y-4">
            {newsletter ? (
              <>
                {modeloReserva && (
                  <p className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-lg px-3 py-2 flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      Gerada com o <strong>modelo reserva</strong> ({modeloReserva}) porque a IA principal está em fila. Confira antes de enviar.
                    </span>
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" onClick={copiar} className="bg-[#1A1A1A] hover:bg-[#252525] text-sm">
                    {copiado ? <><Check className="w-4 h-4 mr-1 text-[#22C55E]" /> Copiado</> : <><Copy className="w-4 h-4 mr-1" /> Copiar texto</>}
                  </Button>
                  <Button type="button" onClick={baixarHtml} className="bg-[#F59E0B] hover:bg-[#D97706] text-sm">
                    <Download className="w-4 h-4 mr-1" /> Baixar HTML do e-mail
                  </Button>
                  <span className="text-xs text-gray-500">
                    {postsUsados > 0 ? `Feita com ${postsUsados} ${postsUsados === 1 ? 'post' : 'posts'} seus.` : 'Feita só com os fatos informados.'}
                  </span>
                </div>

                <div className="bg-[#111111] border border-gray-800 rounded-xl p-4 space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Assunto</label>
                    <input value={newsletter.assunto} onChange={(e) => editar('assunto', e.target.value)} className={campo} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Pré-visualização (aparece ao lado do assunto)</label>
                    <input value={newsletter.preheader} onChange={(e) => editar('preheader', e.target.value)} className={campo} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Abertura</label>
                    <textarea value={newsletter.abertura} onChange={(e) => editar('abertura', e.target.value)} rows={3} className={`${campo} resize-y`} />
                  </div>
                  {newsletter.blocos.map((b, idx) => (
                    <div key={idx} className="border border-gray-800 rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          value={b.titulo}
                          onChange={(e) => editarBloco(idx, 'titulo', e.target.value)}
                          placeholder="Título do bloco"
                          className={`${campo} font-semibold`}
                        />
                        <button
                          type="button"
                          onClick={() => removerBloco(idx)}
                          className="text-gray-500 hover:text-red-400"
                          aria-label={`Remover bloco ${idx + 1}`}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <textarea value={b.texto} onChange={(e) => editarBloco(idx, 'texto', e.target.value)} rows={4} className={`${campo} resize-y`} />
                    </div>
                  ))}
                  <button type="button" onClick={adicionarBloco} className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> Adicionar bloco
                  </button>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Fechamento</label>
                    <textarea value={newsletter.fechamento} onChange={(e) => editar('fechamento', e.target.value)} rows={2} className={`${campo} resize-y`} />
                  </div>
                </div>

                <p className="text-xs text-gray-500">
                  Confira cada bloco antes de mandar: a IA só usa seus posts e fatos, mas quem assina a newsletter é você.
                  O envio automático pra sua lista (com descadastro e consentimento) chega numa próxima fase.
                </p>
              </>
            ) : (
              <div className="border border-gray-800 rounded-xl h-full min-h-[320px] flex flex-col items-center justify-center text-center p-8 text-gray-500">
                <Newspaper className="w-10 h-10 mb-3 text-gray-700" />
                <p className="font-medium text-gray-400">Sua newsletter aparece aqui</p>
                <p className="text-sm mt-1">Escolha o negócio e o período, confira os fatos e clique em “Gerar newsletter”.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
