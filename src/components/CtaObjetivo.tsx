import { useState, useEffect } from 'react'
import { Loader2, Bookmark, Check, Copy, Pencil } from 'lucide-react'
import { fetchWithRetry, safeJson, friendlyApiError } from '../lib/apiRetry'
import { supabase } from '../lib/supabase'
import { salvarTemplate, listarTemplates, type Template } from '../lib/templates'
import { OBJETIVOS_CTA, type ObjetivoCta } from '../lib/objetivosCta'
import {
  type BrandWhatsapp,
  brandWhatsappKey,
  loadBrandWhatsapp,
  saveBrandWhatsapp,
  onBrandWhatsappUpdated,
  buildWaLink,
  normalizarWhatsapp,
  whatsappIncompleto,
  MENSAGEM_PADRAO,
} from '../lib/brandWhatsapp'

interface CtaObjetivoProps {
  /** Legenda atual do post/card (usada como contexto pra IA e alvo da substituição). */
  legenda: string
  tom: string
  /** Hook do post, se existir (Agente/Super Agente) — usado ao salvar template tipo hook_cta. */
  hook?: string
  /** Chamado com a legenda já com o CTA inserido/substituído no fim. */
  onAplicar: (novaLegenda: string) => void
}

/**
 * Bloco "CTA Inteligente por Objetivo": usuário escolhe um objetivo, a IA gera
 * 5 variações de CTA baseadas na legenda + tom, e cada uma pode ser aplicada
 * (colada/substituída no fim da legenda) ou salva como template reusável.
 * Estado é próprio do componente — montado 1x por card, isola por índice
 * naturalmente (sem precisar de Record<number,T> no componente pai).
 */
