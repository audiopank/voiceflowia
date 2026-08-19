// Teto de caracteres pra uma locução só.
//
// Medido no ar chamando a Gemini: a síntese roda a ~22 caracteres por segundo, e
// `api/gemini/text-to-speech.ts` corta em 50s (AbortSignal), dentro do maxDuration
// de 60s da função. Isso põe o ponto de falha por volta de 1.100 caracteres.
//
// 850 é o limite escolhido: ~39s de síntese, ~30% de folga pra um dia em que a
// Gemini esteja mais lenta. E fica bem acima do que um roteiro real ocupa — a
// própria IA é instruída a gerar narração de ~20 segundos, o que dá 400 a 500
// caracteres com o hook junto.
//
// Antes deste limite, passar disso devolvia 504 em HTML e o cliente não entendia
// nada. Hoje a rota devolve mensagem tratada, mas melhor ainda é nem deixar chegar lá.
//
// FONTE ÚNICA: Editor, Agente e Super Agente usam esta constante. Antes de existir,
// só o Editor teria o aviso e os outros dois continuariam falhando calados.
export const LIMITE_TEXTO = 850

// A partir daqui o contador aparece na tela. Antes disso ele só poluiria.
export const LIMITE_AVISO = 600

export function textoLongoDemais(texto: string): boolean {
  return texto.trim().length > LIMITE_TEXTO
}

// Mensagem única pra todas as telas — o cliente lê a mesma orientação em qualquer
// lugar onde esbarre no limite.
export function avisoTextoLongo(texto: string): string {
  const excesso = texto.trim().length - LIMITE_TEXTO
  return `Roteiro longo demais para uma locução só (passou ${excesso.toLocaleString('pt-BR')} caractere(s)). Encurte o texto ou divida em dois — a síntese de voz tem limite de tempo.`
}
