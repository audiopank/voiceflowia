import { useEffect, useRef, useState } from 'react'
import { Loader2, AlertCircle, CheckCircle2, Upload, Trash2, Eye, EyeOff, ArrowUp, ArrowDown, RectangleHorizontal, RectangleVertical } from 'lucide-react'
import {
  listarVideosAdmin,
  criarVideo,
  criarVideoYoutube,
  apagarVideo,
  alternarAtivo,
  alternarVertical,
  atualizarOrdem,
  gerarPoster,
  extrairYoutubeId,
  youtubeThumb,
  MAX_VIDEO_BYTES,
  TIPOS_VIDEO_ACEITOS,
  type VideoFundador,
} from '../../lib/videos'
import { Button } from '../ui/button'
import { Field, inputClass } from './shared'

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

export function VideosFundador() {
  const [loading, setLoading] = useState(true)
  const [videos, setVideos] = useState<VideoFundador[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [modo, setModo] = useState<'youtube' | 'upload'>('youtube')
  const [titulo, setTitulo] = useState('')
  const [frase, setFrase] = useState('')
  const [linkYoutube, setLinkYoutube] = useState('')
  const [vertical, setVertical] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [etapa, setEtapa] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const youtubeId = extrairYoutubeId(linkYoutube)
  const podeEnviar = titulo.trim() && (modo === 'youtube' ? !!youtubeId : !!file)

  async function carregar() {
    setError('')
    try {
      setVideos(await listarVideosAdmin())
    } catch (err) {
      console.error('Erro ao listar vídeos:', err)
      setError('Não consegui carregar os vídeos. O CREATE_FOUNDER_VIDEOS_TABLE.sql já foi rodado no Supabase?')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void carregar()
  }, [])

  function escolherArquivo(f: File | undefined) {
    setError('')
    setFile(null)
    if (!f) return
    if (!TIPOS_VIDEO_ACEITOS.includes(f.type)) {
      setError('Formato inválido. Use MP4, WebM ou MOV.')
      return
    }
    if (f.size > MAX_VIDEO_BYTES) {
      setError(
        `Vídeo muito grande (${formatMB(f.size)}). O upload direto trava em ${formatMB(MAX_VIDEO_BYTES)} — é teto do plano grátis da Supabase, não dá pra aumentar. Para vídeo longo, suba no seu canal do YouTube e use a opção "Link do YouTube" aqui em cima: sem limite de duração.`,
      )
      return
    }
    setFile(f)
  }

  async function enviar() {
    if (!podeEnviar) return
    setEnviando(true)
    setError('')
    setSuccess('')
    try {
      const proximaOrdem = videos.length ? Math.max(...videos.map((v) => v.sort_order)) + 1 : 1

      if (modo === 'youtube') {
        setEtapa('Publicando...')
        await criarVideoYoutube(titulo.trim(), frase, youtubeId!, vertical, proximaOrdem)
      } else {
        setEtapa('Gerando miniatura...')
        const poster = await gerarPoster(file!)
        setEtapa('Enviando vídeo...')
        await criarVideo({ titulo: titulo.trim(), frase, file: file!, poster, vertical, sortOrder: proximaOrdem })
      }

      setSuccess('Vídeo publicado! Já está no ar na página de preços e em /videos.')
      setTitulo('')
      setFrase('')
      setLinkYoutube('')
      setVertical(false)
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      await carregar()
    } catch (err) {
      console.error('Erro ao enviar vídeo:', err)
      // Causa mais comum e SQL pendente. Cita os arquivos na ordem em que
      // precisam rodar, em vez de chutar um so — errar o arquivo aqui manda o
      // Mestre procurar problema no lugar errado.
      setError(
        'Não consegui publicar o vídeo. A causa mais comum é migração pendente no Supabase — rode, nesta ordem: CREATE_FOUNDER_VIDEOS_TABLE.sql, MIGRATION_FOUNDER_VIDEOS_YOUTUBE.sql e MIGRATION_FOUNDER_VIDEOS_VERTICAL.sql.',
      )
    } finally {
      setEnviando(false)
      setEtapa('')
    }
  }

  async function handleApagar(video: VideoFundador) {
    if (!window.confirm(`Apagar "${video.titulo}"? O arquivo também será removido.`)) return
    setError('')
    try {
      await apagarVideo(video)
      await carregar()
    } catch (err) {
      console.error('Erro ao apagar vídeo:', err)
      setError('Não consegui apagar o vídeo agora.')
    }
  }

  async function handleAlternar(video: VideoFundador) {
    const { error: err } = await alternarAtivo(video.id, !video.active)
    if (err) return setError('Não consegui mudar a visibilidade agora.')
    await carregar()
  }

  async function handleVirarOrientacao(video: VideoFundador) {
    setError('')
    const { error: err } = await alternarVertical(video.id, !video.vertical)
    if (err) return setError('Não consegui mudar a orientação. O MIGRATION_FOUNDER_VIDEOS_VERTICAL.sql já foi rodado?')
    await carregar()
  }

  // Troca a posição com o vizinho: o admin ordena clicando, sem digitar número.
  // Se o segundo update falhar, desfaz o primeiro: sem isso os dois ficariam com
  // o MESMO sort_order, e a partir daí toda troca nesse par vira no-op (travado).
  async function mover(index: number, direcao: -1 | 1) {
    const alvo = index + direcao
    if (alvo < 0 || alvo >= videos.length) return
    const a = videos[index]
    const b = videos[alvo]

    const { error: e1 } = await atualizarOrdem(a.id, b.sort_order)
    if (e1) return setError('Não consegui reordenar agora.')

    const { error: e2 } = await atualizarOrdem(b.id, a.sort_order)
    if (e2) {
      await atualizarOrdem(a.id, a.sort_order)
      return setError('Não consegui reordenar agora.')
    }
    await carregar()
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-[#8B5CF6]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-4 bg-red-900/30 border border-red-700 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <span className="text-red-300 text-sm">{error}</span>
        </div>
      )}
      {success && (
        <div className="p-4 bg-green-900/20 border border-green-700 rounded-xl flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-[#22C55E] shrink-0 mt-0.5" />
          <span className="text-green-300 text-sm">{success}</span>
        </div>
      )}

      <div className="bg-[#111111] border border-gray-800 rounded-2xl p-6 space-y-4">
        <div>
          <h3 className="text-lg font-bold text-white">Novo vídeo</h3>
          <p className="text-sm text-gray-500">
            Vídeo seu, como criador do VoiceFlow IA. Grave na horizontal ou vertical — a página se adapta.
          </p>
        </div>

        <div className="flex gap-2">
          {([
            { key: 'youtube', label: '▶️ Link do YouTube', dica: 'Qualquer duração' },
            { key: 'upload', label: '⬆️ Enviar arquivo', dica: `Até ${formatMB(MAX_VIDEO_BYTES)}` },
          ] as const).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => {
                setModo(m.key)
                setError('')
              }}
              className={`flex-1 p-3 rounded-lg border text-left transition-colors ${
                modo === m.key
                  ? 'border-[#8B5CF6] bg-[#8B5CF6]/10 text-white'
                  : 'border-gray-700 bg-[#1A1A1A] text-gray-400 hover:border-gray-600'
              }`}
            >
              <span className="block text-sm font-medium">{m.label}</span>
              <span className="block text-xs text-gray-500 mt-0.5">{m.dica}</span>
            </button>
          ))}
        </div>

        {modo === 'youtube' && (
          <p className="text-xs text-gray-500 bg-[#1A1A1A] border border-gray-800 rounded-lg p-3">
            Vídeo longo (4 min, 10 min) tem que ir por aqui: o plano grátis da Supabase trava upload
            em {formatMB(MAX_VIDEO_BYTES)}, e servir vídeo pesado pela nossa conta queimaria a cota de
            banda. Pelo YouTube a duração é livre, não custa banda e ainda alimenta o seu canal.
          </p>
        )}

        <Field label="Título" hint="O que esse vídeo mostra. Ex: “Monto o mês de um cliente em 4 minutos”">
          <input
            type="text"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Monto o mês de um cliente em 4 minutos"
            className={inputClass}
          />
        </Field>

        <Field label="Frase de destaque (opcional)" hint="Aparece abaixo do vídeo, como legenda de apoio.">
          <input
            type="text"
            value={frase}
            onChange={(e) => setFrase(e.target.value)}
            placeholder="Antes eu perdia o dia montando conteúdo. Hoje levo minutos."
            className={inputClass}
          />
        </Field>

        {modo === 'youtube' ? (
          <Field label="Link do vídeo no YouTube" hint="Cole o link normal, o de compartilhar (youtu.be) ou o de Shorts.">
            <input
              type="text"
              value={linkYoutube}
              onChange={(e) => setLinkYoutube(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className={inputClass}
            />
            {linkYoutube.trim() && !youtubeId && (
              <p className="text-xs text-red-400 mt-1">
                Não reconheci um vídeo do YouTube nesse link. Confira se copiou inteiro.
              </p>
            )}
            {youtubeId && (
              <div className="flex items-center gap-3 mt-2">
                <img src={youtubeThumb(youtubeId)} alt="" className="w-28 rounded-md border border-gray-800" />
                <span className="text-xs text-[#22C55E]">Vídeo reconhecido ✓</span>
              </div>
            )}
          </Field>
        ) : (
          <Field label="Arquivo" hint={`MP4, WebM ou MOV — até ${formatMB(MAX_VIDEO_BYTES)}.`}>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime"
              onChange={(e) => escolherArquivo(e.target.files?.[0])}
              className="w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#8B5CF6] file:text-white file:text-sm file:font-medium hover:file:bg-[#7C3AED] file:cursor-pointer"
            />
            {file && <p className="text-xs text-gray-500 mt-1">{file.name} · {formatMB(file.size)}</p>}
          </Field>
        )}

        <Field label="Como você gravou?" hint="O card na página se ajusta ao formato — errou? dá pra trocar depois, sem recadastrar.">
          <div className="flex gap-2">
            {([
              { v: false, label: 'Horizontal', dica: 'Deitado (16:9)', Icone: RectangleHorizontal },
              { v: true, label: 'Vertical', dica: 'Em pé, celular (9:16)', Icone: RectangleVertical },
            ] as const).map(({ v, label, dica, Icone }) => (
              <button
                key={label}
                type="button"
                onClick={() => setVertical(v)}
                className={`flex-1 p-3 rounded-lg border text-left transition-colors ${
                  vertical === v
                    ? 'border-[#8B5CF6] bg-[#8B5CF6]/10 text-white'
                    : 'border-gray-700 bg-[#1A1A1A] text-gray-400 hover:border-gray-600'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Icone className="w-4 h-4" />
                  {label}
                </span>
                <span className="block text-xs text-gray-500 mt-0.5">{dica}</span>
              </button>
            ))}
          </div>
        </Field>

        <Button
          onClick={enviar}
          disabled={enviando || !podeEnviar}
          className="bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 flex items-center gap-2"
        >
          {enviando ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {etapa || 'Enviando...'}
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              Publicar vídeo
            </>
          )}
        </Button>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-bold text-white">
          Vídeos publicados {videos.length > 0 && <span className="text-gray-500 font-normal text-sm">({videos.length})</span>}
        </h3>

        {videos.length === 0 ? (
          <div className="p-8 text-center bg-[#111111] border border-gray-800 rounded-2xl">
            <p className="text-gray-500 text-sm">
              Nenhum vídeo ainda. Enquanto não houver nenhum, a seção nem aparece nas páginas públicas.
            </p>
          </div>
        ) : (
          videos.map((video, index) => (
            <div
              key={video.id}
              className={`bg-[#111111] border rounded-2xl p-4 flex items-start gap-4 ${video.active ? 'border-gray-800' : 'border-gray-800/50 opacity-60'}`}
            >
              {(() => {
                const thumb = video.youtube_id ? youtubeThumb(video.youtube_id) : video.poster_url
                return thumb ? (
                  <img src={thumb} alt="" className="w-24 h-32 object-cover rounded-lg bg-black shrink-0" />
                ) : (
                  <div className="w-24 h-32 rounded-lg bg-[#0A0A0A] border border-gray-800 shrink-0" />
                )
              })()}

              <div className="flex-1 min-w-0">
                <p className="text-white font-medium">{video.titulo}</p>
                {video.frase && <p className="text-sm text-gray-400 mt-0.5">“{video.frase}”</p>}
                <p className="text-xs text-gray-600 mt-1">
                  {video.youtube_id ? 'YouTube' : 'Arquivo próprio'} ·{' '}
                  {video.vertical ? 'Vertical' : 'Horizontal'} ·{' '}
                  {video.active ? 'Visível nas páginas públicas' : 'Oculto'}
                </p>

                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    onClick={() => mover(index, -1)}
                    disabled={index === 0}
                    title="Subir"
                    className="text-xs px-2 py-1 rounded-md bg-[#1A1A1A] border border-gray-700 text-gray-300 disabled:opacity-30 hover:border-[#8B5CF6]"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => mover(index, 1)}
                    disabled={index === videos.length - 1}
                    title="Descer"
                    className="text-xs px-2 py-1 rounded-md bg-[#1A1A1A] border border-gray-700 text-gray-300 disabled:opacity-30 hover:border-[#8B5CF6]"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleVirarOrientacao(video)}
                    title="Trocar entre vertical e horizontal"
                    className="text-xs px-3 py-1 rounded-md bg-[#1A1A1A] border border-gray-700 text-gray-300 hover:border-[#8B5CF6] flex items-center gap-1"
                  >
                    {video.vertical
                      ? <><RectangleHorizontal className="w-3.5 h-3.5" /> Virar p/ horizontal</>
                      : <><RectangleVertical className="w-3.5 h-3.5" /> Virar p/ vertical</>}
                  </button>
                  <button
                    onClick={() => handleAlternar(video)}
                    className="text-xs px-3 py-1 rounded-md bg-[#1A1A1A] border border-gray-700 text-gray-300 hover:border-[#8B5CF6] flex items-center gap-1"
                  >
                    {video.active ? <><EyeOff className="w-3.5 h-3.5" /> Ocultar</> : <><Eye className="w-3.5 h-3.5" /> Mostrar</>}
                  </button>
                  <button
                    onClick={() => handleApagar(video)}
                    className="text-xs px-3 py-1 rounded-md bg-[#1A1A1A] border border-gray-700 text-red-400 hover:border-red-700 flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Apagar
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
