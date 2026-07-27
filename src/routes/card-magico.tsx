import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Lock, Loader2, ImagePlus, Sparkles, Download, Copy, Check, X, AlertCircle, Wand2,
} from 'lucide-react'
import { useSubscription, devolverGeracaoTrial } from '../lib/useSubscription'
import { supabase } from '../lib/supabase'
import { fetchWithRetry, safeJson, friendlyApiError } from '../lib/apiRetry'
import { Button } from '../components/ui/button'
import { BackButton } from '../components/BackButton'
import { TONS, TOM_PADRAO } from '../lib/tons'

export const Route = createFileRoute('/card-magico')({
  component: CardMagico,
})

// Card final no formato retrato 4:5 (o que mais aparece no feed do Instagram sem corte).
const CARD_W = 1080
const CARD_H = 1350
// Ao subir, redimensionamos a imagem pra no máx. 1080px no maior lado: mantém o card
// nítido e deixa o payload pro Gemini pequeno (evita estourar o limite de body da Edge).
const MAX_UPLOAD_DIM = 1080

const MIMES_OK = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']

// Lê o arquivo, redimensiona no navegador e devolve uma data URL JPEG (menor e universal).
function redimensionarImagem(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Não consegui ler a imagem.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Imagem inválida ou corrompida.'))
      img.onload = () => {
        const escala = Math.min(1, MAX_UPLOAD_DIM / Math.max(img.width, img.height))
        const w = Math.round(img.width * escala)
        const h = Math.round(img.height * escala)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Canvas indisponível neste navegador.'))
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = typeof reader.result === 'string' ? reader.result : ''
    }
    reader.readAsDataURL(file)
  })
}

// Traça um caminho de retângulo com cantos arredondados (pra recortar/contornar a foto).
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

// Quebra o texto em linhas que cabem em `maxWidth`, respeitando quebras manuais (\n).
function wrapText(ctx: CanvasRenderingContext2D, texto: string, maxWidth: number): string[] {
  const linhas: string[] = []
  for (const paragrafo of texto.split('\n')) {
    if (paragrafo.trim() === '') { linhas.push(''); continue }
    let atual = ''
    for (const palavra of paragrafo.split(/\s+/)) {
      const teste = atual ? `${atual} ${palavra}` : palavra
      if (ctx.measureText(teste).width <= maxWidth || !atual) {
        atual = teste
      } else {
        linhas.push(atual)
        atual = palavra
      }
    }
    if (atual) linhas.push(atual)
  }
  return linhas
}

