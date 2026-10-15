import { AlertTriangle, Wand2 } from 'lucide-react'
import { palavrasSemAcento } from '../lib/conferirAcentos'

// Aviso da TRAVA DE ACENTO num card (ver src/lib/conferirAcentos.ts). Não aparece quando o
// texto está certo. O botão corrige por regra fixa (sem IA, sem gastar geração) só as
// palavras listadas — o resto do texto fica como está.
export function TravaAcento({ textos, onCorrigir }: { textos: string[]; onCorrigir: () => void }) {
  const palavras = palavrasSemAcento(textos.join('\n'))
  if (palavras.length === 0) return null
  return (
    <div className="no-export rounded-lg border border-amber-600/50 bg-amber-950/30 p-3 space-y-2">
      <p className="text-xs text-amber-300 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Texto sem acento ({palavras.length}): {palavras.slice(0, 8).join(', ')}
          {palavras.length > 8 ? '…' : ''}. A voz lê errado e o cliente percebe. Se a voz já foi gerada, clique em Refazer depois de corrigir.
        </span>
      </p>
      <button
        type="button"
        onClick={onCorrigir}
        className="text-xs font-bold text-amber-200 bg-amber-700/40 hover:bg-amber-700/60 rounded-md px-3 py-1.5 flex items-center gap-1.5"
      >
        <Wand2 className="w-3.5 h-3.5" /> Corrigir acentos
      </button>
    </div>
  )
}
