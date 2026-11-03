import { Check } from 'lucide-react'
import {
  PALETA, COR_FUNDO_PADRAO, ESCALA_DESTAQUE, CONTRASTE_MINIMO_DESTAQUE,
  corDoTexto, contraste, chaveDaPalavra, palavrasDaFrase, type CorPaleta,
} from '../lib/estiloCard'
import { coresDoSlide, hookFontSize } from './CardExport'

// Peças de tela das cores dos cards (30/10/2026), usadas pelo Card Mágico e pelo carrossel
// do Super Agente/Agente — fonte única, pra paleta e pílulas não divergirem entre telas.

export function Bolinha({ cor, ativa, onClick }: { cor: CorPaleta; ativa: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativa}
      aria-label={cor.nome}
      title={cor.nome}
      className={`w-8 h-8 rounded-full flex items-center justify-center border transition-transform ${
        ativa ? 'ring-2 ring-white ring-offset-2 ring-offset-[#111111] scale-110' : 'border-white/15 hover:scale-110'
      }`}
      style={{ backgroundColor: cor.hex }}
    >
      {ativa && <Check className="w-4 h-4" style={{ color: corDoTexto(cor.hex) }} />}
    </button>
  )
}

// Uma fileira de bolinhas. `comPadrao` põe o "Preto (padrão)" na frente (só faz sentido
// pro fundo); `extra` = cor tirada da foto pelo conta-gotas.
export function PaletaCores({
  titulo, valor, onChange, comPadrao = false, extra,
}: { titulo: string; valor: string; onChange: (hex: string) => void; comPadrao?: boolean; extra?: CorPaleta | null }) {
  const cores = [
    ...(comPadrao ? [{ nome: 'Preto (padrão)', hex: COR_FUNDO_PADRAO }] : []),
    ...PALETA,
    ...(extra ? [extra] : []),
  ]
  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">{titulo}</p>
      <div className="flex flex-wrap items-center gap-2.5" role="group" aria-label={titulo}>
        {cores.map((c) => <Bolinha key={c.nome} cor={c} ativa={valor === c.hex} onClick={() => onChange(c.hex)} />)}
      </div>
    </div>
  )
}

// Pílulas: uma por palavra da frase; tocar liga/desliga o destaque daquela palavra.
export function PalavrasDestaque({
  frase, destaques, corDestaque, onAlternar, titulo = 'Palavras em destaque',
}: { frase: string; destaques: string[]; corDestaque: string; onAlternar: (chave: string) => void; titulo?: string }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={titulo}>
      {palavrasDaFrase(frase).map((palavra, i) => {
        const chave = chaveDaPalavra(palavra)
        if (!chave) return null
        const ativa = destaques.includes(chave)
        return (
          <button
            key={`${i}-${palavra}`}
            type="button"
            onClick={() => onAlternar(chave)}
            aria-pressed={ativa}
            className={`text-sm rounded-full border px-3 py-1 font-semibold transition-colors ${
              ativa ? 'border-transparent' : 'border-gray-700 bg-[#0A0A0A] text-gray-300 hover:border-gray-500'
            }`}
            style={ativa ? { backgroundColor: corDestaque, color: corDoTexto(corDestaque) } : undefined}
          >
            {palavra}
          </button>
        )
      })}
    </div>
  )
}

export function alternarChave(lista: string[], chave: string): string[] {
  return lista.includes(chave) ? lista.filter((c) => c !== chave) : [...lista, chave]
}

// Texto em HTML (slides do carrossel) com as palavras marcadas maiores e coloridas. Sem
// nenhuma palavra marcada devolve o texto puro — o slide sai igual ao de antes.
export function TextoComDestaque({ texto, destaques, cor }: { texto: string; destaques: string[]; cor: string }) {
  const marcadas = new Set(destaques)
  if (!palavrasDaFrase(texto).some((p) => marcadas.has(chaveDaPalavra(p)))) return <>{texto}</>
  return (
    <>
      {texto.split(/(\s+)/).map((pedaco, i) =>
        marcadas.has(chaveDaPalavra(pedaco)) && chaveDaPalavra(pedaco)
          ? <span key={i} style={{ color: cor, fontWeight: 900, fontSize: `${ESCALA_DESTAQUE}em` }}>{pedaco}</span>
          : pedaco,
      )}
    </>
  )
}

