import { useState } from 'react'
import { Loader2, Wand2 } from 'lucide-react'
import { fetchWithRetry, safeJson, friendlyApiError } from '../lib/apiRetry'

interface HumanizarButtonProps {
  texto: string
  campo: 'hook' | 'roteiro' | 'legenda'
  onHumanizado: (novoTexto: string) => void
}

/**
 * Botão que reescreve um texto gerado pra soar menos "cara de IA", chamando
 * /api/gemini/humanizar. Fica ao lado do campo (EditableText/PostField), não
 * dentro dele — precisa de estado de loading e chamada de API próprios.
 */
export function HumanizarButton({ texto, campo, onHumanizado }: HumanizarButtonProps) {
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')

  async function humanizar() {
    if (!texto.trim() || loading) return
    setLoading(true)
    setErro('')
    try {
      const response = await fetchWithRetry('/api/gemini/humanizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto, campo })
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(friendlyApiError(response.status, data?.error))
      }
      const data = await safeJson(response)
      onHumanizado(data.texto)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao humanizar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={humanizar}
        disabled={loading}
        title="Reescrever pra soar menos IA"
        aria-label="Humanizar texto"
        className="no-export text-gray-500 hover:text-[#8B5CF6] transition-colors p-1 -m-1 disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
      </button>
      {erro && <span className="text-red-400 text-[10px]">{erro}</span>}
    </span>
  )
}
