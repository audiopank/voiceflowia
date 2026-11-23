import { useState } from 'react'
import { Film, Loader2 } from 'lucide-react'
import { Button } from './ui/button'

// 🎬 Vídeo dos cards (23/11/2026) — botão por card, compartilhado pelo Super Agente e pelo Agente.
// Os cards do carrossel passando, com a locução e a trilha (com abertura de rádio), num MP4 9:16.
// Apresentação dos cards, NÃO vídeo gerado por IA — a frase da tela foi aprovada pelo Mestre e diz
// exatamente isso. O motor (src/lib/videoDosCards.ts) só carrega no clique.
export function BaixarVideoCards({ temAudio, nomeArquivo, fundo, preparar }: {
  temAudio: boolean
  nomeArquivo: string // sem extensão
  fundo: string // cor de fundo dos cards — preenche o quadro vertical
  preparar: () => Promise<{ cards: Blob[]; audio: Blob }>
}) {
  const [progresso, setProgresso] = useState<number | null>(null) // null = parado
  const [erro, setErro] = useState('')

  async function baixar() {
    if (!temAudio || progresso !== null) return
    setErro('')
    setProgresso(0)
    try {
      const { gerarVideoDosCards } = await import('../lib/videoDosCards')
      const { cards, audio } = await preparar()
      const mp4 = await gerarVideoDosCards({ cards, audio, fundo, aoProgresso: setProgresso })
      const url = URL.createObjectURL(mp4)
      const a = document.createElement('a')
      a.href = url
      a.download = `${nomeArquivo}.mp4`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (e) {
      console.error('=== ERRO ao montar o vídeo ===', e)
      setErro(e instanceof Error ? e.message : 'Não consegui montar o vídeo. Tente de novo.')
    } finally {
      setProgresso(null)
    }
  }

  return (
    <div className="no-export space-y-1">
      <Button
        onClick={baixar}
        disabled={!temAudio || progresso !== null}
        title={temAudio ? 'Os cards deste post passando, com a locução e a trilha, em MP4 vertical' : 'Gere a voz deste card primeiro'}
        className="w-full bg-[#1A1A1A] hover:bg-[#252525] border border-[#8B5CF6]/40 disabled:opacity-50 flex items-center justify-center gap-2"
        data-testid="baixar-video"
      >
        {progresso !== null ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
        {progresso !== null ? `Montando o vídeo… ${Math.round(progresso * 100)}%` : 'Baixar vídeo dos cards (MP4)'}
      </Button>
      <p className="text-[11px] text-gray-500">
        {temAudio
          ? 'Os cards passando com a locução e a trilha, vertical pra Reels, Status e TikTok. Monta no seu navegador (Chrome ou Edge).'
          : 'Gere a voz deste card para montar o vídeo.'}
      </p>
      {erro && <p className="text-xs text-amber-400">{erro}</p>}
    </div>
  )
}