// Painel de cores do CARROSSEL (Super Agente e Agente): fundo + destaque valem pra todos
// os slides do kit; a prévia mostra o slide do gancho do 1º post como vai sair no PNG.
export function PainelCoresCarrossel({
  corFundo, setCorFundo, corDestaque, setCorDestaque, previaTexto, previaDestaques,
}: {
  corFundo: string
  setCorFundo: (hex: string) => void
  corDestaque: string
  setCorDestaque: (hex: string) => void
  previaTexto: string
  previaDestaques: string[]
}) {
  const cores = coresDoSlide(corFundo)
  const temDestaque = palavrasDaFrase(previaTexto).some((p) => previaDestaques.includes(chaveDaPalavra(p)))
  return (
    <div className="bg-[#111111] border border-gray-800 rounded-2xl p-5" data-testid="cores-do-carrossel">
      <p className="text-sm font-medium text-gray-300 mb-1">🎨 Cores dos cards do carrossel</p>
      <p className="text-xs text-gray-500 mb-4">
        Valem pra todos os cards que você baixa ou publica. A IA já marca 1 a 3 palavras-chave no gancho de
        cada post — troque em "Destacar palavras no card". A legenda que você cola no Instagram continua texto puro.
      </p>
      <div className="flex flex-col sm:flex-row gap-5">
        <div className="flex-1 space-y-4 min-w-0">
          <PaletaCores titulo="Fundo dos cards" valor={corFundo} onChange={setCorFundo} comPadrao />
          <PaletaCores titulo="Cor do destaque dos cards" valor={corDestaque} onChange={setCorDestaque} />
          {temDestaque && contraste(corDestaque, cores.fundo) < CONTRASTE_MINIMO_DESTAQUE && (
            <p className="text-xs text-amber-400">O destaque quase some nesse fundo. Escolha outra cor de destaque ou de fundo.</p>
          )}
        </div>
        <div className="shrink-0">
          <p className="text-xs text-gray-400 mb-2">Prévia (card do gancho)</p>
          <div
            data-testid="previa-carrossel"
            className="rounded-lg border border-gray-700 overflow-hidden flex items-center p-3"
            style={{ width: 160, height: 200, background: cores.fundo, color: cores.texto }}
          >
            <p style={{ margin: 0, fontWeight: 700, lineHeight: 1.25, fontSize: Math.max(9, Math.round(hookFontSize(previaTexto) * 160 / 540)) }}>
              <TextoComDestaque texto={previaTexto} destaques={previaDestaques} cor={corDestaque} />
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// Dentro de cada post: abre as pílulas do gancho pra marcar as palavras que vão maiores e
// coloridas no card do gancho.
export function DestacarNoPost({
  frase, destaques, corDestaque, onAlternar,
}: { frase: string; destaques: string[]; corDestaque: string; onAlternar: (chave: string) => void }) {
  if (!frase.trim()) return null
  // Conta só as marcadas que ainda estão no gancho (ele pode ter sido editado/humanizado).
  const naFrase = new Set(palavrasDaFrase(frase).map(chaveDaPalavra))
  const ativas = destaques.filter((c) => naFrase.has(c)).length
  return (
    <details className="rounded-lg border border-gray-800 bg-[#0D0D0D] px-3 py-2" data-testid="destacar-no-post">
      <summary className="text-xs text-gray-400 cursor-pointer select-none">
        🎨 Destacar palavras no card{ativas ? ` (${ativas})` : ''}
      </summary>
      <div className="mt-2">
        <PalavrasDestaque frase={frase} destaques={destaques} corDestaque={corDestaque} onAlternar={onAlternar} titulo="Palavras em destaque do gancho" />
      </div>
    </details>
  )
}
