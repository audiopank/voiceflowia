// COMO RODAR: com o dev server ligado (npx vite --port 5181 --strictPort), num terminal Git Bash:
//   NODE_PATH="$(npm config get cache)/_npx/<pasta-do-playwright>/node_modules" node tests/e2e/funcionou-e2e.cjs
// (o Playwright não é dependência do projeto; vem do npx). Login, plano, banco e IA são SIMULADOS — nada real é tocado.
//
// 👍 "Esse funcionou" (24/11/2026): marcar/desmarcar em Meus Conteúdos e o Super Agente mandando o exemplo pra IA.
const { chromium } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:5181'
const REF = 'vymzqowpumdvfnsxjwoo'
const UID = '00000000-0000-0000-0000-000000000001'
const KIT = 'aaaaaaaa-0000-0000-0000-000000000001'
const ok = []; const falha = []
const conferir = (c, m) => (c ? ok : falha).push(m)

const posts = [
  { dia: 1, periodo: 'Manhã', horario: '09:00', hook: 'Bolo de pote saindo agora', roteiro: 'Roteiro 1.', legenda: 'Legenda 1.' },
  { dia: 1, periodo: 'Tarde', horario: '18:00', hook: 'Café com bolo?', roteiro: 'Roteiro 2.', legenda: 'Legenda 2.' },
]

