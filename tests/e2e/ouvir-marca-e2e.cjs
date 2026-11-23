// COMO RODAR: com o dev server ligado (npx vite --port 5181 --strictPort), num terminal Git Bash:
//   NODE_PATH="$(npm config get cache)/_npx/<pasta-do-playwright>/node_modules" node tests/e2e/ouvir-marca-e2e.cjs
// (o Playwright não é dependência do projeto; vem do npx). Login, plano e IA são SIMULADOS — nada real é tocado.
// Os testes de vídeo usam o Microsoft Edge (channel 'msedge'): o Chromium do Playwright não tem AAC.
// E2E 23/11: "Ouça a sua marca" no Dashboard. Login, plano, IA e voz simulados; trilha real do /public.
const { chromium } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:5181'
const REF = 'vymzqowpumdvfnsxjwoo'
const DESC = 'Padaria da Ana em Fortaleza. Bolo de pote a R$ 12. Pix e cartão. O que NÃO fazemos: não temos frete grátis.'
const ROTEIRO_OK = 'Sabe aquele cheirinho de bolo saindo do forno? Na Padaria da Ana, em Fortaleza, o bolo de pote custa R$ 12 e você paga no Pix ou no cartão. Passa aqui, escolhe o seu sabor e leva pra casa um pedacinho de carinho. Padaria da Ana: feito com cuidado, pra você.'
const ROTEIRO_PROMETE = 'Padaria da Ana em Fortaleza! Bolo de pote a R$ 12 com frete grátis pra toda a cidade. Peça agora pelo WhatsApp e receba em casa, no Pix ou no cartão. Corre que é só hoje!'

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

async function contexto(browser, plano) {
  const user = { id: '00000000-0000-0000-0000-000000000001', email: 'ana@padaria.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const sessao = { access_token: 'fake', refresh_token: 'fake', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }
  const ctx = await browser.newContext()
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(sessao)])
  await ctx.addInitScript(() => new MutationObserver(() => document.querySelectorAll('vite-error-overlay').forEach((e) => e.remove())).observe(document, { childList: true, subtree: true }))
  await ctx.route(/supabase\.co/, (r) => {
    const req = r.request(); const u = req.url()
    if (u.includes('/auth/v1/user')) return r.fulfill({ json: user })
    if (u.includes('/rest/v1/profiles')) return r.fulfill({ json: { subscription_plan: plano, subscription_status: plano ? 'active' : null, trial_started_at: null, trial_generations_used: 0, courtesy_expires_at: null, radar_expires_at: null } })
    if (u.includes('/rest/v1/marca_perfil')) return r.fulfill({ json: [{ descricao: DESC, cor_fundo: null, cor_destaque: null }] })
    return r.fulfill({ json: (req.headers()['accept'] || '').includes('object') ? {} : [] })
  })
  const estado = { roteiro: ROTEIRO_OK, spotStatus: 200, pedidosSpot: [], pedidosVoz: [] }
  await ctx.route('**/api/gemini/spot-da-marca', (r) => {
    estado.pedidosSpot.push(JSON.parse(r.request().postData()))
    return estado.spotStatus === 200 ? r.fulfill({ json: { roteiro: estado.roteiro } }) : r.fulfill({ status: estado.spotStatus, json: { error: 'Todos os modelos ocupados' } })
  })
  await ctx.route('**/api/gemini/text-to-speech', (r) => { estado.pedidosVoz.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 200, contentType: 'audio/wav', body: wavSeno(3) }) })
  const page = await ctx.newPage()
  const erros = []; page.on('pageerror', (e) => erros.push(String(e)))
  return { ctx, page, estado, erros }
}

