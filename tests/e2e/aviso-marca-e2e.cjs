// COMO RODAR: com o dev server ligado (npx vite --port 5181 --strictPort), num terminal Git Bash:
//   NODE_PATH="$(npm config get cache)/_npx/<pasta-do-playwright>/node_modules" node tests/e2e/aviso-marca-e2e.cjs
// (o Playwright não é dependência do projeto; vem do npx). Login, plano e IA são SIMULADOS — nada real é tocado.
// Os testes de vídeo usam o Microsoft Edge (channel 'msedge'): o Chromium do Playwright não tem AAC.
// E2E 23/11: aviso "Puxei de Minha marca" só enquanto o texto for o que veio da marca.
// 24/11: Super Agente abre VAZIO (atende vários clientes) — a marca entra pelo botão "Usar Minha marca";
// o campo Nicho sugere os nichos já usados. O Kit continua abrindo preenchido.
const { chromium } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:5181'
const REF = 'vymzqowpumdvfnsxjwoo'
const DESC = 'Achadinhos NewPost-IA: ofertas da Shopee escolhidas por gente. O que NÃO fazemos: não temos frete grátis.'
const ok = []; const falha = []
const conferir = (c, m) => (c ? ok : falha).push(m)

;(async () => {
  const user = { id: '00000000-0000-0000-0000-000000000001', email: 'ana@padaria.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const sessao = { access_token: 'fake', refresh_token: 'fake', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }
  const browser = await chromium.launch()
  const ctx = await browser.newContext()
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(sessao)])
  await ctx.addInitScript(() => new MutationObserver(() => document.querySelectorAll('vite-error-overlay').forEach((e) => e.remove())).observe(document, { childList: true, subtree: true }))
  await ctx.route(/supabase\.co/, (r) => {
    const req = r.request(); const u = req.url()
    if (u.includes('/auth/v1/user')) return r.fulfill({ json: user })
    if (u.includes('/rest/v1/profiles')) return r.fulfill({ json: { subscription_plan: 'crescimento', subscription_status: 'active', trial_started_at: null, trial_generations_used: 0, courtesy_expires_at: null, radar_expires_at: null } })
    if (u.includes('/rest/v1/contents') && u.includes('select=nicho')) return r.fulfill({ json: [{ nicho: 'Produtora de áudio' }, { nicho: 'produtora de audio' }, { nicho: 'Barbearia' }] })
    if (u.includes('/rest/v1/marca_perfil')) return r.fulfill({ json: [{ descricao: DESC, cor_fundo: null, cor_destaque: null }] })
    return r.fulfill({ json: (req.headers()['accept'] || '').includes('object') ? {} : [] })
  })
  const page = await ctx.newPage()
  const erros = []; page.on('pageerror', (e) => erros.push(String(e)))

  for (const [rota, nome] of [['/super-agente', 'Super Agente'], ['/kit-whatsapp', 'Kit de WhatsApp']]) {
    await page.goto(`${BASE}${rota}`)
    const aviso = page.getByTestId('aviso-minha-marca')
    const caixa = page.locator('textarea').first()
    if (rota === '/super-agente') {
      const botao = page.getByTestId('usar-minha-marca')
      await botao.waitFor({ timeout: 20000 })
      conferir(await caixa.inputValue() === '', `${nome}: abre com a caixa VAZIA (não puxa a marca sozinho)`)
      const opcoes = await page.locator('#nichos-usados option').evaluateAll((os) => os.map((o) => o.value))
      conferir(JSON.stringify(opcoes) === JSON.stringify(['Produtora de áudio', 'Barbearia']), `${nome}: Nicho sugere os já usados sem repetir (${opcoes.join(', ')})`)
      await botao.click()
      conferir(await botao.count() === 0, `${nome}: depois do clique o botão some (o texto já está na caixa)`)
    }
    await aviso.waitFor({ timeout: 20000 })
    conferir(await caixa.inputValue() === DESC, `${nome}: caixa com a Minha marca e o aviso aparece`)
    await caixa.fill('LOCUTORES IA - Áudio Pank Produtora: spots e locuções.')
    conferir(await aviso.count() === 0, `${nome}: trocou o texto → o aviso some`)
    await caixa.fill(DESC)
    conferir(await aviso.isVisible(), `${nome}: voltou ao texto da marca → o aviso volta`)
    await caixa.fill(DESC + '\nLOCUTORES IA: spots e locuções.')
    conferir(await aviso.isVisible(), `${nome}: acrescentou outro texto no fim → o aviso FICA (marcas misturadas)`)
  }
  conferir(erros.length === 0, `sem erro na página ${erros.join(' | ')}`)

  await browser.close()
  console.log(ok.map((m) => '✅ ' + m).join('\n'))
  console.log(falha.map((m) => '❌ ' + m).join('\n'))
  console.log(`${ok.length}/${ok.length + falha.length}`)
  process.exit(falha.length ? 1 : 0)
})().catch((e) => { console.error('QUEBROU:', e.message.split('\n')[0]); console.log(ok.map((m) => '✅ ' + m).join('\n')); process.exit(2) })
