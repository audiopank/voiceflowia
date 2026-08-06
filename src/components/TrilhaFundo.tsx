import { useState } from 'react'
import { Music, X, AlertCircle, Loader2, Sparkles } from 'lucide-react'
import { blobToAudioBuffer } from '../lib/audioMix'
import { TRILHA_VOL_PADRAO, TRILHAS_PRONTAS, type TrilhaPronta } from '../lib/estudioCards'

// Painel "Estúdio" compartilhado pelo Agente e pelo Super Agente: UMA trilha por kit,
// aplicada em todas as locuções (ouvir, baixar e ZIP) — subir música por card seria
// tortura num kit de 60 posts. Trilhas prontas de 1 clique (mesmas camas do Editor)
// matam o atrito "cadê a música?"; upload próprio continua disponível e fica só no
// navegador (nada sobe pra servidor).

export interface TrilhaState {
  buffer: AudioBuffer | null
  nome: string
  presetId: string | null // qual trilha pronta está ativa (null = upload próprio/nenhuma)
  volume: number // 0–100 (%)
}

export function useTrilhaFundo() {
  const [trilha, setTrilha] = useState<TrilhaState>({ buffer: null, nome: '', presetId: null, volume: TRILHA_VOL_PADRAO })
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  async function carregar(file: File | undefined) {
    setErro('')
    if (!file) return
    if (file.size > 15 * 1024 * 1024) {
      setErro('Música muito grande (máx 15MB).')
      return
    }
    setCarregando(true)
    try {
      // Valida decodificando de verdade: se o navegador não lê o codec, falha AQUI,
      // não na hora do play/download (quando o cliente já contava com a trilha).
      const buffer = await blobToAudioBuffer(file)
      setTrilha((t) => ({ ...t, buffer, nome: file.name, presetId: null }))
    } catch {
      setErro('Não consegui ler essa música. Use MP3, WAV ou OGG.')
    } finally {
      setCarregando(false)
    }
  }

  async function carregarPreset(preset: TrilhaPronta) {
    setErro('')
    setCarregando(true)
    try {
      const res = await fetch(`/trilhas/${preset.file}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      // Em SPA/host com fallback pra index.html, arquivo faltando volta como HTML 200 —
      // o check de tipo evita "carregar" um HTML achando que é áudio (padrão do Editor).
      if (!blob.type.startsWith('audio')) throw new Error('não é áudio')
      const buffer = await blobToAudioBuffer(blob)
      setTrilha((t) => ({ ...t, buffer, nome: `${preset.emoji} ${preset.label}`, presetId: preset.id }))
    } catch (err) {
      console.error('Falha ao carregar trilha pronta:', err)
      setErro('Essa trilha ainda não está disponível. Você pode subir a sua própria música.')
    } finally {
      setCarregando(false)
    }
  }

  function remover() {
    setTrilha((t) => ({ ...t, buffer: null, nome: '', presetId: null }))
  }

  function setVolume(volume: number) {
    setTrilha((t) => ({ ...t, volume }))
  }

  return { trilha, erro, carregando, carregar, carregarPreset, remover, setVolume }
}

export function TrilhaFundoPanel({ estudio }: { estudio: ReturnType<typeof useTrilhaFundo> }) {
  const { trilha, erro, carregando, carregar, carregarPreset, remover, setVolume } = estudio
  const [inputKey, setInputKey] = useState(0) // reseta o <input file> ao remover

  return (
    <div className="bg-[#111111] border border-gray-800 rounded-2xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Music className="w-5 h-5 text-[#8B5CF6]" />
        <h3 className="font-bold text-white">Estúdio: trilha de fundo <span className="text-gray-500 font-normal text-sm">(opcional)</span></h3>
      </div>
      <p className="text-xs text-gray-500 mb-3 flex items-center gap-1">
        <Sparkles className="w-3.5 h-3.5 text-[#8B5CF6]" />
        O Realce Profissional (brilho de estúdio) já é aplicado automaticamente em toda voz gerada.
      </p>

      {/* Trilhas prontas: 1 clique e a cama entra pra TODAS as locuções do kit. */}
      <div className="flex flex-wrap gap-2 mb-3">
        {TRILHAS_PRONTAS.map((preset) => {
          const ativa = trilha.presetId === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => carregarPreset(preset)}
              disabled={carregando}
              aria-pressed={ativa}
              className={`text-xs rounded-full border px-3 py-1.5 transition-colors disabled:opacity-50 ${
                ativa
                  ? 'border-[#8B5CF6] bg-[#8B5CF6]/15 text-white'
                  : 'border-gray-700 bg-[#0F0F0F] text-gray-400 hover:border-gray-500 hover:text-white'
              }`}
            >
              {preset.emoji} {preset.label}
            </button>
          )
        })}
      </div>

      {trilha.buffer ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 bg-[#0F0F0F] border border-gray-800 rounded-lg px-3 py-2">
            <Music className="w-4 h-4 text-[#22C55E] shrink-0" />
            <span className="text-sm text-gray-300 truncate flex-1">{trilha.nome}</span>
            <button
              type="button"
              onClick={() => { remover(); setInputKey((k) => k + 1) }}
              className="text-gray-500 hover:text-red-400 shrink-0"
              aria-label="Remover trilha"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="vol-trilha" className="text-xs text-gray-400">Volume da música</label>
              <span className="text-xs text-[#8B5CF6] font-bold">{trilha.volume}%</span>
            </div>
            <input
              id="vol-trilha"
              type="range"
              min={5}
              max={60}
              step={5}
              value={trilha.volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-full accent-[#8B5CF6]"
            />
            <p className="text-xs text-gray-600 mt-1">
              Ela entra como cama embaixo de todas as locuções e desce suave quando a voz termina —
              vale pro Ouvir, pro download e pro ZIP do kit.
            </p>
          </div>
        </div>
      ) : (
        <label className="flex items-center justify-center gap-2 w-full py-4 border border-dashed border-gray-700 rounded-lg text-gray-400 text-sm cursor-pointer hover:border-[#8B5CF6] hover:text-[#8B5CF6] transition-colors">
          {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Music className="w-4 h-4" />}
          {carregando ? 'Lendo a música...' : 'Ou suba a sua própria música (MP3, WAV ou OGG — até 15MB)'}
          <input
            key={inputKey}
            type="file"
            accept="audio/*"
            className="hidden"
            disabled={carregando}
            onChange={(e) => carregar(e.target.files?.[0])}
          />
        </label>
      )}

      {erro && (
        <p className="text-red-400 text-sm mt-2 flex items-center gap-1">
          <AlertCircle className="w-4 h-4" /> {erro}
        </p>
      )}
    </div>
  )
}
