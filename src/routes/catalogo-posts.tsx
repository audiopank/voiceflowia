import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Lock, Loader2, Sparkles, ShoppingBag, ShieldCheck, CheckCircle2, XCircle, AlertCircle,
  Copy, Check, Download, Save, Volume2, RotateCcw,
} from 'lucide-react'
import { useSubscription, devolverGeracaoTrial } from '../lib/useSubscription'
import { supabase } from '../lib/supabase'
import { fetchWithRetry, safeJson, friendlyApiError } from '../lib/apiRetry'
import { Button } from '../components/ui/button'
import { BackButton } from '../components/BackButton'
import { TONS, TOM_PADRAO } from '../lib/tons'
import { GEMINI_VOICES_TEXTO_LONGO } from '../lib/voices'
import { convertVoiceToMp3 } from '../lib/audioConvert'
import { realcarVoz } from '../lib/estudioCards'
import { listarKits } from '../lib/kitsWhatsapp'
import {
  conferirPost, lerCatalogo, MAX_ITENS_CATALOGO, type ItemCatalogo, type PostCatalogo,
} from '../lib/conferirCatalogo'
import { TravaAcento } from '../components/TravaAcento'
import { corrigirAcentos } from '../lib/conferirAcentos'

export const Route = createFileRoute('/catalogo-posts')({
  component: CatalogoPosts,
})

// CATÁLOGO → POSTS COM PROVA (06/10/2026) — Degrau 1 do VoiceFlow virando AGENTE:
//   ferramenta: o cliente cola o catálogo (um produto por linha);
//   ciclo: a IA escreve o post de cada produto → o CONFERIDOR (código, não IA —
//     src/lib/conferirCatalogo.ts) checa preço, números e promessas → se falhou, a IA
//     reescreve só o que estava errado (até 2 vezes);
//   verificação visível: cada cartão mostra o que foi conferido, ✔ ou ✘;
//   portão: só dá pra aprovar o que passou; editar o texto desfaz a aprovação;
//   memória: os aprovados vão pra `contents` (Meus Conteúdos + Memória da Marca).
// Trial: 1 geração por catálogo (como o Kit). Reescritas e locução não cobram.

const MAX_TENTATIVAS = 3 // 1 escrita + 2 reescritas

type Status = 'esperando' | 'escrevendo' | 'corrigindo' | 'pronto' | 'erro'

interface Resultado {
  item: ItemCatalogo
  post: PostCatalogo | null
  status: Status
  tentativas: number
  erro: string
  aprovado: boolean
  salvo: boolean
}

const EXEMPLO = `Bolo de pote — R$ 12,00 — 4 sabores, 250 g
Torta de limão — R$ 45,90 — inteira, serve 10 pessoas
Brigadeiro gourmet — R$ 3,50`

function nomeArquivo(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'locucao'
}

