// COMO RODAR: com o dev server ligado (npx vite --port 5181 --strictPort), num terminal Git Bash:
//   NODE_PATH="$(npm config get cache)/_npx/<pasta-do-playwright>/node_modules" node tests/e2e/video-agente-e2e.cjs
// (o Playwright não é dependência do projeto; vem do npx). Login, plano e IA são SIMULADOS — nada real é tocado.
// Os testes de vídeo usam o Microsoft Edge (channel 'msedge'): o Chromium do Playwright não tem AAC.
// E2E 23/11: "Baixar vídeo dos cards (MP4)" no AGENTE, no Edge. Montagem do vídeo de verdade.
const { chromium } = require('playwright')
const fs = require('fs')
const BASE = process.env.BASE || 'http://localhost:5181'
const REF = 'vymzqowpumdvfnsxjwoo'
function wavSeno(seg = 3, sr = 24000) {
  const n = seg * sr, buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / sr) * 12000), 44 + i * 2)
  return buf
}
const ok = []; const falha = []
const conferir = (c, m) => (c ? ok : falha).push(m)

;(async () => {
  const user = { id: '00000000-0000-0000-0000-000000000001', email: 'ana@padaria.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const sessao = { access_token: 'fake', refresh_token: 'fake', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }
  const browser = await chromium.launch({ channel: 'msedge' })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(sessao)])
  await ctx.addInitScript(() => new MutationObserver(() => document.querySelectorAll('vite-error-overlay').forEach((e) => e.remove())).observe(document, { childList: true, subtree: true }))
  await ctx.route(/supabase\.co/, (r) => {
    const u = r.request().url()
    if (u.includes('/auth/v1/user')) return r.fulfill({ json: user })
    if (u.includes('/rest/v1/profiles')) return r.fulfill({ json: { subscription_plan: 'crescimento', subscription_status: 'active', trial_started_at: null, trial_generations_used: 0, courtesy_expires_at: null, radar_expires_at: null } })
    return r.fulfill({ json: (r.request().headers()['accept'] || '').includes('object') ? {} : [] })
  })
  const p = (periodo) => ({ dia: 1, periodo, horario: '09:15', hook: 'Bolo de pote fresquinho hoje', roteiro: 'Roteiro curto.', legenda: 'Legenda curta.', vozSugerida: 'Puck', destaques: ['Bolo'] })
  await ctx.route('**/api/gemini/generate-content', (r) => r.fulfill({ json: { posts: [p('Manhã'), p('Tarde')] } }))
  await ctx.route('**/api/gemini/text-to-speech', (r) => r.fulfill({ status: 200, contentType: 'audio/wav', body: wavSeno(3) }))
  await ctx.route('**/api/newpost/sessao', (r) => r.fulfill({ json: { perfis: [] } }))

  const page = await ctx.newPage()
  const erros = []; page.on('pageerror', (e) => erros.push(String(e)))
  await page.goto(`${BASE}/agente`)
  await page.getByPlaceholder('Ex: Barbearia').fill('Padaria da Ana')
  await page.getByRole('button', { name: /Criar Conteúdo do Mês/ }).click()
  const botao = page.getByTestId('baixar-video').first()
  await botao.waitFor({ timeout: 30000 })
  conferir(await botao.isDisabled(), 'Agente sem voz: botão do vídeo desligado')
  await page.getByRole('button', { name: /Gerar Áudio com 1 Clique/ }).first().click()
  await page.waitForFunction(() => !document.querySelector('[data-testid=baixar-video]')?.hasAttribute('disabled'), null, { timeout: 60000 })
  const inicio = Date.now()
  const baixou = page.waitForEvent('download', { timeout: 180000 })
  await botao.click()
  const dl = await baixou
  const destino = require('os').tmpdir() + '/video-agente.mp4'
  await dl.saveAs(destino)
  conferir(/^video-dia-1-manh/.test(dl.suggestedFilename()), `Agente: nome ${dl.suggestedFilename()}`)
  conferir(fs.statSync(destino).size > 20000, `Agente: MP4 ${(fs.statSync(destino).size / 1024).toFixed(0)} KB em ${((Date.now() - inicio) / 1000).toFixed(1)} s`)
  conferir(erros.length === 0, `sem erro na página ${erros.join(' | ')}`)

  await browser.close()
  console.log(ok.map((m) => '✅ ' + m).join('\n'))
  console.log(falha.map((m) => '❌ ' + m).join('\n'))
  console.log(`${ok.length}/${ok.length + falha.length}`)
  process.exit(falha.length ? 1 : 0)
})().catch((e) => { console.error('QUEBROU:', e.message.split('\n')[0]); console.log(ok.map((m) => '✅ ' + m).join('\n')); process.exit(2) })