export function CtaObjetivo({ legenda, tom, hook, onAplicar }: CtaObjetivoProps) {
  const [aberto, setAberto] = useState(false)
  const [objetivoAtual, setObjetivoAtual] = useState<ObjetivoCta | null>(null)
  const [ctas, setCtas] = useState<string[] | null>(null)
  const [gerando, setGerando] = useState(false)
  const [erro, setErro] = useState('')
  const [ctaAplicado, setCtaAplicado] = useState<string | null>(null)
  const [salvando, setSalvando] = useState<{ cta: string; nome: string } | null>(null)
  const [salvandoLoading, setSalvandoLoading] = useState(false)
  const [salvo, setSalvo] = useState<string | null>(null)
  const [erroSalvar, setErroSalvar] = useState('')
  const [templatesSalvos, setTemplatesSalvos] = useState<Template[]>([])

  // whatsappSalvo = o que está persistido (usado pra montar/copiar o link).
  // whatsappDraft = o que está sendo digitado no formulário — separados pra
  // digitar o número não trocar a view antes de clicar "Salvar".
  const WHATSAPP_VAZIO: BrandWhatsapp = { numero: '', mensagem: MENSAGEM_PADRAO, incluirMensagem: false }
  const [whatsappSalvo, setWhatsappSalvo] = useState<BrandWhatsapp>(WHATSAPP_VAZIO)
  const [whatsappDraft, setWhatsappDraft] = useState<BrandWhatsapp>(WHATSAPP_VAZIO)
  const [whatsappKey, setWhatsappKey] = useState('')
  const [editandoWhatsapp, setEditandoWhatsapp] = useState(false)
  const [linkCopiado, setLinkCopiado] = useState(false)

  useEffect(() => {
    if (!aberto) return
    let cancelado = false
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user || cancelado) return
      try {
        const templates = await listarTemplates(user.id)
        if (!cancelado) setTemplatesSalvos(templates)
      } catch (err) {
        console.error('Erro ao carregar templates salvos:', err)
      }
    })
    return () => {
      cancelado = true
    }
  }, [aberto])

  useEffect(() => {
    if (!aberto) return
    let cancelado = false
    let key = ''

    function carregar() {
      if (cancelado || !key) return
      const dados = loadBrandWhatsapp(key)
      setWhatsappSalvo(dados)
      setWhatsappDraft(dados)
    }

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelado) return
      key = brandWhatsappKey(user?.id)
      setWhatsappKey(key)
      carregar()
    })

    const unsubscribe = onBrandWhatsappUpdated(carregar)
    return () => {
      cancelado = true
      unsubscribe()
    }
  }, [aberto])

  async function gerarCtas(objetivo: ObjetivoCta) {
    setObjetivoAtual(objetivo)
    setGerando(true)
    setErro('')
    setCtas(null)
    try {
      const response = await fetchWithRetry('/api/gemini/gerar-ctas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legenda, tom, objetivo })
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(friendlyApiError(response.status, data?.error))
      }
      const data = await safeJson(response)
      setCtas(data.ctas)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao gerar CTAs')
    } finally {
      setGerando(false)
    }
  }

  function salvarWhatsapp() {
    if (!whatsappKey || !whatsappDraft.numero.trim()) return
    saveBrandWhatsapp(whatsappKey, whatsappDraft)
    setWhatsappSalvo(whatsappDraft)
    setEditandoWhatsapp(false)
  }

  function editarWhatsapp() {
    setWhatsappDraft(whatsappSalvo)
    setEditandoWhatsapp(true)
  }

  async function copiarLinkWhatsapp() {
    try {
      await navigator.clipboard.writeText(buildWaLink(whatsappSalvo.numero, whatsappSalvo.mensagem, whatsappSalvo.incluirMensagem))
      setLinkCopiado(true)
      setTimeout(() => setLinkCopiado(false), 2000)
    } catch {
      // Clipboard bloqueado — sem feedback falso de "copiado".
    }
  }

  function aplicarCta(cta: string) {
    const legendaLimpa = ctaAplicado ? legenda.replace(`\n\n${ctaAplicado}`, '') : legenda
    onAplicar(`${legendaLimpa}\n\n${cta}`)
    setCtaAplicado(cta)
  }

  async function confirmarSalvar() {
    if (!salvando || !salvando.nome.trim()) return
    setSalvandoLoading(true)
    setErroSalvar('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const conteudo = hook ? { hook, cta: salvando.cta } : { cta: salvando.cta }
      const { error } = await salvarTemplate(user.id, salvando.nome.trim(), hook ? 'hook_cta' : 'cta', conteudo)
      if (error) throw error
      setSalvo(salvando.cta)
      setSalvando(null)
      setTemplatesSalvos(await listarTemplates(user.id))
    } catch (err) {
      console.error('Erro ao salvar template:', err)
      setErroSalvar('Não foi possível salvar agora. Tente de novo.')
    } finally {
      setSalvandoLoading(false)
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="no-export text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:border-[#8B5CF6] hover:text-[#8B5CF6] transition-colors"
      >
        🎯 Fechar com Chave de Ouro (CTA por objetivo)
      </button>
    )
  }

  return (
    <div className="no-export p-3 bg-[#0F0F0F] border border-gray-800 rounded-lg space-y-3">
      <p className="text-xs uppercase text-gray-500">Objetivo do CTA</p>
      <div className="flex flex-wrap gap-2">
        {OBJETIVOS_CTA.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => gerarCtas(o.value)}
            disabled={gerando}
            className="text-xs px-3 py-1.5 rounded-full border border-gray-700 text-gray-300 hover:border-[#8B5CF6] hover:text-[#8B5CF6] disabled:opacity-50 transition-colors"
          >
            {o.emoji} {o.label}
          </button>
        ))}
      </div>

      {objetivoAtual === 'whatsapp' && (
        <div className="p-2 bg-[#1A1A1A] border border-gray-800 rounded-lg space-y-2">
          {whatsappSalvo.numero && !editandoWhatsapp ? (
            <>
              <p className="text-xs text-gray-500">
                Cole esse link no link da bio do seu Instagram (legenda não deixa link clicável) — ou use direto em Stories, Threads, LinkedIn.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs text-gray-300 truncate">
                  {buildWaLink(whatsappSalvo.numero, whatsappSalvo.mensagem, whatsappSalvo.incluirMensagem)}
                </code>
                <button
                  type="button"
                  onClick={copiarLinkWhatsapp}
                  className="shrink-0 text-xs px-2 py-1 rounded-md bg-[#22C55E]/10 border border-[#22C55E] text-[#22C55E] hover:bg-[#22C55E]/20 transition-colors flex items-center gap-1"
                >
                  {linkCopiado ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {linkCopiado ? 'Copiado!' : 'Copiar link'}
                </button>
                <button
                  type="button"
                  onClick={editarWhatsapp}
                  title="Editar número"
                  className="shrink-0 text-gray-500 hover:text-[#8B5CF6] transition-colors p-1"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-gray-500">WhatsApp da marca (1x só — a gente lembra depois)</p>
              <input
                type="text"
                value={whatsappDraft.numero}
                onChange={(e) => setWhatsappDraft({ ...whatsappDraft, numero: e.target.value })}
                placeholder="DDD + número, ex: 85 99226-2297"
                className="w-full p-2 bg-[#0F0F0F] border border-gray-700 rounded-lg text-white text-xs focus:outline-none focus:border-[#8B5CF6]"
              />
              {/* Mostra o numero como o WhatsApp vai receber. O cliente digita como fala
                  ("85 99226-2297") e o 55 entra sozinho — antes o link saia sem o codigo
                  do pais e o WhatsApp recusava na cara do cliente final dele. */}
              {whatsappDraft.numero.trim() && (
                whatsappIncompleto(whatsappDraft.numero) ? (
                  <p className="text-xs text-yellow-500">
                    Faltam dígitos — confira o DDD e o número.
                  </p>
                ) : (
                  <p className="text-xs text-gray-500">
                    Vai como <span className="text-gray-300">+{normalizarWhatsapp(whatsappDraft.numero)}</span> — o código do país entra sozinho.
                  </p>
                )
              )}
              <label className="flex items-center gap-2 text-xs text-gray-400">
                <input
                  type="checkbox"
                  checked={whatsappDraft.incluirMensagem}
                  onChange={(e) => setWhatsappDraft({ ...whatsappDraft, incluirMensagem: e.target.checked })}
                  className="accent-[#8B5CF6]"
                />
                Incluir mensagem pré-preenchida (deixa o link mais longo)
              </label>
              {whatsappDraft.incluirMensagem && (
                <input
                  type="text"
                  value={whatsappDraft.mensagem}
                  onChange={(e) => setWhatsappDraft({ ...whatsappDraft, mensagem: e.target.value })}
                  placeholder="Mensagem pré-preenchida"
                  className="w-full p-2 bg-[#0F0F0F] border border-gray-700 rounded-lg text-white text-xs focus:outline-none focus:border-[#8B5CF6]"
                />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={salvarWhatsapp}
                  disabled={!whatsappDraft.numero.trim() || whatsappIncompleto(whatsappDraft.numero)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] disabled:opacity-50 text-white font-medium"
                >
                  Salvar número
                </button>
                {whatsappSalvo.numero && (
                  <button
                    type="button"
                    onClick={() => {
                      setWhatsappDraft(whatsappSalvo)
                      setEditandoWhatsapp(false)
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg bg-[#0F0F0F] border border-gray-700 text-gray-300"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {templatesSalvos.length > 0 && (
        <select
          defaultValue=""
          onChange={(e) => {
            const template = templatesSalvos.find((t) => t.id === e.target.value)
            if (template) aplicarCta(template.conteudo.cta)
            e.target.value = ''
          }}
          className="w-full p-2 bg-[#1A1A1A] border border-gray-700 rounded-lg text-gray-300 text-xs focus:outline-none focus:border-[#8B5CF6]"
        >
          <option value="" disabled>💾 Usar template salvo...</option>
          {templatesSalvos.map((t) => (
            <option key={t.id} value={t.id}>{t.nome}</option>
          ))}
        </select>
      )}

      {gerando && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Gerando CTAs...
        </div>
      )}

      {erro && <p className="text-red-400 text-xs">{erro}</p>}

      {ctas && (
        <div className="space-y-2">
          {ctas.map((cta, i) => (
            <div key={i} className="flex items-start gap-2 p-2 bg-[#1A1A1A] rounded-lg">
              <p className="flex-1 text-sm text-gray-200">{cta}</p>
              <button
                type="button"
                onClick={() => aplicarCta(cta)}
                className="shrink-0 text-xs px-2 py-1 rounded-md bg-[#8B5CF6]/10 border border-[#8B5CF6] text-[#8B5CF6] hover:bg-[#8B5CF6]/20 transition-colors"
              >
                {ctaAplicado === cta ? <Check className="w-3.5 h-3.5" /> : 'Usar'}
              </button>
              <button
                type="button"
                onClick={() => setSalvando({ cta, nome: '' })}
                title="Salvar como template"
                className="shrink-0 text-gray-500 hover:text-[#8B5CF6] transition-colors p-1"
              >
                {salvo === cta ? <Check className="w-3.5 h-3.5 text-[#22C55E]" /> : <Bookmark className="w-3.5 h-3.5" />}
              </button>
            </div>
          ))}
        </div>
      )}

      {erroSalvar && <p className="text-red-400 text-xs">{erroSalvar}</p>}

      {salvando && (
        <div className="flex gap-2">
          <input
            type="text"
            autoFocus
            value={salvando.nome}
            onChange={(e) => setSalvando({ ...salvando, nome: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && confirmarSalvar()}
            placeholder="Nome do template (ex: CTA WhatsApp urgência)"
            className="flex-1 p-2 bg-[#1A1A1A] border border-[#8B5CF6] rounded-lg text-white text-xs focus:outline-none"
          />
          <button
            type="button"
            onClick={confirmarSalvar}
            disabled={salvandoLoading || !salvando.nome.trim()}
            className="text-xs px-3 py-1.5 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] disabled:opacity-50 text-white font-medium"
          >
            {salvandoLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Salvar'}
          </button>
          <button
            type="button"
            onClick={() => setSalvando(null)}
            className="text-xs px-3 py-1.5 rounded-lg bg-[#1A1A1A] border border-gray-700 text-gray-300"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}
