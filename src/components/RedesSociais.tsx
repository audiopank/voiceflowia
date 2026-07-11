import { useEffect, useState } from 'react'
import { Save, ExternalLink, CheckCircle2, Share2 } from 'lucide-react'
import { Button } from './ui/button'
import { SOCIAL_NETWORKS, type SocialLinks } from '../lib/socialLinks'

// Painel "Suas Redes Sociais" no Super Agente: o cliente salva os links das
// redes dele (fica no localStorage por usuário, ver src/lib/socialLinks.ts) e
// abre cada uma em 1 clique pra postar o conteúdo gerado — sem sair do app.
export function RedesSociais({
  links,
  onSave,
}: {
  links: SocialLinks
  onSave: (links: SocialLinks) => void
}) {
  // Rascunho editável local; só vira "salvo" quando clica em Salvar.
  const [draft, setDraft] = useState<SocialLinks>(links)
  const [saved, setSaved] = useState(false)

  // O pai carrega os links do localStorage de forma assíncrona (no mount);
  // sincroniza o rascunho quando eles chegam. `links` (useState no pai) só muda
  // identidade no load e no save, então isso não atropela a digitação.
  useEffect(() => {
    setDraft(links)
  }, [links])

  function update(key: string, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  function handleSave() {
    // Normaliza: remove espaços das pontas de cada link.
    const clean: SocialLinks = {}
    for (const [k, v] of Object.entries(draft)) clean[k] = v.trim()
    onSave(clean)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="no-export bg-[#111111] border border-gray-800 rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Share2 className="w-5 h-5 text-[#8B5CF6]" />
        <div>
          <h3 className="text-lg font-bold text-white">Suas Redes Sociais</h3>
          <p className="text-xs text-gray-500">
            Salve seus links e poste o conteúdo em 1 clique — sem sair do VoiceFlow.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {SOCIAL_NETWORKS.map((net) => {
          const value = draft[net.key] ?? ''
          const canOpen = value.trim().length > 0
          return (
            <div key={net.key}>
              <label className="block text-sm font-medium text-gray-300 mb-1">{net.label}</label>
              <div className="flex items-center gap-2">
                <input
                  value={value}
                  onChange={(e) => update(net.key, e.target.value)}
                  placeholder={net.placeholder}
                  className="w-full p-2.5 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-[#8B5CF6] text-sm"
                />
                <button
                  type="button"
                  onClick={() => canOpen && window.open(value.trim(), '_blank', 'noopener')}
                  disabled={!canOpen}
                  title={canOpen ? `Abrir ${net.label}` : 'Preencha o link primeiro'}
                  className="shrink-0 flex items-center gap-1 px-3 py-2.5 rounded-lg text-sm bg-[#1A1A1A] border border-gray-700 text-gray-300 hover:border-[#8B5CF6] hover:text-[#8B5CF6] disabled:opacity-40 disabled:hover:border-gray-700 disabled:hover:text-gray-300 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  Abrir
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <Button
        onClick={handleSave}
        className="w-full bg-[#8B5CF6] hover:bg-[#7C3AED] flex items-center justify-center gap-2"
      >
        {saved ? (
          <>
            <CheckCircle2 className="w-4 h-4" /> Salvo!
          </>
        ) : (
          <>
            <Save className="w-4 h-4" /> Salvar Links das Redes Sociais
          </>
        )}
      </Button>
    </div>
  )
}
