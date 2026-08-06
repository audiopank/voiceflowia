import { useState } from 'react'
import { Music, X, AlertCircle, Loader2, Sparkles } from 'lucide-react'
import { blobToAudioBuffer } from '../lib/audioMix'
import { TRILHA_VOL_PADRAO } from '../lib/estudioCards'

// Painel "Estúdio" compartilhado pelo Agente e pelo Super Agente: UMA trilha por kit,
// aplicada em todas as locuções (ouvir, baixar e ZIP) — subir música por card seria
// tortura num kit de 60 posts. O upload fica só no navegador (nada sobe pra servidor).

export interface TrilhaState {
  buffer: AudioBuffer | null
  nome: string
  volume: number // 0–100 (%)
}

export function useTrilhaFundo() {
  const [trilha, setTrilha] = useState<TrilhaState>({ buffer: null, nome: '', volume: TRILHA_VOL_PADRAO })
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
      setTrilha((t) => ({ ...t, buffer, nome: file.name }))
    } catch {
      setErro('Não consegui ler essa música. Use MP3, WAV ou OGG.')
    } finally {
      setCarregando(false)
    }
  }

  function remover() {
    setTrilha((t) => ({ ...t, buffer: null, nome: '' }))
  }

  function setVolume(volume: number) {
    setTrilha((t) => ({ ...t, volume }))
  }

  return { trilha, erro, carregando, carregar, remover, setVolume }
}

export function TrilhaFundoPanel({ estudio }: { estudio: ReturnType<typeof useTrilhaFundo> }) {
  const { trilha, erro, carregando, carregar, remover, setVolume } = estudio
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
          {carregando ? 'Lendo a música...' : 'Subir uma música de fundo (MP3, WAV ou OGG — até 15MB)'}
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
