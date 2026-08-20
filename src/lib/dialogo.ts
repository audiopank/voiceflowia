// Modo Diálogo — duas vozes conversando, no lugar de uma voz lendo.
//
// O Gemini TTS faz isso numa chamada só (multiSpeakerVoiceConfig), então um diálogo
// custa exatamente o mesmo que uma locução comum: mesma cota, mesmo tempo, mesma rota.
//
// Duas medições nesta conta, no modelo em produção:
//   746 caracteres -> 49,0s de áudio, sintetizados em 20,4s
//   672 caracteres -> 40,7s de áudio, sintetizados em 30,2s
// Repare que o TEXTO MENOR levou MAIS tempo: o que manda no relógio é a fila da Gemini
// no momento, não o tamanho. Por isso o teto de 850 não é calculado por regra de três —
// o pior caso medido (~22 caracteres/s) extrapola pra ~38s em 850, ainda dentro do corte
// de 50s da função. Num dia 1,3x pior que isso, o cliente recebe erro tratado em JSON,
// não o HTML de 504.
//
// O que sai daqui é um Blob igual ao da locução de sempre, então Realce Profissional,
// trilha de fundo, OGG do WhatsApp, MP3 do feed e a publicação na NewPost-IA seguem
// funcionando sem saber que são duas vozes.

import { GEMINI_VOICES_TEXTO_LONGO } from './voices'
import { LIMITE_TEXTO } from './limites'

// Espelha api/gemini/gerar-dialogo.ts. `api/` e `src/` não se importam neste projeto
// (bundles separados), então os dois lados declaram os mesmos rótulos — mudou aqui,
// mude lá. São fixos porque o TTS casa fala com voz pelo começo da linha: nome que não
// bate produz áudio com a voz trocada, e sem erro nenhum na tela.
export const FALANTE_CLIENTE = 'Cliente'
export const FALANTE_DONO = 'Dono'

export interface Fala {
  quem: string
  texto: string
}

export interface Dialogo {
  falas: Fala[]
  /** Voz escolhida pra cada papel: { Cliente: 'Puck', Dono: 'Kore' } */
  vozes: Record<string, string>
  /**
   * Cama de fundo exclusiva de diálogo (ver TRILHAS_DIALOGO em estudioCards.ts).
   * null = sem cama, e é o PADRÃO de propósito: a maioria dos clientes aceita o
   * padrão, e cama alegre embaixo de um diálogo sobre desconfiança é pior do que
   * nenhuma. Quando marcada, ela substitui a trilha do kit só neste card.
   */
  trilhaId: string | null
}

// Só as vozes comprovadamente rápidas pra texto longo. As outras 5 do catálogo passam
// de 60s sintetizando texto grande e viram 504 — e diálogo É texto grande (ver a nota
// em src/lib/voices.ts). Preferir 3 vozes que funcionam a 8 que às vezes falham.
export const VOZES_DIALOGO = GEMINI_VOICES_TEXTO_LONGO

// Puck (Animada) no cliente e Kore (Firme) no dono: é o par que eu medi de verdade, e o
// contraste entre os dois é o que faz soar como conversa e não como a mesma pessoa.
export const VOZES_PADRAO: Record<string, string> = {
  [FALANTE_CLIENTE]: 'Puck',
  [FALANTE_DONO]: 'Kore',
}

// Transcrição no formato que o TTS multi-locutor espera: uma linha por fala, começando
// com o nome do falante e dois-pontos.
export function montarTranscricao(falas: Fala[]): string {
  return falas
    // Quebra de linha DENTRO de uma fala (o cliente aperta Enter na caixa de edição)
    // viraria uma linha sem "Nome:" na transcrição, e a rota de voz rejeita a linha
    // órfã com 400. Colapsar o espaço aqui resolve na origem.
    .map((f) => ({ quem: f.quem, texto: f.texto.replace(/\s+/g, ' ').trim() }))
    // Descarta só a fala VAZIA. Filtrar pela linha montada terminar em ":" derrubava
    // calado uma fala legítima acabada em dois-pontos ("Vou te falar o seguinte:").
    .filter((f) => f.texto)
    .map((f) => `${f.quem}: ${f.texto}`)
    .join('\n')
}

// O que vai no corpo da chamada de voz.
export function falantesParaApi(vozes: Record<string, string>) {
  return [
    { nome: FALANTE_CLIENTE, voz: vozes[FALANTE_CLIENTE] ?? VOZES_PADRAO[FALANTE_CLIENTE] },
    { nome: FALANTE_DONO, voz: vozes[FALANTE_DONO] ?? VOZES_PADRAO[FALANTE_DONO] },
  ]
}

// Mesmo teto da locução de uma voz só (LIMITE_TEXTO), medido sobre a transcrição INTEIRA
// — os rótulos "Cliente: " e "Dono: " também são sintetizados como tempo de áudio, então
// contá-los é o número honesto.
export function dialogoLongoDemais(falas: Fala[]): boolean {
  return montarTranscricao(falas).length > LIMITE_TEXTO
}

export function tamanhoDialogo(falas: Fala[]): number {
  return montarTranscricao(falas).length
}

// ~15 caracteres por segundo de áudio, derivado da medição (746 caracteres → 49s).
// É estimativa e a tela diz isso — serve pro cliente saber se está perto do teto.
export function segundosEstimados(falas: Fala[]): number {
  return Math.round(tamanhoDialogo(falas) / 15)
}
