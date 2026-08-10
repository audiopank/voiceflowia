interface FeedPreviewProps {
  /** Texto da legenda a pré-visualizar cortado. */
  texto: string
  /** Quantas linhas ficam visíveis antes do corte. */
  linhasVisiveis?: number
}

/**
 * Mini preview de como a legenda aparece cortada num feed tipo Instagram,
 * pra validar se o gancho prende antes da quebra ("...mais").
 */
export function FeedPreview({ texto, linhasVisiveis = 2 }: FeedPreviewProps) {
  if (!texto.trim()) return null

  return (
    <div className="p-3 bg-[#0F0F0F] border border-gray-800 rounded-lg">
      <p className="text-[10px] uppercase text-gray-500 mb-2">Como aparece cortado no feed</p>
      <div className="flex items-start gap-2">
        <div className="w-7 h-7 rounded-full bg-gray-700 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-300">sua_marca</p>
          <p
            className="text-sm text-gray-300 leading-snug overflow-hidden"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: linhasVisiveis,
              WebkitBoxOrient: 'vertical'
            }}
          >
            {texto}
          </p>
          <span className="text-sm text-gray-500">...mais</span>
        </div>
      </div>
    </div>
  )
}
