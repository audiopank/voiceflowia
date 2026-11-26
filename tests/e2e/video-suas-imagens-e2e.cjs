// COMO RODAR: com o dev server ligado (npx vite --port 5181 --strictPort), num terminal Git Bash:
//   NODE_PATH="$(npm config get cache)/_npx/<pasta-do-playwright>/node_modules" node tests/e2e/video-suas-imagens-e2e.cjs
// (o Playwright não é dependência do projeto; vem do npx). Login, plano e voz são SIMULADOS — nada real é tocado.
// Usa o Microsoft Edge (channel 'msedge'): o Chromium do Playwright não tem AAC.
// E2E 26/11: "Vídeo com as suas imagens" no Editor — o cliente sobe os próprios cards (Canva) e baixa o MP4.
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const BASE = process.env.BASE || 'http://localhost:5181'
const REF = 'vymzqowpumdvfnsxjwoo'
const CARDS = path.join(__dirname, '../../.claude/skills/conferir-campanha/evals/cards-com-promessa-na-imagem/files')

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
  await ctx.route('**/api/gemini/text-to-speech', (r) => r.fulfill({ status: 200, contentType: 'audio/wav', body: wavSeno(3) }))

  const page = await ctx.newPage()
  const erros = []; page.on('pageerror', (e) => erros.push(String(e)))
  await page.goto(`${BASE}/editor`)
  await page.getByPlaceholder(/Digite ou cole o texto/).fill('Lançamentos fresquinhos pra sua maratona.')
  await page.getByRole('button', { name: /Gerar Voz/ }).click()
  const secao = page.getByTestId('video-suas-imagens')
  await secao.waitFor({ timeout: 30000 })
  conferir(await page.getByTestId('baixar-video').count() === 0, 'sem imagens: o botão do vídeo ainda não aparece')

  await page.getByRole('button', { name: /Business$/ }).first().click() // trilha real do /public → abertura de rádio
  const jpg = (n) => fs.readFileSync(path.join(CARDS, n))
  await page.getByTestId('input-imagens').setInputFiles([
    { name: '10.jpg', mimeType: 'image/jpeg', buffer: jpg('card-alo-alo.jpg') },
    { name: '1.jpg', mimeType: 'image/jpeg', buffer: jpg('card-postou-vendeu.jpg') },
    { name: '3.jpg', mimeType: 'image/jpeg', buffer: jpg('card-sem-texto-engessado.jpg') },
    { name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('não é imagem') },
  ])
  const nomes = await page.locator('[data-testid=imagem-escolhida] img').evaluateAll((is) => is.map((i) => i.title))
  conferir(JSON.stringify(nomes) === JSON.stringify(['1.jpg', '3.jpg', '10.jpg']), `ordem pelo número do arquivo e .txt ignorado: ${nomes.join(', ')}`)

  await page.getByRole('button', { name: 'Tirar a imagem 2' }).click()
  const depois = await page.locator('[data-testid=imagem-escolhida] img').evaluateAll((is) => is.map((i) => i.title))
  conferir(JSON.stringify(depois) === JSON.stringify(['1.jpg', '10.jpg']), `✕ tira só aquela imagem: ${depois.join(', ')}`)

  // mesmo arquivo de novo (mesmo nome e tamanho) não entra repetido
  const contar = () => page.locator('[data-testid=imagem-escolhida]').count()
  const mesmoArquivo = { name: '20.jpg', mimeType: 'image/jpeg', buffer: jpg('card-alo-alo.jpg') }
  await page.getByTestId('input-imagens').setInputFiles([mesmoArquivo])
  const comNovo = await contar()
  await page.getByTestId('input-imagens').setInputFiles([mesmoArquivo])
  const repetiu = await contar()
  conferir(comNovo === 3 && repetiu === 3, `escolher o mesmo arquivo de novo não duplica (${comNovo} → ${repetiu})`)
  await page.getByRole('button', { name: 'Tirar a imagem 3' }).click()

  const botao = page.getByTestId('baixar-video')
  conferir(await botao.isEnabled(), 'com imagens e voz: botão "Baixar vídeo dos cards (MP4)" ligado')
  const inicio = Date.now()
  const baixou = page.waitForEvent('download', { timeout: 180000 })
  await botao.click()
  const dl = await baixou
  const destino = require('os').tmpdir() + '/video-suas-imagens-teste.mp4'
  await dl.saveAs(destino)
  const tam = fs.statSync(destino).size
  conferir(dl.suggestedFilename() === 'video-com-suas-imagens.mp4', `nome do arquivo: ${dl.suggestedFilename()}`)
  conferir(tam > 20000, `MP4 gerado: ${(tam / 1024).toFixed(0)} KB em ${((Date.now() - inicio) / 1000).toFixed(1)} s (salvo em ${destino})`)
  conferir(erros.length === 0, `sem erro na página ${erros.join(' | ')}`)

  await browser.close()
  console.log(ok.map((m) => '✅ ' + m).join('\n'))
  console.log(falha.map((m) => '❌ ' + m).join('\n'))
  console.log(`${ok.length}/${ok.length + falha.length}`)
  process.exit(falha.length ? 1 : 0)
})().catch((e) => { console.error('QUEBROU:', e.message.split('\n')[0]); console.log(ok.map((m) => '✅ ' + m).join('\n')); process.exit(2) })
