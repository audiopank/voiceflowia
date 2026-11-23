// "Ouça a sua marca" (23/11/2026): roteiro de um spot de ~30 s a partir da descrição salva em
// "Minha marca" (Dashboard). O cliente ouve a marca dele no primeiro minuto dentro do VoiceFlow.
// Este endpoint só ESCREVE o roteiro; voz (text-to-speech), trilha e conferência de promessas
// ficam na tela (src/components/MinhaMarcaCard.tsx), com as peças que já existem.
//
// Runtime EDGE de propósito: o projeto está no teto de 12 funções Node do plano Hobby — Edge não
// conta. Teto rígido do Edge ~25s: perfil 'curto' do modelo reserva (22s).
import { gerarComReserva, respostaDeFalha } from '../_lib/geminiReserva.js'

export const config = {
  runtime: 'edge'
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    roteiro: { type: 'STRING', description: 'Texto do spot para ser FALADO, 55 a 75 palavras, sem emoji, sem hashtag' }
  },
  required: ['roteiro']
}

function buildPrompt(descricao: string): string {
  return `Você é locutor e redator de spots de rádio no Brasil. Escreva o roteiro de UM spot de
apresentação, com cerca de 30 segundos, para a marca descrita abaixo, em português do Brasil.

DESCRIÇÃO DA MARCA, escrita pelo próprio dono (é a ÚNICA fonte de verdade):
"""
${descricao}
"""

REGRAS OBRIGATÓRIAS (o roteiro passa por uma conferência automática de promessas):
- Só afirme o que está na DESCRIÇÃO. Nada de serviço, característica, prêmio ou número inventado.
- Se a descrição tiver uma parte "O que NÃO fazemos" ou parecida, isso NUNCA aparece no spot como
  algo que a marca oferece. E NÃO deduza o contrário: "não abrimos aos domingos" NÃO vira
  "atendemos de segunda a sábado" (pode fechar outros dias). Dia, horário e lugar só como estão escritos.
- NUNCA prometa frete grátis, entrega, desconto, promoção, parcelamento, garantia, "só hoje",
  brinde ou "grátis" se isso não estiver escrito na DESCRIÇÃO.
- Nada de fama ("o melhor da cidade", "o mais pedido", "famoso") nem promessa de resultado
  ("vende mais", "fature mais", "sem esforço") se não estiver escrito na DESCRIÇÃO.
- 55 a 75 palavras. Frases curtas, naturais, para serem lidas em voz alta.
- Comece chamando a atenção do ouvinte e termine com uma chamada simples (o que a pessoa faz agora).
  Se a descrição tiver contato, endereço ou @, você pode citar; se não tiver, não invente.
- Números em algarismos, como estão na descrição. Sem emoji, sem hashtag, sem "link na bio".
- Isto é um áudio. Nunca mencione vídeo.

Responda apenas o JSON.`
}

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
}

function lerRoteiro(texto: string): string | null {
  try {
    const p = JSON.parse(texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
    const r = typeof p?.roteiro === 'string' ? p.roteiro.trim() : ''
    // Curto demais = resposta quebrada; o modelo reserva tenta o próximo da cadeia.
    return r.split(/\s+/).length >= 20 ? r : null
  } catch {
    return null
  }
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return json({ error: 'GEMINI_API_KEY não configurada' }, 500)

    const body = await request.json().catch(() => null)
    const descricao = typeof body?.descricao === 'string' ? body.descricao.trim().slice(0, 4000) : ''
    if (descricao.length < 20) return json({ error: 'Escreva um pouco mais sobre a sua marca em "Minha marca".' }, 400)

    const r = await gerarComReserva({
      apiKey,
      rotulo: 'spot-da-marca',
      perfil: 'curto',
      corpo: {
        contents: [{ parts: [{ text: buildPrompt(descricao) }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA }
      },
      aceita: (texto) => lerRoteiro(texto) !== null
    })
    if (!r.ok) return respostaDeFalha(r)
    return json({ roteiro: lerRoteiro(r.texto), modelo: r.modelo, reserva: r.reserva })
  } catch (error) {
    console.error('Erro em spot-da-marca:', error)
    return json({ error: 'Erro ao escrever o spot' }, 500)
  }
}
