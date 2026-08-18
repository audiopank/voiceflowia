// Converte áudio (WAV/MP3) pra OGG/Opus — pedido de cliente: o WhatsApp só reconhece
// OGG/Opus como "áudio de voz" (player embutido); qualquer outro formato vira anexo
// genérico ("arquivo"), o que faz o cliente final não ouvir o áudio direto no zap.
//
// Roda no navegador via FFmpeg.wasm: as funções de TTS são Edge Functions da Vercel (sem
// child_process/ffmpeg nativo disponível), então converter no servidor exigiria trocar todo
// o runtime pra Node.js. Converter no cliente, só na hora do download, é o caminho mais
// simples e de menor risco pra esse stack.

// Injetado pelo Vite (define no vite.config.ts): caminho versionado dos arquivos.
declare const __FFMPEG_DIR__: string

let ffmpegPromise: Promise<import('@ffmpeg/ffmpeg').FFmpeg> | null = null

// Carrega o FFmpeg (core servido do nosso domínio) uma única vez por sessão; conversões seguintes
// reusam a mesma instância.
async function getFFmpeg() {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg')
      const ffmpeg = new FFmpeg()
      // Core ESM em MESMA ORIGEM (copiado pra public/ffmpeg/ por copiarFFmpeg() no
      // vite.config.ts). Carregar de CDN via blob quebrava em produção
      // ("failed to import ffmpeg-core.js" e depois "Cannot find module 'blob:...'").
      //
      // NÃO passar classWorkerURL apontando pro UMD (814.ffmpeg.js): o
      // @ffmpeg/ffmpeg cria o worker sempre com type: "module", e module worker não
      // tem importScripts() — que é o único jeito de o core UMD entrar. Sem
      // classWorkerURL, o Vite empacota o worker ESM do pacote, que carrega o core
      // com await import(coreURL). Testado no Chrome com estes arquivos: gera OGG e
      // MP3 de verdade; com o UMD, estourava "Cannot find module".
      await ffmpeg.load({
        // __FFMPEG_DIR__ vem do vite.config.ts e leva a versao do @ffmpeg/core no
        // caminho (ex: /ffmpeg/0.12.6) — e o que permite servir com cache immutable.
        coreURL: `${__FFMPEG_DIR__}/ffmpeg-core.js`,
        wasmURL: `${__FFMPEG_DIR__}/ffmpeg-core.wasm`,
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

// Converte a mixagem (WAV vindo do OfflineAudioContext) pra MP3 320kbps estéreo 44.1kHz —
// formato universal aceito por rádios e plataformas de streaming. Reusa a mesma instância
// de FFmpeg.wasm do OGG. Se a conversão falhar (rede/codec), devolve o WAV original: pesa
// mais, mas ainda toca em qualquer lugar (fallback igual ao do OGG).
export async function convertMixToMp3(wavBlob: Blob): Promise<{ blob: Blob; ext: 'mp3' | 'wav' }> {
  try {
    const { fetchFile } = await import('@ffmpeg/util')
    const ffmpeg = await getFFmpeg()

    const inputName = 'mix.wav'
    const outputName = 'mix.mp3'
    await ffmpeg.writeFile(inputName, await fetchFile(wavBlob))
    await ffmpeg.exec([
      '-i', inputName,
      '-c:a', 'libmp3lame',
      '-b:a', '320k',
      '-ar', '44100',
      '-ac', '2',
      outputName,
    ])
    const data = await ffmpeg.readFile(outputName)
    await ffmpeg.deleteFile(inputName)
    await ffmpeg.deleteFile(outputName)

    // Copia pra um Uint8Array com ArrayBuffer comum: o FFmpeg pode devolver uma view sobre
    // SharedArrayBuffer (threads), que o TS não aceita direto como BlobPart.
    const bytes = new Uint8Array(data as Uint8Array)
    return { blob: new Blob([bytes], { type: 'audio/mpeg' }), ext: 'mp3' }
  } catch (err) {
    console.error('Erro ao converter mixagem pra MP3:', err)
    return { blob: wavBlob, ext: 'wav' }
  }
}

// Locução pra publicar no feed da NewPost-IA: MP3 MONO 96 kbps.
//
// Diferente do convertMixToMp3 (320 kbps estéreo), que existe pra mixagem de rádio.
// Aqui é voz única indo pra um feed social: estéreo dobra o tamanho sem ganho audível,
// e 320 kbps num post de 20 segundos são ~800KB à toa. 96 kbps mono deixa a locução
// com brilho mesmo COM trilha por baixo — em 64k o Mestre ouviu "abafado", porque o
// LAME corta agudos por volta de 11kHz nesse bitrate; em 96k o corte sobe pra ~15kHz.
// Custo: ~250KB por post em vez de ~160KB. Barato pelo ganho audível.
//
// Mesmo fallback dos outros: se o FFmpeg falhar, devolve o WAV original. Ele pesa
// muito mais, mas toca — melhor um post com áudio pesado do que sem áudio.
export async function convertVoiceToMp3(wavBlob: Blob): Promise<{ blob: Blob; ext: 'mp3' | 'wav' }> {
  try {
    const { fetchFile } = await import('@ffmpeg/util')
    const ffmpeg = await getFFmpeg()

    const inputName = 'voz.wav'
    const outputName = 'voz.mp3'
    await ffmpeg.writeFile(inputName, await fetchFile(wavBlob))
    await ffmpeg.exec([
      '-i', inputName,
      '-c:a', 'libmp3lame',
      '-b:a', '96k',
      '-ar', '44100',
      '-ac', '1',
      outputName,
    ])
    const data = await ffmpeg.readFile(outputName)
    await ffmpeg.deleteFile(inputName)
    await ffmpeg.deleteFile(outputName)

    const bytes = new Uint8Array(data as Uint8Array)
    return { blob: new Blob([bytes], { type: 'audio/mpeg' }), ext: 'mp3' }
  } catch (err) {
    console.error('Erro ao converter locução pra MP3:', err)
    return { blob: wavBlob, ext: 'wav' }
  }
}
