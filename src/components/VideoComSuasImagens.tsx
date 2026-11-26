import { useEffect, useState } from 'react'
import { Film, ImagePlus, X } from 'lucide-react'
import { BaixarVideoCards } from './BaixarVideoCards'

// 🎬 Vídeo com as suas imagens (26/11/2026, pedido do Mestre: cards feitos no Canva). O cliente sobe
// as próprias imagens e o MESMO motor do "vídeo dos cards" monta o MP4 com a locução + trilha do
// Estúdio de Mixagem. Apresentação das imagens dele — nada aqui é vídeo gerado por IA.
const MAX_IMAGENS = 15

// Ordem = nome do arquivo, com números em ordem de gente ("2.png" antes de "10.png"): é como o Canva
// numera as páginas baixadas.
export function ordenarPorNome(arquivos: File[]): File[] {
  return [...arquivos].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
}

function Miniatura({ arquivo, ordem, remover }: { arquivo: File; ordem: number; remover: () => void }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const u = URL.createObjectURL(arquivo)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [arquivo])
  return (
    <div className="relative w-16" data-testid="imagem-escolhida">
      {url && <img src={url} alt={`Imagem ${ordem}`} title={arquivo.name} className="w-16 h-20 object-cover rounded border border-gray-700" />}
      <span className="absolute top-0.5 left-0.5 text-[10px] font-bold bg-black/70 text-white rounded px-1">{ordem}</span>
      <button type="button" onClick={remover} aria-label={`Tirar a imagem ${ordem}`}
        className="absolute -top-1.5 -right-1.5 bg-black border border-gray-600 rounded-full p-0.5 text-gray-300 hover:text-white">
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}

export function VideoComSuasImagens({ prepararAudio }: { prepararAudio: () => Promise<Blob> }) {
  const [imagens, setImagens] = useState<File[]>([])
  const [aviso, setAviso] = useState('')
  const [inputKey, setInputKey] = useState(0) // reseta o <input file> pra poder escolher de novo

  function escolher(lista: FileList | null) {
    const mesma = (a: File, b: File) => a.name === b.name && a.size === b.size
    // escolher o mesmo arquivo de novo não repete a imagem no vídeo
    const novas = Array.from(lista ?? []).filter((f) => f.type.startsWith('image/') && !imagens.some((x) => mesma(x, f)))
    const todas = ordenarPorNome([...imagens, ...novas])
    setAviso(todas.length > MAX_IMAGENS ? `Usei as ${MAX_IMAGENS} primeiras imagens (pela ordem do nome do arquivo).` : '')
    setImagens(todas.slice(0, MAX_IMAGENS))
    setInputKey((k) => k + 1)
  }

  return (
    <div className="mt-2 pt-6 border-t border-gray-800 space-y-3" data-testid="video-suas-imagens">
      <div>
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Film className="w-5 h-5 text-[#8B5CF6]" />
          Vídeo com as suas imagens
        </h3>
        <p className="text-sm text-gray-400">
          Suba os seus cards (do Canva ou de onde quiser). Eles passam um depois do outro, com esta locução e a trilha da mixagem acima.
        </p>
      </div>

      <label className="flex items-center gap-3 p-4 bg-[#1A1A1A] border border-dashed border-gray-700 rounded-lg cursor-pointer hover:border-[#8B5CF6] transition-colors">
        <ImagePlus className="w-5 h-5 text-gray-400 shrink-0" />
        <span className="text-sm text-gray-300">
          {imagens.length ? 'Adicionar mais imagens' : `Escolher imagens (PNG ou JPG, até ${MAX_IMAGENS})`}
        </span>
        <input key={inputKey} type="file" accept="image/*" multiple onChange={(e) => escolher(e.target.files)} className="hidden" data-testid="input-imagens" />
      </label>

      {imagens.length > 0 && (
        <>
          <div className="flex flex-wrap gap-3">
            {imagens.map((f, i) => (
              <Miniatura key={`${f.name}-${f.size}`} arquivo={f} ordem={i + 1}
                remover={() => setImagens((atual) => atual.filter((x) => x !== f))} />
            ))}
          </div>
          <p className="text-[11px] text-gray-500">A ordem segue o nome do arquivo (1, 2, 3…). Pra trocar a ordem, renomeie os arquivos.</p>
        </>
      )}
      {aviso && <p className="text-xs text-amber-400">{aviso}</p>}

      {imagens.length > 0 && (
        <BaixarVideoCards temAudio nomeArquivo="video-com-suas-imagens" fundo="#000000"
          preparar={async () => ({ cards: imagens, audio: await prepararAudio() })} />
      )}
    </div>
  )
}
