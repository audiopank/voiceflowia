
export const config = {
  runtime: 'edge'
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'ELEVENLABS_API_KEY não configurada' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const { text, voiceId } = await request.json()

    if (!text) {
      return new Response(
        JSON.stringify({ error: 'Texto é obrigatório' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!voiceId) {
      return new Response(
        JSON.stringify({ error: 'Voz é obrigatória' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.5
          }
        })
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Erro ElevenLabs:', response.status, errorText)
      let detail = ''
      try {
        detail = JSON.parse(errorText)?.detail?.message || ''
      } catch {
        // corpo não era JSON, ignora
      }
      return new Response(
        JSON.stringify({
          error: detail || `Erro na API ElevenLabs: ${response.status}`
        }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const audioBuffer = await response.arrayBuffer()

    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': 'attachment; filename="voiceflow-ia-voiceover.mp3"'
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
