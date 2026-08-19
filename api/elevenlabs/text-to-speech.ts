
// Ver mesmo ajuste em api/gemini/text-to-speech.ts: texto longo pode passar do limite
// padrão de execução (~25s) e virar "Erro na API: 504" (timeout do gateway).
// Runtime Node.js (NAO Edge). Edge Function na Vercel tem teto rigido de ~25s e
// IGNORA o `maxDuration` — este arquivo declarava maxDuration = 60 justamente pra
// resolver o 504 de texto longo, e nunca teve efeito porque rodava em Edge.
// No runtime Node o teto vale, mas o handler precisa ser exportado como
// `export default { fetch: handler }` (ver api/radar/cron-alerts.ts).
export const maxDuration = 60

async function handler(request: Request): Promise<Response> {
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
        // 50s deixa ~10s de folga dentro do maxDuration de 60: se a IA pendurar, a
        // funcao ainda consegue devolver erro em JSON. Sem isso a Vercel mata a funcao e
        // o cliente recebe o HTML de 504, que o front nao sabe interpretar.
        signal: AbortSignal.timeout(50_000),
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

export default { fetch: handler }
