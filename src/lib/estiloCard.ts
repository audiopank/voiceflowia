// ESTILO DO CARD (30/10/2026) — cores e palavras em destaque no Card Mágico.
// Ideia do Mestre: paleta pronta (como a de editor de vídeo) pro fundo do card e pra cor
// do destaque; o cliente toca nas palavras da frase que quer destacar e elas saem
// maiores e na cor escolhida. Tudo aqui é régua pura (sem React, sem IA), pra dar pra
// testar fora do navegador.
//
// Verdade importante: isso vale pro texto DESENHADO no card (imagem). A legenda que vai
// na caixa de texto do Instagram é texto puro — lá não existe cor nem tamanho de letra.

export interface CorPaleta {
  nome: string
  hex: string
}

// O card de sempre: fundo preto premium, letra quase branca. Sem escolher nada, o card
// sai idêntico ao de antes desta função.
export const COR_FUNDO_PADRAO = '#0B0B0D'
export const COR_TEXTO_CLARA = '#F3F3F3'
export const COR_TEXTO_ESCURA = '#141414'
export const COR_DESTAQUE_PADRAO = '#E5D93A'

// As 8 cores da amostra que o Mestre mandou (vermelho → rosa). Vermelho, azul e roxo
// levemente mais escuros que a amostra: assim a letra clara passa na régua de leitura
// (contraste ≥ 4,5) mesmo com o card pequeno na tela do celular.
export const PALETA: CorPaleta[] = [
  { nome: 'Vermelho', hex: '#D12E2E' },
  { nome: 'Laranja', hex: '#E8913A' },
  { nome: 'Amarelo', hex: '#E5D93A' },
  { nome: 'Verde', hex: '#7ED321' },
  { nome: 'Ciano', hex: '#22C3C3' },
  { nome: 'Azul', hex: '#4C5DEC' },
  { nome: 'Roxo', hex: '#8A4CDB' },
  { nome: 'Rosa', hex: '#D63AD6' },
]

// Destaque = 20% maior que o resto da frase (e mais pesado). Vale pro Card Mágico (canvas).
export const ESCALA_DESTAQUE = 1.2

// Carrossel do Super Agente/Agente (05/11/2026): 20% não aparecia ("as fontes não aumentam") —
// passa a 50%. Gancho longo (mais de 90 letras) fica em 30%, pra não estourar a altura do card.
export const ESCALA_DESTAQUE_CARROSSEL = 1.5
export const ESCALA_DESTAQUE_CARROSSEL_LONGO = 1.3
export function escalaDestaqueCarrossel(texto: string): number {
  return texto.length > 90 ? ESCALA_DESTAQUE_CARROSSEL_LONGO : ESCALA_DESTAQUE_CARROSSEL
}

export function hexParaRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbParaHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()
}

// Luminância relativa (WCAG): 0 = preto, 1 = branco.
export function luminancia(hex: string): number {
  const [r, g, b] = hexParaRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// Contraste WCAG entre duas cores: 1 (igual) até 21 (preto × branco).
export function contraste(a: string, b: string): number {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

// A letra se ajusta sozinha ao fundo: clara ou escura, a que der MAIS contraste.
export function corDoTexto(fundo: string): string {
  return contraste(fundo, COR_TEXTO_CLARA) >= contraste(fundo, COR_TEXTO_ESCURA) ? COR_TEXTO_CLARA : COR_TEXTO_ESCURA
}

// Abaixo disso o destaque some no fundo (ex.: amarelo sobre amarelo).
export const CONTRASTE_MINIMO_DESTAQUE = 1.8

// Chave da palavra pra marcar destaque: sem caixa e sem pontuação — "GRÁTIS!" e "grátis"
// são a mesma palavra. Acento fica (é outra palavra sem ele).
export function chaveDaPalavra(palavra: string): string {
  return palavra.toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, '')
}

export function palavrasDaFrase(frase: string): string[] {
  return frase.split(/\s+/).filter(Boolean)
}

export interface Pedaco {
  texto: string
  destaque: boolean
  largura: number
}

// Quebra a frase em linhas que cabem em `maxWidth`, com palavras de tamanhos diferentes.
// `medir` devolve a largura da palavra já na fonte certa (normal ou destaque); `espaco` é
// a largura de um espaço na fonte normal. Palavra sozinha maior que a linha fica na
// linha dela (mesmo comportamento do wrapText de sempre).
export function quebrarComDestaque(
  frase: string,
  destaques: Set<string>,
  medir: (palavra: string, destaque: boolean) => number,
  espaco: number,
  maxWidth: number,
): Pedaco[][] {
  const linhas: Pedaco[][] = []
  for (const paragrafo of frase.split('\n')) {
    let atual: Pedaco[] = []
    let larguraAtual = 0
    for (const texto of palavrasDaFrase(paragrafo)) {
      const destaque = destaques.has(chaveDaPalavra(texto))
      const largura = medir(texto, destaque)
      const nova = atual.length ? larguraAtual + espaco + largura : largura
      if (nova <= maxWidth || !atual.length) {
        atual.push({ texto, destaque, largura })
        larguraAtual = nova
      } else {
        linhas.push(atual)
        atual = [{ texto, destaque, largura }]
        larguraAtual = largura
      }
    }
    linhas.push(atual)
  }
  return linhas
}

export function larguraDaLinha(linha: Pedaco[], espaco: number): number {
  return linha.reduce((soma, p) => soma + p.largura, 0) + espaco * Math.max(0, linha.length - 1)
}

// "Cor da foto" (o conta-gotas): a cor mais marcante da imagem. Ignora quase-branco,
// quase-preto e cinza (fundo de estúdio, sombra), agrupa o resto por matiz e devolve a
// média do grupo mais cheio. null = foto sem cor marcante (ex.: produto preto no branco).
export function corDominante(pixels: Uint8ClampedArray): string | null {
  const grupos = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const [r, g, b, a] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]]
    if (a < 128) continue
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max < 40 || min > 225) continue // quase preto / quase branco
    if (max - min < 40) continue // cinza
    let matiz: number
    if (max === r) matiz = ((g - b) / (max - min)) % 6
    else if (max === g) matiz = (b - r) / (max - min) + 2
    else matiz = (r - g) / (max - min) + 4
    const grupo = Math.floor((((matiz * 60) + 360) % 360) / 30) // 12 fatias de 30°
    const atual = grupos.get(grupo) ?? { n: 0, r: 0, g: 0, b: 0 }
    atual.n++; atual.r += r; atual.g += g; atual.b += b
    grupos.set(grupo, atual)
  }
  let melhor: { n: number; r: number; g: number; b: number } | null = null
  for (const g of grupos.values()) if (!melhor || g.n > melhor.n) melhor = g
  // Menos de 3% da foto com cor = não há cor marcante de verdade.
  if (!melhor || melhor.n < (pixels.length / 4) * 0.03) return null
  return rgbParaHex(melhor.r / melhor.n, melhor.g / melhor.n, melhor.b / melhor.n)
}
