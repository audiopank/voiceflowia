import { copyFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

// Vercel serve /api/*.ts como Edge Functions em produção; `vite dev` não tem
// esse runtime, então esta ponte invoca os handlers direto no processo do Vite
// só em dev, para permitir testar o fluxo completo sem precisar do `vercel dev`.
function apiDevBridge(): Plugin {
  const handlers: Record<string, string> = {
    '/api/gemini/text-to-speech': './api/gemini/text-to-speech.ts',
    '/api/gemini/generate-content': './api/gemini/generate-content.ts',
    '/api/gemini/generate-strategy': './api/gemini/generate-strategy.ts',
    '/api/gemini/suggest-brand': './api/gemini/suggest-brand.ts',
    '/api/gemini/generate-hooks': './api/gemini/generate-hooks.ts',
    '/api/gemini/extrair-briefing': './api/gemini/extrair-briefing.ts',
    '/api/gemini/gerar-legenda': './api/gemini/gerar-legenda.ts',
    '/api/gemini/gerar-ctas': './api/gemini/gerar-ctas.ts',
    '/api/gemini/humanizar': './api/gemini/humanizar.ts',
    '/api/gemini/gerar-dialogo': './api/gemini/gerar-dialogo.ts',
    '/api/gemini/gerar-bio': './api/gemini/gerar-bio.ts',
    '/api/elevenlabs/text-to-speech': './api/elevenlabs/text-to-speech.ts',
    '/api/kiwify/webhook': './api/kiwify/webhook.ts',
    '/api/radar/generate-report': './api/radar/generate-report.ts',
    '/api/radar/generate-response': './api/radar/generate-response.ts',
    '/api/radar/cron-alerts': './api/radar/cron-alerts.ts',
    '/api/reminders/cron-reengajamento': './api/reminders/cron-reengajamento.ts',
    '/api/newpost/sessao': './api/newpost/sessao.ts',
  }

  return {
    name: 'api-dev-bridge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const modulePath = req.url ? handlers[req.url.split('?')[0]] : undefined
        if (!modulePath) return next()

        try {
          const mod = await server.ssrLoadModule(modulePath)
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const body = Buffer.concat(chunks)

          const request = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: req.headers as HeadersInit,
            body: body.length ? body : undefined,
          })

          // Handlers podem exportar `export default handler` (function) ou
          // `export default { fetch: handler }` (formato Web Handler que a
          // Vercel exige em runtime Node.js pra projetos "Other") — aceita
          // os dois formatos aqui.
          const entry = mod.default
          const invoke = typeof entry === 'function' ? entry : entry.fetch
          const response: Response = await invoke(request)
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (err) {
          console.error('[api-dev-bridge] erro:', err)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Erro no bridge de dev local' }))
        }
      })
    },
  }
}

// FFmpeg.wasm servido do NOSSO domínio, não de CDN.
//
// Por que: montar o worker e o core a partir de blob de origem externa quebrava
// TODA conversão de áudio em produção — primeiro com "failed to import
// ffmpeg-core.js", depois com "Cannot find module 'blob:...'". Em mesma origem o
// navegador cria o Worker direto do arquivo e o importScripts do core funciona.
//
// O caminho leva a VERSÃO do @ffmpeg/core (ex: /ffmpeg/0.12.6/) de propósito: com a
// versão embutida, o arquivo nunca muda de conteúdo sob a mesma URL, e aí dá pra
// servir com `immutable` no vercel.json — o navegador guarda os 31MB pra sempre em
// vez de revalidar a cada sessão. Atualizar o pacote gera um caminho novo e o cache
// velho é simplesmente ignorado: zero invalidação manual.
//
// A cópia roda AQUI, na avaliação do config (que acontece em todo dev e todo build),
// e não num hook como buildStart — no Vite 8 aquele hook não disparou e a falha era
// silenciosa: o build passava e o áudio quebrava só em produção.
//
// Os 31MB NÃO entram no Git: `public/ffmpeg/` está no .gitignore.
const FFMPEG_CORE_VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(__dirname + '/node_modules/@ffmpeg/core/package.json', 'utf8')).version
  } catch {
    return '0.0.0'
  }
})()

// Exposto ao app via `define` (ver mais abaixo) pra não duplicar a versão em dois lugares.
const FFMPEG_DIR = `/ffmpeg/${FFMPEG_CORE_VERSION}`

function copiarFFmpeg(): void {
  const destino = __dirname + '/public' + FFMPEG_DIR
  try {
    mkdirSync(destino, { recursive: true })
    const origens: [string, string][] = [
      ['/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', '/ffmpeg-core.js'],
      ['/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', '/ffmpeg-core.wasm'],
    ]
    for (const [de, para] of origens) {
      const origem = __dirname + de
      if (!existsSync(origem)) {
        console.warn('[ffmpeg] faltando ' + de + ' — rode `npm install`. Conversao de audio cai no fallback.')
        continue
      }
      copyFileSync(origem, destino + para)
    }
  } catch (err) {
    // Nao derruba o build: sem os arquivos a conversao devolve o audio original.
    console.warn('[ffmpeg] nao consegui copiar os assets:', (err as Error).message)
  }
}

copiarFFmpeg()

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))

  return {
    plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss(), apiDevBridge()],
    define: {
      // Caminho versionado do FFmpeg: fonte unica, o app nao repete a versao.
      __FFMPEG_DIR__: JSON.stringify(FFMPEG_DIR),
    },
    resolve: {
      alias: {
        '@': __dirname + '/src',
      },
    },
    server: {
      port: 3000,
      host: true
    },
  }
})