function CatalogoPosts() {
  const navigate = useNavigate()
  const { hasContentAgentFeature, trial, loading: subLoading, refresh, courtesyExpired } = useSubscription()

  const [nicho, setNicho] = useState('')
  const [tom, setTom] = useState(TOM_PADRAO)
  const [fatos, setFatos] = useState('')
  const [cta, setCta] = useState('')
  const [voz, setVoz] = useState(GEMINI_VOICES_TEXTO_LONGO[0]?.voice_id ?? 'Zephyr')
  const [catalogoTexto, setCatalogoTexto] = useState('')
  const [avisoMemoria, setAvisoMemoria] = useState('')

  const [resultados, setResultados] = useState<Resultado[]>([])
  const [gerando, setGerando] = useState(false)
  const [erroGeral, setErroGeral] = useState('')
  const [aviso, setAviso] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msgSalvo, setMsgSalvo] = useState('')
  const [copiado, setCopiado] = useState<number | null>(null)

  const [audioUrls, setAudioUrls] = useState<Record<number, string>>({})
  const audioBlobsRef = useRef<Record<number, Blob>>({})
  const [gerandoAudio, setGerandoAudio] = useState<number | null>(null)
  const [audioErros, setAudioErros] = useState<Record<number, string>>({})

  const itens = useMemo(() => lerCatalogo(catalogoTexto), [catalogoTexto])
  const itensUsados = itens.slice(0, MAX_ITENS_CATALOGO)

  // MEMÓRIA: quem já fez um Kit de WhatsApp já contou os fatos da marca — puxa do
  // último kit em vez de pedir de novo. Só preenche campo vazio e AVISA de onde veio.
  useEffect(() => {
    if (!hasContentAgentFeature) return
    let cancelado = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelado) return
      try {
        const kits = await listarKits(user.id)
        const ultimo = kits[0]
        if (!ultimo || cancelado) return
        // Updaters: se o cliente já começou a digitar, o que ele digitou vence.
        if (ultimo.nicho) setNicho((v) => v || ultimo.nicho)
        if (ultimo.fatos) setFatos((v) => v || ultimo.fatos)
        if (ultimo.cta) setCta((v) => v || ultimo.cta)
        if (ultimo.tom && TONS.some((t) => t.value === ultimo.tom)) setTom(ultimo.tom)
        if (ultimo.nicho || ultimo.fatos || ultimo.cta) {
          const quando = new Date(ultimo.updated_at || ultimo.created_at).toLocaleDateString('pt-BR')
          setAvisoMemoria(`Puxei nome, fatos e chamada do seu último Kit de WhatsApp (${quando}). Confira antes de criar.`)
        }
      } catch {
        // sem memória não é erro: o cliente preenche à mão
      }
    })()
    return () => { cancelado = true }
  }, [hasContentAgentFeature])

  // Libera os áudios ao sair.
  useEffect(() => () => { Object.values(audioUrls).forEach((u) => URL.revokeObjectURL(u)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function atualizar(idx: number, patch: Partial<Resultado>) {
    setResultados((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  function descartarAudio(idx: number) {
    delete audioBlobsRef.current[idx]
    setAudioUrls((prev) => {
      if (!prev[idx]) return prev
      URL.revokeObjectURL(prev[idx])
      const proximo = { ...prev }
      delete proximo[idx]
      return proximo
    })
  }

  async function escreverPost(
    item: ItemCatalogo, ganchosUsados: string[], falhas: string[], anterior: PostCatalogo | null,
  ): Promise<PostCatalogo> {
    const response = await fetchWithRetry(
      '/api/gemini/catalogo-posts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nicho, tom, fatos, cta, item, ganchosUsados, falhas, anterior }),
      },
      { onWait: (s) => setAviso(`⏳ Muita procura na IA agora — tentando de novo em ${s}s...`) },
    )
    setAviso('')
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new Error(friendlyApiError(response.status, data?.error))
    }
    const data = await safeJson(response)
    if (!data?.post?.legenda) throw new Error('A IA respondeu sem o post.')
    return data.post as PostCatalogo
  }

  // O CICLO do agente pra um produto: escreve → confere (código) → se reprovou, devolve
  // as falhas e reescreve, até MAX_TENTATIVAS. Na última, entrega como está: o cartão
  // fica vermelho e o portão (Aprovar) só abre quando o cliente corrigir.
  async function cicloDoAgente(i: number, item: ItemCatalogo, ganchos: string[]): Promise<PostCatalogo | null> {
    let anterior: PostCatalogo | null = null
    let falhas: string[] = []
    for (let t = 1; t <= MAX_TENTATIVAS; t++) {
      atualizar(i, { status: t === 1 ? 'escrevendo' : 'corrigindo', tentativas: t })
      try {
        const post = await escreverPost(item, ganchos, falhas, anterior)
        const conf = conferirPost(post, item, i, fatos)
        if (conf.aprovado || t === MAX_TENTATIVAS) {
          atualizar(i, { post, status: 'pronto', tentativas: t })
          return post
        }
        anterior = post
        falhas = conf.falhas
      } catch (err) {
        atualizar(i, { status: 'erro', erro: err instanceof Error ? err.message : 'Falhou ao escrever.' })
        return null
      }
    }
    return null
  }

  async function criarPosts() {
    if (!nicho.trim() || itensUsados.length === 0 || gerando) return
    setErroGeral('')
    setMsgSalvo('')

    if (trial.isTrial) {
      const { error: trialErr } = await supabase.rpc('use_trial_generation')
      if (trialErr) {
        await refresh()
        setErroGeral('Seu trial acabou. Assine para continuar criando.')
        return
      }
    }

    Object.keys(audioBlobsRef.current).forEach((k) => descartarAudio(Number(k)))
    setGerando(true)
    setResultados(itensUsados.map((item) => ({ item, post: null, status: 'esperando', tentativas: 0, erro: '', aprovado: false, salvo: false })))

    const ganchos: string[] = []
    let entregues = 0

    // Um produto por vez: cadência, não rajada (cota da IA) — e o cliente vê o agente
    // trabalhando cartão a cartão.
    for (let i = 0; i < itensUsados.length; i++) {
      const post = await cicloDoAgente(i, itensUsados[i], ganchos)
      if (post) {
        if (post.gancho) ganchos.push(post.gancho)
        entregues++
      }
    }

    setGerando(false)
    // Nada entregue = a geração do trial volta (o problema não foi do cliente).
    if (trial.isTrial) {
      if (entregues === 0) await devolverGeracaoTrial()
      void refresh()
    }
    if (entregues === 0) setErroGeral('A IA não conseguiu escrever agora. Nada foi cobrado — tente de novo em instantes.')
  }

  async function tentarDeNovo(idx: number) {
    const r = resultados[idx]
    if (!r || gerando) return
    const outros = resultados.filter((x, i) => i !== idx && x.post?.gancho).map((x) => x.post!.gancho)
    atualizar(idx, { erro: '', aprovado: false, salvo: false })
    await cicloDoAgente(idx, r.item, outros)
  }

  // Editou → a aprovação cai (o dono aprova o que está vendo) e a locução antiga sai.
  function editar(idx: number, campo: keyof PostCatalogo, valor: string) {
    setResultados((prev) => prev.map((r, i) => (i === idx && r.post ? { ...r, post: { ...r.post, [campo]: valor }, aprovado: false, salvo: false } : r)))
    if (campo === 'locucao') descartarAudio(idx)
  }

  async function gerarLocucao(idx: number) {
    const texto = resultados[idx]?.post?.locucao?.trim()
    if (!texto || gerandoAudio !== null) return
    setGerandoAudio(idx)
    setAudioErros((prev) => ({ ...prev, [idx]: '' }))
    try {
      const response = await fetchWithRetry(
        '/api/gemini/text-to-speech',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: texto, voiceName: voz }) },
        { onWait: (s) => setAudioErros((prev) => ({ ...prev, [idx]: `⏳ Muita procura — tentando de novo em ${s}s...` })) },
      )
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(friendlyApiError(response.status, data?.error))
      }
      const blob = await realcarVoz(await response.blob())
      descartarAudio(idx)
      audioBlobsRef.current[idx] = blob
      setAudioUrls((prev) => ({ ...prev, [idx]: URL.createObjectURL(blob) }))
      setAudioErros((prev) => ({ ...prev, [idx]: '' }))
    } catch (err) {
      setAudioErros((prev) => ({ ...prev, [idx]: err instanceof Error ? err.message : 'Não consegui gerar a locução.' }))
    } finally {
      setGerandoAudio(null)
    }
  }

  async function baixarLocucao(idx: number) {
    const blob = audioBlobsRef.current[idx]
    if (!blob) return
    const { blob: arquivo, ext } = await convertVoiceToMp3(blob)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(arquivo)
    a.download = `${String(idx + 1).padStart(2, '0')}-${nomeArquivo(resultados[idx].item.nome)}.${ext}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  async function copiar(idx: number) {
    const p = resultados[idx]?.post
    if (!p) return
    try {
      await navigator.clipboard.writeText(`${p.gancho}\n\n${p.legenda}`)
      setCopiado(idx)
      setTimeout(() => setCopiado(null), 2000)
    } catch {
      // clipboard bloqueado — sem feedback falso de "copiado"
    }
  }

  async function salvarAprovados() {
    const paraSalvar = resultados
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => r.post && r.aprovado && !r.salvo && conferirPost(r.post, r.item, i, fatos).aprovado)
    if (paraSalvar.length === 0 || salvando) return
    setSalvando(true)
    setMsgSalvo('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Sessão expirada — entre de novo.')
      const { error } = await supabase.from('contents').insert({
        user_id: user.id,
        nicho,
        // Mesmo formato do Super Agente (hook/roteiro/legenda) → Meus Conteúdos e a
        // Memória da Marca leem sem mudar nada. `produto`/`conferido` são extras.
        posts_json: paraSalvar.map(({ r }) => ({
          hook: r.post!.gancho,
          roteiro: r.post!.locucao,
          legenda: r.post!.legenda,
          vozSugerida: voz,
          produto: r.item.nome,
          origem: 'catalogo',
          conferido: true,
        })),
      })
      if (error) throw new Error(error.message)
      const salvos = new Set(paraSalvar.map(({ i }) => i))
      setResultados((prev) => prev.map((r, i) => (salvos.has(i) ? { ...r, salvo: true } : r)))
      setMsgSalvo(`${paraSalvar.length} ${paraSalvar.length === 1 ? 'post salvo' : 'posts salvos'} em Meus Conteúdos — e a IA passa a lembrar deles nas próximas gerações.`)
    } catch (err) {
      console.error('=== ERRO ao salvar posts do catálogo ===', err)
      setMsgSalvo(`Não consegui salvar agora (${err instanceof Error ? err.message : 'erro'}). Seus posts continuam aqui — tente de novo.`)
    } finally {
      setSalvando(false)
    }
  }

  if (subLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A]">
        <Loader2 className="w-8 h-8 animate-spin text-[#F59E0B]" />
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
            <h1 className="text-2xl font-bold mb-2">Catálogo → Posts 🔒</h1>
            <p className="text-gray-400 mb-6">
              Cole seus produtos e receba um post pronto pra cada um — texto e locução, conferidos
              contra o seu catálogo antes de você aprovar.
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

  const aprovadosNaoSalvos = resultados.filter((r, i) => r.post && r.aprovado && !r.salvo && conferirPost(r.post, r.item, i, fatos).aprovado).length
  const podeCriar = nicho.trim().length > 0 && itensUsados.length > 0 && !gerando

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <div className="container mx-auto p-4 py-8 max-w-4xl">
        <BackButton to="/dashboard" label="Voltar ao Painel" className="mb-6" />

        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <ShoppingBag className="w-8 h-8 text-[#F59E0B]" /> Catálogo → Posts
        </h1>
        <p className="text-gray-400 mb-6">
          Cole seus produtos. A IA escreve um post pra cada um, <strong className="text-white">confere preço,
          números e promessas contra o seu catálogo</strong> e corrige o que estiver errado. Você aprova o que vai pro ar.
        </p>

        {/* 1. A marca */}
        <section className="bg-[#111111] border border-gray-800 rounded-2xl p-5 mb-6 space-y-4">
          <h2 className="font-bold text-lg">1. Sua marca</h2>
          {avisoMemoria && (
            <p className="text-sm text-[#F59E0B] flex items-center gap-2"><Sparkles className="w-4 h-4 shrink-0" /> {avisoMemoria}</p>
          )}
          <div>
            <label className="text-sm text-gray-400">Nome ou nicho do negócio *</label>
            <input value={nicho} onChange={(e) => setNicho(e.target.value)} placeholder="Ex.: Doces da Cleide — confeitaria artesanal"
              className="w-full mt-1 bg-[#1A1A1A] border border-gray-700 rounded-lg px-3 py-2 text-white" />
          </div>
          <div>
            <label className="text-sm text-gray-400">Fatos da marca (entrega, pagamento, endereço, horário…)</label>
            <textarea value={fatos} onChange={(e) => setFatos(e.target.value)} rows={3}
              placeholder="Ex.: Entregamos no Centro e na Aldeota. Pix e cartão. Encomendas com 2 dias de antecedência."
              className="w-full mt-1 bg-[#1A1A1A] border border-gray-700 rounded-lg px-3 py-2 text-white text-sm" />
            <p className="text-xs text-gray-500 mt-1">A IA só promete entrega, desconto, parcelamento ou garantia se estiver escrito aqui ou no catálogo.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-400">Chamada pra ação</label>
              <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Ex.: Peça pelo WhatsApp"
                className="w-full mt-1 bg-[#1A1A1A] border border-gray-700 rounded-lg px-3 py-2 text-white" />
            </div>
            <div>
              <label className="text-sm text-gray-400">Voz da locução</label>
              <select value={voz} onChange={(e) => setVoz(e.target.value)}
                className="w-full mt-1 bg-[#1A1A1A] border border-gray-700 rounded-lg px-3 py-2 text-white">
                {GEMINI_VOICES_TEXTO_LONGO.map((v) => (
                  <option key={v.voice_id} value={v.voice_id}>{v.name}{v.vibe ? ` — ${v.vibe}` : ''}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {TONS.map((t) => (
              <button key={t.value} type="button" onClick={() => setTom(t.value)}
                className={`px-3 py-1.5 rounded-full text-sm border ${tom === t.value ? 'bg-[#F59E0B] border-[#F59E0B] text-black font-bold' : 'bg-[#1A1A1A] border-gray-700 text-gray-300'}`}>
                {t.emoji} {t.value}
              </button>
            ))}
          </div>
        </section>

        {/* 2. O catálogo */}
        <section className="bg-[#111111] border border-gray-800 rounded-2xl p-5 mb-6 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-bold text-lg">2. Seus produtos</h2>
            {!catalogoTexto && (
              <button type="button" onClick={() => setCatalogoTexto(EXEMPLO)} className="text-sm text-[#F59E0B] underline">ver um exemplo</button>
            )}
          </div>
          <p className="text-sm text-gray-400">Um produto por linha: <strong className="text-gray-200">nome — preço — detalhes</strong>. Pode colar da planilha. Até {MAX_ITENS_CATALOGO} por vez.</p>
          <textarea value={catalogoTexto} onChange={(e) => setCatalogoTexto(e.target.value)} rows={6}
            placeholder={EXEMPLO}
            className="w-full bg-[#1A1A1A] border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono" />
          {itens.length > 0 && (
            <div className="text-sm space-y-1">
              {itensUsados.map((it, i) => (
                <p key={i} className="text-gray-300">
                  <span className="text-gray-500">{i + 1}.</span> <strong>{it.nome}</strong>
                  {' · '}{it.preco ? <span className="text-[#22C55E]">{it.preco}</span> : <span className="text-amber-400">sem preço (o post não vai citar preço)</span>}
                  {it.detalhes && <span className="text-gray-500"> · {it.detalhes}</span>}
                </p>
              ))}
              {itens.length > MAX_ITENS_CATALOGO && (
                <p className="text-amber-400">Só os {MAX_ITENS_CATALOGO} primeiros entram nesta rodada ({itens.length - MAX_ITENS_CATALOGO} ficam pra próxima).</p>
              )}
            </div>
          )}
          <Button onClick={criarPosts} disabled={!podeCriar}
            className="w-full bg-gradient-to-r from-[#F59E0B] to-[#EF4444] hover:opacity-90 disabled:opacity-50 font-bold py-6 text-lg flex items-center justify-center gap-2">
            {gerando ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
            {gerando ? 'O agente está escrevendo e conferindo…' : `Criar ${itensUsados.length || ''} ${itensUsados.length === 1 ? 'post' : 'posts'} com conferência`}
          </Button>
          {trial.isTrial && <p className="text-xs text-gray-500 text-center">Usa 1 das suas {trial.generationsLeft} gerações do teste grátis (o catálogo inteiro). Correções e locução não contam.</p>}
          {aviso && <p className="text-sm text-amber-400 text-center">{aviso}</p>}
          {erroGeral && <p className="text-sm text-red-400 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {erroGeral}</p>}
        </section>

        {/* 3. Os posts, conferidos */}
        {resultados.length > 0 && (
          <section className="space-y-4 mb-6">
            <h2 className="font-bold text-lg">3. Confira e aprove</h2>
            <p className="text-sm text-gray-400 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#22C55E] shrink-0" />
              A conferência é feita por código, não pela IA: compara cada preço, número e promessa com o seu catálogo e os fatos acima.
            </p>
            {resultados.map((r, i) => {
              const conf = r.post ? conferirPost(r.post, r.item, i, fatos) : null
              return (
                <div key={i} className={`bg-[#111111] border rounded-2xl p-5 space-y-3 ${r.aprovado ? 'border-[#22C55E]' : conf && !conf.aprovado ? 'border-red-800' : 'border-gray-800'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold">{i + 1}. {r.item.nome}</h3>
                    {r.status === 'pronto' && r.tentativas > 1 && (
                      <span className="text-xs text-gray-500 shrink-0">corrigido {r.tentativas - 1}x pelo agente</span>
                    )}
                  </div>

                  {(r.status === 'esperando' || r.status === 'escrevendo' || r.status === 'corrigindo') && (
                    <p className="text-sm text-gray-400 flex items-center gap-2">
                      {r.status === 'esperando' ? '⏳ Na fila' : <><Loader2 className="w-4 h-4 animate-spin" /> {r.status === 'escrevendo' ? 'Escrevendo…' : `A conferência achou problema — reescrevendo (tentativa ${r.tentativas} de ${MAX_TENTATIVAS})…`}</>}
                    </p>
                  )}

                  {r.status === 'erro' && (
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-sm text-red-400 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {r.erro}</p>
                      {!gerando && (
                        <Button onClick={() => tentarDeNovo(i)} className="bg-[#1A1A1A] hover:bg-[#252525] text-sm flex items-center gap-2">
                          <RotateCcw className="w-4 h-4" /> Tentar de novo
                        </Button>
                      )}
                    </div>
                  )}

                  {r.post && r.status === 'pronto' && conf && (
                    <>
                      <div>
                        <label className="text-xs text-gray-500">Gancho</label>
                        <input value={r.post.gancho} onChange={(e) => editar(i, 'gancho', e.target.value)}
                          className="w-full bg-[#1A1A1A] border border-gray-700 rounded-lg px-3 py-2 text-white font-medium" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Legenda</label>
                        <textarea value={r.post.legenda} onChange={(e) => editar(i, 'legenda', e.target.value)} rows={6}
                          className="w-full bg-[#1A1A1A] border border-gray-700 rounded-lg px-3 py-2 text-gray-200 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Locução (texto falado)</label>
                        <textarea value={r.post.locucao} onChange={(e) => editar(i, 'locucao', e.target.value)} rows={3}
                          className="w-full bg-[#1A1A1A] border border-gray-700 rounded-lg px-3 py-2 text-gray-200 text-sm" />
                      </div>

                      <TravaAcento
                        textos={[r.post.gancho, r.post.legenda, r.post.locucao]}
                        onCorrigir={() => {
                          // Só mexe no campo que muda: editar a locução descarta o áudio já gerado.
                          for (const campo of ['gancho', 'legenda', 'locucao'] as const) {
                            const certo = corrigirAcentos(r.post![campo])
                            if (certo !== r.post![campo]) editar(i, campo, certo)
                          }
                        }}
                      />

                      <ul className="text-sm space-y-1 bg-[#0A0A0A] rounded-lg p-3">
                        {conf.checagens.map((c, k) => (
                          <li key={k} className={`flex items-start gap-2 ${c.ok ? 'text-[#22C55E]' : 'text-red-400'}`}>
                            {c.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />} {c.texto}
                          </li>
                        ))}
                        {!conf.aprovado && (
                          <li className="text-amber-400 text-xs pt-1">Corrija o texto acima (ou acrescente o fato que falta na seção 1) — a conferência refaz sozinha.</li>
                        )}
                        <li className="text-gray-500 text-xs pt-1">A conferência checa preço, números e promessas. O sentido da frase é com você: leia antes de aprovar.</li>
                      </ul>

                      <div className="flex flex-wrap gap-2 items-center">
                        <Button
                          onClick={() => atualizar(i, { aprovado: !r.aprovado })}
                          disabled={!conf.aprovado || r.salvo}
                          className={`text-sm font-bold flex items-center gap-2 disabled:opacity-50 ${r.aprovado ? 'bg-[#22C55E] hover:bg-[#16A34A]' : 'bg-[#1A1A1A] hover:bg-[#252525] border border-[#22C55E]'}`}
                        >
                          <Check className="w-4 h-4" /> {r.salvo ? 'Salvo' : r.aprovado ? 'Aprovado' : 'Aprovar'}
                        </Button>
                        <Button onClick={() => copiar(i)} className="bg-[#1A1A1A] hover:bg-[#252525] text-sm flex items-center gap-2">
                          {copiado === i ? <Check className="w-4 h-4 text-[#22C55E]" /> : <Copy className="w-4 h-4" />} Copiar texto
                        </Button>
                        <Button onClick={() => gerarLocucao(i)} disabled={gerandoAudio !== null || !r.post.locucao.trim()}
                          className="bg-[#1A1A1A] hover:bg-[#252525] text-sm flex items-center gap-2 disabled:opacity-50">
                          {gerandoAudio === i ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                          {audioUrls[i] ? 'Gerar de novo' : 'Gerar locução'}
                        </Button>
                        {audioUrls[i] && (
                          <Button onClick={() => baixarLocucao(i)} className="bg-[#1A1A1A] hover:bg-[#252525] text-sm flex items-center gap-2">
                            <Download className="w-4 h-4" /> Baixar MP3
                          </Button>
                        )}
                      </div>
                      {audioUrls[i] && <audio controls src={audioUrls[i]} className="w-full" />}
                      {audioErros[i] && <p className="text-sm text-amber-400">{audioErros[i]}</p>}
                    </>
                  )}
                </div>
              )
            })}
          </section>
        )}

        {resultados.some((r) => r.post) && !gerando && (
          <section className="bg-[#111111] border border-gray-800 rounded-2xl p-5 space-y-3">
            <Button onClick={salvarAprovados} disabled={aprovadosNaoSalvos === 0 || salvando}
              className="w-full bg-[#22C55E] hover:bg-[#16A34A] disabled:opacity-50 font-bold py-5 flex items-center justify-center gap-2">
              {salvando ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
              {aprovadosNaoSalvos > 0 ? `Salvar ${aprovadosNaoSalvos} ${aprovadosNaoSalvos === 1 ? 'aprovado' : 'aprovados'} em Meus Conteúdos` : 'Aprove os posts que você quer guardar'}
            </Button>
            {msgSalvo && (
              <p className="text-sm text-gray-300 text-center">
                {msgSalvo}{' '}
                {msgSalvo.includes('salvo') && (
                  <button type="button" onClick={() => navigate({ to: '/meus-conteudos' })} className="text-[#F59E0B] underline">Abrir Meus Conteúdos</button>
                )}
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
