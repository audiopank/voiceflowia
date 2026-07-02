export const config = {
  runtime: 'edge'
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function parseAudioMimeType(mimeType: string): { bitsPerSample: number; rate: number } {
  let bitsPerSample = 16
  let rate = 24000

  for (const param of mimeType.split(';')) {
    const trimmed = param.trim()
    if (trimmed.toLowerCase().startsWith('rate=')) {
      const parsed = Number(trimmed.split('=', 2)[1])
      if (!Number.isNaN(parsed)) rate = parsed
    } else if (trimmed.startsWith('audio/L')) {
      const parsed = Number(trimmed.split('L', 2)[1])
      if (!Number.isNaN(parsed)) bitsPerSample = parsed
    }
  }

  return { bitsPerSample, rate }
}

// Áudio bruto da API Gemini (audio/L16;rate=24000, etc.) não é um WAV válido por si só —
// precisa do cabeçalho RIFF/WAVE montado manualmente. https://soundfile.sapp.org/doc/WaveFormat/
function toWav(pcmData: Uint8Array<ArrayBuffer>, mimeType: string): Uint8Array<ArrayBuffer> {
  const { bitsPerSample, rate } = parseAudioMimeType(mimeType)
  const numChannels = 1
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = numChannels * bytesPerSample
  const byteRate = rate * blockAlign
  const dataSize = pcmData.length
  const header = new ArrayBuffer(44)
  const view = new DataView(header)

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  const wavBytes = new Uint8Array(44 + dataSize)
  wavBytes.set(new Uint8Array(header), 0)
  wavBytes.set(pcmData, 44)
  return wavBytes
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY não configurada' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const { text, voiceName } = await request.json()

    if (!text) {
      return new Response(
        JSON.stringify({ error: 'Texto é obrigatório' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const voice = voiceName || 'Zephyr'

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text
                }
              ]
            }
          ],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voice
                }
              }
            }
          }
        })
      }
    )

    if (!response.ok) {
      const errorData = await response.text()
      console.error('Erro Gemini:', errorData)
      let detail = ''
      try {
        detail = JSON.parse(errorData)?.error?.message || ''
      } catch {
        // corpo não era JSON, ignora
      }
      return new Response(
        JSON.stringify({
          error: detail || `Erro na API Gemini: ${response.status}`
        }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const data = await response.json()
    const audioPart = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)

    if (!audioPart) {
      throw new Error('Nenhum áudio retornado pela API')
    }

    const mimeType: string = audioPart.inlineData.mimeType || 'audio/L16;rate=24000'
    const rawBytes = base64ToBytes(audioPart.inlineData.data)
    const wavBytes = mimeType.startsWith('audio/wav') ? rawBytes : toWav(rawBytes, mimeType)

    return new Response(wavBytes, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Disposition': 'attachment; filename="voiceflow-ia-voiceover.wav"'
      }
    })
  } catch (error) {
    console.error('Erro ao gerar áudio:', error)
    return new Response(
      JSON.stringify({ error: 'Erro ao gerar áudio' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
