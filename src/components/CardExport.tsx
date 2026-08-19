import { toPng } from 'html-to-image'

// Máquina de exportar os cards do carrossel (1080x1350 cada), compartilhada pelo
// Agente de Conteúdo IA e pelo Super Agente.
//
// FONTE ÚNICA de propósito: isso nasceu dentro de super-agente.tsx e, quando o Agente
// também precisou publicar na NewPost-IA, copiar o bloco significaria duas versões do
// mesmo card divergindo com o tempo — foi exatamente o que aconteceu com a lista de
// trilhas antes de virar fonte única.

// Auto-ajuste simples de fonte: texto longo = fonte menor, pra caber sem cortar no
// canvas fixo.
export function hookFontSize(hook: string): number {
  if (hook.length > 140) return 30
  if (hook.length > 90) return 38
  if (hook.length > 50) return 46
  return 54
}

// Roteiro e legenda usam a mesma régua — cada um sozinho no próprio slide, tem bem
// mais espaço do que quando dividiam card com o resto.
export function bodyFontSize(text: string): number {
  if (text.length > 500) return 20
  if (text.length > 350) return 24
  if (text.length > 220) return 28
  return 32
}

export type SlideKey = 'hook' | 'roteiro' | 'legenda' | 'imagem'

// Tamanho fixo dos slides: 1080x1350 (4:5), o retrato mais alto que o Instagram aceita
// sem cortar/recomprimir no feed.
export const EXPORT_W = 540
export const EXPORT_H = 675

export const slideRefKey = (index: number, slide: SlideKey) => `${index}:${slide}`

// Um slide do carrossel: só o CONTEÚDO + a logo da marca no canto. NADA de chrome de
// produção (Dia, rótulo do bloco, contador 1/4, rodapé de horário) — isso serve pra
// organização interna e vazava no PNG que o cliente publica.
// Fica oculto (height:0/overflow:hidden na wrapper) até ser exportado.
export function ExportSlide({
  innerRef, brandLogo, children,
}: {
  innerRef: (el: HTMLDivElement | null) => void
  brandLogo: string | null
  children: React.ReactNode
}) {
  return (
    <div style={{ height: 0, overflow: 'hidden' }}>
      <div
        ref={innerRef}
        style={{
          width: EXPORT_W,
          height: EXPORT_H,
          background: '#111111',
          color: '#FFFFFF',
          boxSizing: 'border-box',
          padding: 36,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {brandLogo && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start' }}>
            <img
              src={brandLogo}
              alt=""
              style={{ width: 60, height: 60, objectFit: 'contain', background: '#FFFFFF', borderRadius: 10, padding: 6 }}
            />
          </div>
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', marginTop: 8 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

// Renderiza os slides ocultos de um card como Blob PNG — é o que sobe pro post na
// NewPost-IA. O mesmo desenho que o cliente baixaria em "Baixar Cards", sem passar
// pelo download.
export async function renderSlidesToBlobs(
  refs: Record<string, HTMLDivElement | null>,
  index: number,
  slides: SlideKey[],
): Promise<Blob[]> {
  const imagens: Blob[] = []
  for (const slide of slides) {
    const node = refs[slideRefKey(index, slide)]
    if (!node) continue
    const dataUrl = await toPng(node, {
      pixelRatio: 2,
      width: EXPORT_W,
      height: EXPORT_H,
      backgroundColor: '#111111',
    })
    imagens.push(await (await fetch(dataUrl)).blob())
  }
  return imagens
}