async function contexto(browser, opc) {
  const user = { id: UID, email: 'ana@padaria.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const sessao = { access_token: 'fake', refresh_token: 'fake', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(sessao)])
  await ctx.addInitScript(() => new MutationObserver(() => document.querySelectorAll('vite-error-overlay').forEach((e) => e.remove())).observe(document, { childList: true, subtree: true }))
  const estado = { marcados: [...(opc.marcados || [])], pedidos: [], estrategia: null }
  await ctx.route(/supabase\.co/, (r) => {
    const req = r.request(); const u = req.url(); const m = req.method()
    if (u.includes('/auth/v1/user')) return r.fulfill({ json: user })
    if (u.includes('/rest/v1/profiles')) return r.fulfill({ json: { subscription_plan: 'crescimento', subscription_status: 'active', trial_started_at: null, trial_generations_used: 0, courtesy_expires_at: null, radar_expires_at: null } })
    if (u.includes('/rest/v1/contents')) return m === 'GET' ? r.fulfill({ json: [{ id: KIT, nicho: 'Padaria da Ana', posts_json: posts, created_at: '2026-11-20T10:00:00Z' }] }) : r.fulfill({ status: 201, json: [] })
    if (u.includes('/rest/v1/posts_que_funcionaram')) {
      estado.pedidos.push({ m, u, body: req.postData() })
      if (opc.semTabela) return r.fulfill({ status: 404, json: { code: '42P01', message: 'relation does not exist' } })
      if (m === 'GET') return r.fulfill({ json: estado.marcados })
      if (m === 'POST') {
        if (opc.falhaAoMarcar) return r.fulfill({ status: 400, json: { code: '23514', message: 'check violation' } })
        const b = JSON.parse(req.postData()); estado.marcados.push(Array.isArray(b) ? b[0] : b); return r.fulfill({ status: 201, json: [] })
      }
      if (m === 'DELETE') { estado.marcados = []; return r.fulfill({ status: 204, body: '' }) }
    }
    return r.fulfill({ json: (req.headers()['accept'] || '').includes('object') ? {} : [] })
  })
  await ctx.route('**/api/gemini/generate-strategy', (r) => {
    estado.estrategia = JSON.parse(r.request().postData())
    return r.fulfill({ json: { estrategia: { resumo: 'R.', personas: [], pilares: [], hashtags: [], melhoresHorarios: [], ctas: [] }, posts } })
  })
  await ctx.route('**/api/newpost/sessao', (r) => r.fulfill({ json: { perfis: [] } }))
  const page = await ctx.newPage()
  const erros = []; page.on('pageerror', (e) => erros.push(String(e)))
  return { ctx, page, estado, erros }
}

;(async () => {
  const browser = await chromium.launch()

  // 1) Meus Conteúdos: marca e desmarca
  let t = await contexto(browser, {})
  await t.page.goto(`${BASE}/meus-conteudos`)
  await t.page.getByRole('button', { name: /Padaria da Ana/ }).click()
  const botoes = t.page.getByTestId('funcionou')
  await botoes.first().waitFor({ timeout: 20000 })
  conferir(await botoes.count() === 2, 'Meus Conteúdos: botão 👍 em cada post (2)')
  conferir(await t.page.getByText(/Esse funcionou:/).isVisible(), 'o quadro explica o que o 👍 faz (exemplo de estilo, até 3, mesmo nicho)')
  await botoes.first().click()
  await t.page.waitForFunction(() => document.querySelector('[data-testid=funcionou]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 10000 })
  const post = t.estado.pedidos.find((p) => p.m === 'POST')
  const corpo = post && JSON.parse(post.body)
  const linha = Array.isArray(corpo) ? corpo[0] : corpo
  conferir(linha?.user_id === UID && linha?.content_id === KIT && linha?.post_index === 0 && linha?.hook === 'Bolo de pote saindo agora' && linha?.nicho === 'Padaria da Ana', 'marcar grava o post certo (conta, kit, índice 0, texto e nicho)')
  conferir(/Funcionou ✓/.test(await botoes.first().textContent()), 'botão vira "Funcionou ✓"')
  await botoes.first().click()
  await t.page.waitForFunction(() => document.querySelector('[data-testid=funcionou]')?.getAttribute('aria-pressed') === 'false', null, { timeout: 10000 })
  const del = t.estado.pedidos.find((p) => p.m === 'DELETE')
  conferir(del && /user_id=eq\./.test(del.u) && new RegExp(`content_id=eq\\.${KIT}`).test(del.u) && /post_index=eq\.0/.test(del.u), 'desmarcar apaga só aquele post (filtros conta + kit + índice)')
  conferir(t.erros.length === 0, `sem erro na página ${t.erros.join(' | ')}`)
  await t.ctx.close()

  // 2) banco recusa: mostra o erro e NÃO marca
  t = await contexto(browser, { falhaAoMarcar: true })
  await t.page.goto(`${BASE}/meus-conteudos`)
  await t.page.getByRole('button', { name: /Padaria da Ana/ }).click()
  await t.page.getByTestId('funcionou').first().click()
  await t.page.getByText(/Não consegui marcar agora/).waitFor({ timeout: 10000 })
  conferir(await t.page.getByTestId('funcionou').first().getAttribute('aria-pressed') === 'false', 'banco recusou: mensagem clara e o botão NÃO fica marcado')
  await t.ctx.close()

  // 3) tabela ainda não criada (SQL não rodado): sem botão, sem promessa
  t = await contexto(browser, { semTabela: true })
  await t.page.goto(`${BASE}/meus-conteudos`)
  await t.page.getByRole('button', { name: /Padaria da Ana/ }).click()
  await t.page.getByText('Copiar post').first().waitFor({ timeout: 20000 })
  conferir(await t.page.getByTestId('funcionou').count() === 0 && !(await t.page.getByText(/Esse funcionou:/).isVisible()), 'sem a tabela: nenhum botão 👍 nem texto prometendo')
  await t.ctx.close()

  // 4) Super Agente: manda SÓ o exemplo do mesmo nicho e mostra no painel
  t = await contexto(browser, { marcados: [
    { nicho: 'padaria da ana', hook: 'Bolo de pote saindo agora', roteiro: 'Roteiro 1.', legenda: 'Legenda 1.' },
    { nicho: 'Barbearia', hook: 'Corte novo?', roteiro: 'R.', legenda: 'L.' },
  ] })
  await t.page.goto(`${BASE}/super-agente`)
  await t.page.getByPlaceholder('Ex: Barbearia').fill('Padaria da Ana')
  await t.page.getByTestId('memoria-exemplos').waitFor({ timeout: 20000 })
  conferir(/1 post que você marcou como "funcionou" entra como exemplo/.test(await t.page.getByTestId('memoria-exemplos').textContent()), 'painel "A IA já conhece…": 👍 1 post marcado entra como exemplo')
  await t.page.getByRole('button', { name: /Gerar Estratégia \+ Conteúdo/ }).click()
  await t.page.waitForFunction(() => true)
  for (let i = 0; i < 50 && !t.estado.estrategia; i++) await t.page.waitForTimeout(200)
  const ex = t.estado.estrategia?.exemplosQueFuncionaram
  conferir(Array.isArray(ex) && ex.length === 1 && ex[0].hook === 'Bolo de pote saindo agora', 'o pedido à IA leva SÓ o exemplo do mesmo nicho (o da Barbearia fica fora)')
  conferir(t.erros.length === 0, `Super Agente sem erro ${t.erros.join(' | ')}`)
  await t.ctx.close()

  await browser.close()
  console.log(ok.map((m) => '✅ ' + m).join('\n'))
  console.log(falha.map((m) => '❌ ' + m).join('\n'))
  console.log(`${ok.length}/${ok.length + falha.length}`)
  process.exit(falha.length ? 1 : 0)
})().catch((e) => { console.error('QUEBROU:', e.message.split('\n')[0]); console.log(ok.map((m) => '✅ ' + m).join('\n')); process.exit(2) })
