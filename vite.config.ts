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
    '/api/elevenlabs/text-to-speech': './api/elevenlabs/text-to-speech.ts',
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

          const response: Response = await mod.default(request)
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

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))

  return {
    plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss(), apiDevBridge()],
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