function CardMagico() {
  const navigate = useNavigate()
  const { hasContentAgentFeature, trial, loading: subLoading, refresh } = useSubscription()

  const [imagemDataUrl, setImagemDataUrl] = useState<string | null>(null)
  const [tom, setTom] = useState(TOM_PADRAO)
  const [contexto, setContexto] = useState('')
  const [legenda, setLegenda] = useState('')
  const [gerando, setGerando] = useState(false)
  const [erro, setErro] = useState('')
  const [uploadErro, setUploadErro] = useState('')
  const [rateNotice, setRateNotice] = useState('')
  const [copiado, setCopiado] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleUpload(file: File | undefined) {
    setUploadErro('')
    if (!file) return
    if (!MIMES_OK.includes(file.type)) {
      setUploadErro('Formato inválido. Use PNG, JPG ou WEBP.')
      return
    }
    if (file.size > 12 * 1024 * 1024) {
      setUploadErro('Imagem muito grande (máx 12MB).')
      return
    }
    try {
      const dataUrl = await redimensionarImagem(file)
      setImagemDataUrl(dataUrl)
      setLegenda('')
      setErro('')
    } catch (err) {
      setUploadErro(err instanceof Error ? err.message : 'Não consegui processar essa imagem.')
    }
  }

  async function handleGerar() {
    if (!imagemDataUrl || gerando) return

    // Trial: cada legenda gerada consome 1 das 10 gerações (é conteúdo de IA). O
    // servidor valida os 7 dias + limite; se falhar, o trial acabou.
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
        '/api/gemini/gerar-legenda',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imagemBase64: imagemDataUrl, mimeType: 'image/jpeg', tom, contexto }),
        },
        { onWait: (s) => setRateNotice(`⏳ Muita procura agora — tentando de novo em ${s}s...`) },
      )
      setRateNotice('')

      if (!response.ok) {
        const errData = await response.json().catch(() => null)
        // A IA não entregou nada: devolve a geração pro trial não queimar à toa.
        if (trial.isTrial) await devolverGeracaoTrial()
        throw new Error(friendlyApiError(response.status, errData?.error))
      }

      const data = await safeJson(response)
      if (!data.legenda) {
        if (trial.isTrial) await devolverGeracaoTrial()
        throw new Error('A IA não retornou uma legenda. Tente de novo.')
      }
      setLegenda(data.legenda)
    } catch (err) {
      setRateNotice('')
      setErro(err instanceof Error ? err.message : 'Não foi possível gerar a legenda agora.')
    } finally {
      setGerando(false)
    }
  }

  // (Re)desenha o card sempre que a imagem ou a legenda mudarem.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !imagemDataUrl || !legenda) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.onload = () => {
      canvas.width = CARD_W
      canvas.height = CARD_H

      // Fundo preto premium.
      ctx.fillStyle = '#0B0B0D'
      ctx.fillRect(0, 0, CARD_W, CARD_H)

      // MOLDURA DA FOTO: adapta ao formato da imagem (contain, SEM cortar e SEM barras
      // feias — o cartão "abraça" a foto), cantos arredondados, flutuando no preto com
      // margem. Resolve o card antigo, que colava a foto full-bleed nas bordas.
      const M = 56 // margem externa
      const areaW = CARD_W - M * 2
      const areaMaxH = 720 // teto da altura da foto, pra sobrar espaço pra legenda
      const escala = Math.min(areaW / img.width, areaMaxH / img.height)
      const frameW = Math.round(img.width * escala)
      const frameH = Math.round(img.height * escala)
      const frameX = Math.round((CARD_W - frameW) / 2)
      const frameY = M
      const raio = 28

      ctx.save()
      roundRectPath(ctx, frameX, frameY, frameW, frameH, raio)
      ctx.clip()
      ctx.drawImage(img, frameX, frameY, frameW, frameH)
      ctx.restore()

      // Contorno sutil, pra separar a foto do fundo quando ela tem bordas escuras.
      roundRectPath(ctx, frameX, frameY, frameW, frameH, raio)
      ctx.lineWidth = 2
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.stroke()

      // LEGENDA: centralizada, auto-ajuste de fonte, centrada verticalmente no espaço
      // abaixo da foto, com bom espaçamento entre linhas.
      const padding = 72
      const capTop = frameY + frameH + 56
      const capBottom = CARD_H - 92 // deixa espaço pra assinatura
      const maxWidth = CARD_W - padding * 2

      let fontSize = 46
      let linhas: string[] = []
      let lineHeight = 0
      while (fontSize >= 22) {
        ctx.font = `500 ${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
        lineHeight = Math.round(fontSize * 1.4)
        linhas = wrapText(ctx, legenda, maxWidth)
        if (linhas.length * lineHeight <= capBottom - capTop) break
        fontSize -= 2
      }

      ctx.fillStyle = '#F3F3F3'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const totalTextH = linhas.length * lineHeight
      let y = capTop + Math.max(0, (capBottom - capTop - totalTextH) / 2)
      for (const linha of linhas) {
        ctx.fillText(linha, CARD_W / 2, y)
        y += lineHeight
      }

      // Assinatura discreta, centralizada no rodapé.
      ctx.font = '600 24px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
      ctx.fillStyle = 'rgba(139,92,246,0.9)'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText('VoiceFlow IA', CARD_W / 2, CARD_H - 52)
      ctx.textAlign = 'left' // reset pro próximo desenho
    }
    img.src = imagemDataUrl
  }, [imagemDataUrl, legenda])

  function handleDownload() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `card-voiceflow-${Date.now()}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  async function handleCopiar() {
    if (!legenda) return
    try {
      await navigator.clipboard.writeText(legenda)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // clipboard bloqueado — ignora silenciosamente
    }
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
            <h1 className="text-2xl font-bold mb-2">Card Mágico 🔒</h1>
            <p className="text-gray-400 mb-6">
              Suba a foto de um produto e a IA cria uma legenda magnética + um card pronto
              pra postar. Disponível nos planos Crescimento e Dominação.
            </p>
            <Button onClick={() => navigate({ to: '/precos' })} className="bg-[#8B5CF6] hover:bg-[#7C3AED]">
              Ver Planos
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <div className="container mx-auto p-4 py-8 max-w-5xl">
        <BackButton to="/dashboard" label="Voltar" className="mb-4" />

        <div className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Wand2 className="w-8 h-8 text-[#8B5CF6]" />
            Card Mágico
          </h1>
          <p className="text-gray-400 mt-1">
            Suba a foto de um produto que você vende. A IA escreve a legenda que vende e monta
            um card pronto pra baixar e postar.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Coluna esquerda: entrada */}
          <div className="space-y-5">
            {/* Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Foto do produto</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => handleUpload(e.target.files?.[0])}
              />
              {imagemDataUrl ? (
                <div className="relative rounded-xl overflow-hidden border border-gray-800">
                  <img src={imagemDataUrl} alt="Produto enviado" className="w-full max-h-72 object-contain bg-black" />
                  <button
                    type="button"
                    onClick={() => { setImagemDataUrl(null); setLegenda(''); if (fileInputRef.current) fileInputRef.current.value = '' }}
                    className="absolute top-2 right-2 bg-black/70 hover:bg-black text-white rounded-full p-1.5"
                    aria-label="Remover imagem"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-700 hover:border-[#8B5CF6] rounded-xl py-12 flex flex-col items-center justify-center gap-2 text-gray-400 hover:text-white transition-colors"
                >
                  <ImagePlus className="w-8 h-8" />
                  <span className="font-medium">Clique para enviar</span>
                  <span className="text-xs text-gray-500">PNG, JPG ou WEBP — até 12MB</span>
                </button>
              )}
              {uploadErro && (
                <p className="text-red-400 text-sm mt-2 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" /> {uploadErro}
                </p>
              )}
            </div>

            {/* Tom de voz */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Tom de voz</label>
              <select
                value={tom}
                onChange={(e) => setTom(e.target.value)}
                className="w-full bg-[#111111] border border-gray-800 rounded-lg px-3 py-2.5 text-white focus:border-[#8B5CF6] focus:outline-none"
              >
                {TONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.value} — {t.dica}</option>
                ))}
              </select>
            </div>

            {/* Contexto opcional */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Contexto do produto <span className="text-gray-500 font-normal">(opcional)</span>
              </label>
              <textarea
                value={contexto}
                onChange={(e) => setContexto(e.target.value)}
                rows={3}
                placeholder="Ex: tênis de corrida masculino, promoção de R$ 199, entrega grátis na região"
                className="w-full bg-[#111111] border border-gray-800 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 focus:border-[#8B5CF6] focus:outline-none resize-none"
              />
              <p className="text-xs text-gray-500 mt-1">
                Quanto mais específico, menos genérica a legenda fica.
              </p>
            </div>

            <Button
              onClick={handleGerar}
              disabled={!imagemDataUrl || gerando}
              className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED] py-6 text-lg font-bold disabled:opacity-50"
            >
              {gerando ? (
                <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Gerando legenda...</>
              ) : (
                <><Sparkles className="w-5 h-5 mr-2" /> {legenda ? 'Gerar de novo' : 'Gerar legenda'}</>
              )}
            </Button>

            {rateNotice && <p className="text-amber-400 text-sm text-center">{rateNotice}</p>}
            {erro && (
              <p className="text-red-400 text-sm flex items-center gap-1">
                <AlertCircle className="w-4 h-4" /> {erro}
              </p>
            )}
          </div>

          {/* Coluna direita: resultado */}
          <div className="space-y-5">
            {legenda ? (
              <>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-300">Legenda (pode editar)</label>
                    <button
                      type="button"
                      onClick={handleCopiar}
                      className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
                    >
                      {copiado ? <><Check className="w-3.5 h-3.5" /> Copiado</> : <><Copy className="w-3.5 h-3.5" /> Copiar</>}
                    </button>
                  </div>
                  <textarea
                    value={legenda}
                    onChange={(e) => setLegenda(e.target.value)}
                    rows={6}
                    className="w-full bg-[#111111] border border-gray-800 rounded-lg px-3 py-2.5 text-white focus:border-[#8B5CF6] focus:outline-none resize-none text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Card pronto (1080×1350)</label>
                  <div className="rounded-xl overflow-hidden border border-gray-800 bg-black">
                    <canvas ref={canvasRef} className="w-full h-auto block" />
                  </div>
                </div>

                <Button onClick={handleDownload} className="w-full bg-[#22C55E] hover:bg-[#16A34A] py-5 font-bold">
                  <Download className="w-5 h-5 mr-2" /> Baixar card para publicação
                </Button>
              </>
            ) : (
              <div className="border border-gray-800 rounded-xl h-full min-h-[320px] flex flex-col items-center justify-center text-center p-8 text-gray-500">
                <Sparkles className="w-10 h-10 mb-3 text-gray-700" />
                <p className="font-medium text-gray-400">Seu card aparece aqui</p>
                <p className="text-sm mt-1">Envie uma foto, escolha o tom e clique em “Gerar legenda”.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
