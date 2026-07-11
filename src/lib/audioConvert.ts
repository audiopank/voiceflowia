// Converte áudio (WAV/MP3) pra OGG/Opus — pedido de cliente: o WhatsApp só reconhece
// OGG/Opus como "áudio de voz" (player embutido); qualquer outro formato vira anexo
// genérico ("arquivo"), o que faz o cliente final não ouvir o áudio direto no zap.
//
// Roda no navegador via FFmpeg.wasm: as funções de TTS são Edge Functions da Vercel (sem
// child_process/ffmpeg nativo disponível), então converter no servidor exigiria trocar todo
// o runtime pra Node.js. Converter no cliente, só na hora do download, é o caminho mais
// simples e de menor risco pra esse stack.

let ffmpegPromise: Promise<import('@ffmpeg/ffmpeg').FFmpeg> | null = null

// Carrega o FFmpeg (~8MB de core, via CDN) uma única vez por sessão; conversões seguintes
// reusam a mesma instância.
async function getFFmpeg() {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg')
      const { toBlobURL } = await import('@ffmpeg/util')
      const ffmpeg = new FFmpeg()
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      })
      return ffmpeg
    })().catch((err) => {
      // Não deixa uma falha de rede passageira travar a conversão pelo resto da sessão —
      // a próxima chamada tenta carregar de novo.
      ffmpegPromise = null
      throw err
    })
  }
  return ffmpegPromise
}

// input: blob de áudio gerado (WAV do Gemini, MP3 do ElevenLabs, etc).
// Retorna um Blob "audio/ogg" (codec Opus) pronto pra ser reconhecido como áudio de voz
// no WhatsApp. Se a conversão falhar por qualquer motivo (rede bloqueada, etc.), devolve
// o blob original — melhor um download que funciona como arquivo do que nenhum download.
export async function convertToWhatsAppOgg(input: Blob, inputExt: string): Promise<Blob> {
  try {
    const { fetchFile } = await import('@ffmpeg/util')
    const ffmpeg = await getFFmpeg()

    const inputName = `input.${inputExt}`
    const outputName = 'output.ogg'
    await ffmpeg.writeFile(inputName, await fetchFile(input))
    // Qualidade: 24kbps/16kHz era "voz de telefone" e gerou reclamação de qualidade.
    // 64kbps + 48kHz deixa a locução cheia e natural, e o WhatsApp continua
    // reconhecendo como nota de voz (aceita qualquer OGG/Opus válido, independente
    // do bitrate — confirmado). Mantido mono (`-ac 1`): locução é voz única, estéreo
    // só dobraria o tamanho sem ganho audível. Só mexemos no VALOR de flags que já
    // rodavam em produção (-b:a/-ar/-ac) pra não arriscar um fallback silencioso.
    await ffmpeg.exec([
      '-i', inputName,
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-ar', '48000',
      '-ac', '1',
      outputName,
    ])
    const data = await ffmpeg.readFile(outputName)
    await ffmpeg.deleteFile(inputName)
    await ffmpeg.deleteFile(outputName)

    // Usa o Uint8Array direto (não `.buffer`): se for uma view sobre um buffer maior,
    // `.buffer` incluiria bytes fora dos limites do arquivo real.
    const bytes = data as Uint8Array
    return new Blob([bytes], { type: 'audio/ogg' })
  } catch (err) {
    console.error('Erro ao converter áudio pra OGG/Opus:', err)
    return input
  }
}
