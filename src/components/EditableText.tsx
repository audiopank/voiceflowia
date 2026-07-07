import { useState, useRef, useEffect } from 'react'
import { Pencil, Check, X } from 'lucide-react'

interface EditableTextProps {
  /** Rótulo do campo (ex: "Hook (3s)", "Legenda"). */
  label: string
  /** Valor atual do texto gerado. */
  value: string
  /** Chamado ao salvar a edição, com o novo texto. */
  onChange: (next: string) => void
  /** Classe do <p> de exibição (para casar com o estilo de cada campo). */
  displayClassName?: string
}

/**
 * Campo de texto gerado pela IA com edição inline.
 * Mostra o texto normalmente + um ícone de lápis; ao clicar, vira um textarea
 * com Salvar / Cancelar. Usado nos agentes de conteúdo (hook, roteiro, legenda).
 */
export function EditableText({
  label,
  value,
  onChange,
  displayClassName = 'text-gray-300 text-sm',
}: EditableTextProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current
      el.focus()
      autoGrow(el)
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [editing])

  function startEditing() {
    setDraft(value)
    setEditing(true)
  }

  function save() {
    onChange(draft.trim())
    setEditing(false)
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs uppercase text-gray-500">{label}</p>
        {!editing && (
          <button
            type="button"
            onClick={startEditing}
            title="Editar texto"
            aria-label={`Editar ${label}`}
            className="no-export text-gray-500 hover:text-[#8B5CF6] transition-colors p-1 -m-1"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              autoGrow(e.target)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
              if (e.key === 'Escape') cancel()
            }}
            rows={2}
            className="w-full p-2 bg-[#1A1A1A] border border-[#8B5CF6] rounded-lg text-white text-sm leading-relaxed focus:outline-none resize-none overflow-hidden"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              className="no-export flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] text-white font-medium transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              Salvar
            </button>
            <button
              type="button"
              onClick={cancel}
              className="no-export flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-[#1A1A1A] border border-gray-700 hover:bg-[#252525] text-gray-300 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <p className={displayClassName}>{value}</p>
      )}
    </div>
  )
}