;(async () => {
  const browser = await chromium.launch()

  // 1) com plano: gera o spot
  let t = await contexto(browser, 'crescimento')
  await t.page.goto(`${BASE}/dashboard`)
  const botao = t.page.getByRole('button', { name: 'Ouvir o spot da minha marca' })
  await botao.waitFor({ timeout: 20000 })
  conferir(true, 'com plano: botão "Ouvir o spot da minha marca" aparece no card Minha marca')
  const opcoesVoz = await t.page.locator('#spot-voz option').allTextContents()
  conferir(opcoesVoz.length === 3 && await t.page.locator('#spot-voz').inputValue() === 'Puck', `seletor de locutor: ${opcoesVoz.join(' | ')} (Puck por padrão)`)
  await t.page.locator('#spot-voz').selectOption('Kore')
  await botao.click()
  await t.page.getByTestId('spot-player').waitFor({ timeout: 30000 })
  conferir(t.estado.pedidosSpot[0]?.descricao === DESC, 'o roteiro é pedido com a descrição salva')
  conferir(t.estado.pedidosVoz[0]?.text === ROTEIRO_OK && t.estado.pedidosVoz[0]?.voiceName === 'Kore', 'a voz grava exatamente o roteiro, no locutor escolhido (Kore)')
  const dur = await t.page.evaluate(async () => { const a = document.querySelector('[data-testid=spot-player]'); if (!a.duration || isNaN(a.duration)) await new Promise((r) => a.addEventListener('loadedmetadata', r, { once: true })); return a.duration })
  conferir(dur > 5.5, `o spot tem abertura de 2 s + voz + trilha descendo no fim (voz 3 s → spot ${dur.toFixed(2)} s)`)
  conferir(!(await t.page.getByText('A trilha não carregou').isVisible()), 'a trilha carregou (sem aviso de "só voz")')
  conferir(!(await t.page.getByTestId('spot-avisos').isVisible()), 'roteiro honesto: sem aviso de promessa')
  conferir(await t.page.getByRole('button', { name: 'Baixar MP3' }).isVisible() && await t.page.getByRole('button', { name: 'Gerar outro spot' }).isVisible(), 'aparecem "Baixar MP3" e "Gerar outro spot"')
  await t.page.screenshot({ path: require('os').tmpdir() + '/ouvir-marca.png' })

  // 2) roteiro com promessa → aviso
  t.estado.roteiro = ROTEIRO_PROMETE
  await t.page.getByRole('button', { name: 'Gerar outro spot' }).click()
  await t.page.getByTestId('spot-avisos').waitFor({ timeout: 30000 })
  const txt = await t.page.getByTestId('spot-avisos').textContent()
  conferir(/frete/.test(txt) && /na sua descrição/.test(txt), `spot com promessa mostra o aviso: "${txt.slice(0, 110)}…"`)

  // 3) IA fora do ar → erro claro, spot anterior continua
  t.estado.spotStatus = 503
  await t.page.getByRole('button', { name: 'Gerar outro spot' }).click()
  await t.page.waitForFunction(() => /ocupad|procura|tente|indispon/i.test(document.querySelector('[data-testid=ouvir-marca]')?.innerText || ''), null, { timeout: 60000 })
  conferir(await t.page.getByTestId('spot-player').isVisible(), 'IA fora do ar: mensagem de erro e o spot anterior continua tocável')
  // Editar → editor com o texto salvo → Cancelar → card compacto de volta (o card de hoje mexeu nesse bloco)
  await t.page.getByRole('button', { name: 'Editar' }).click()
  conferir(await t.page.locator('#minha-marca-texto').inputValue() === DESC, 'Editar abre a caixa com a descrição salva')
  await t.page.getByRole('button', { name: 'Cancelar' }).click()
  await t.page.getByTestId('minha-marca-compacto').waitFor({ timeout: 5000 })
  conferir(await t.page.getByRole('button', { name: 'Ouvir o spot da minha marca' }).isVisible(), 'Cancelar volta ao card compacto, com o botão de ouvir')
  conferir(t.erros.length === 0, `sem erro na página ${t.erros.join(' | ')}`)
  await t.ctx.close()

  // 4) sem plano/trial: sem botão
  t = await contexto(browser, null)
  await t.page.goto(`${BASE}/dashboard`)
  await t.page.getByTestId('minha-marca-compacto').waitFor({ timeout: 20000 })
  conferir(!(await t.page.getByTestId('ouvir-marca').isVisible()), 'sem plano nem teste: o botão não aparece')
  await t.ctx.close()

  await browser.close()
  console.log(ok.map((m) => '✅ ' + m).join('\n'))
  console.log(falha.map((m) => '❌ ' + m).join('\n'))
  console.log(`${ok.length}/${ok.length + falha.length}`)
  process.exit(falha.length ? 1 : 0)
})().catch((e) => { console.error('QUEBROU:', e.message.split('\n')[0]); console.log(ok.map((m) => '✅ ' + m).join('\n')); process.exit(2) })
