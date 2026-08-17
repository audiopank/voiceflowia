// Backup do VoiceFlow IA pela API do Supabase.
//
// Como rodar:  node backup-dados.mjs .env.local
// Precisa de:  VITE_SUPABASE_URL + VOICEFLOW_SERVICE_ROLE_KEY no .env.local
//              (nenhuma dependencia: so Node 18+, usa fetch nativo)
//
// Por que existe: o projeto esta no Free Plan do Supabase, que NAO faz backup
// nenhum ("No backups" no painel). Em 15/08/2026 vimos um banco Supabase de
// producao sumir do DNS sem aviso — esta e a copia que a gente controla.
//
// Por que pela API e nao pg_dump: nesta maquina o Docker nao sobe (o WSL nao
// tem distribuicao instalada) e a "Direct connection" do Supabase so tem IPv6,
// que a rede daqui nao alcanca. A API resolve os dois problemas de uma vez.
// O caminho do pg_dump continua disponivel em backup-db.sh, se um dia o Docker
// funcionar — aquele gera dump nativo restauravel.
//
// O que entra: todas as tabelas do schema public + os usuarios do auth.
// O que NAO entra: o schema (DDL) — ele ja esta versionado neste repositorio,
// nos arquivos CREATE_*.sql e MIGRATION_*.sql. Estrutura no Git, dados aqui.
//
// Saida: D:/backups-voiceflow/voiceflow_<data>/  (FORA do repositorio de
// proposito — tem dado de cliente e nao pode entrar em commit nenhum)
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'

const env = {}
for (const line of readFileSync(process.argv[2], 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_0-9]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const URL_BASE = (env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const KEY = env.VOICEFLOW_SERVICE_ROLE_KEY
if (!URL_BASE || !KEY) { console.error('faltam VITE_SUPABASE_URL / VOICEFLOW_SERVICE_ROLE_KEY'); process.exit(1) }

// --- confere que a chave e service_role e do projeto certo -------------------
const refUrl = URL_BASE.replace(/^https?:\/\//, '').split('.')[0]
if (KEY.startsWith('eyJ') && KEY.split('.').length === 3) {
  const p = JSON.parse(Buffer.from(KEY.split('.')[1], 'base64url').toString('utf8'))
  console.log(`chave: role=${p.role} ref=${p.ref} | projeto da URL: ${refUrl}`)
  if (p.role !== 'service_role') { console.error('ERRO: essa chave nao e service_role — nao enxerga tudo'); process.exit(1) }
  if (p.ref !== refUrl) { console.error('ERRO: a chave e de OUTRO projeto'); process.exit(1) }
} else {
  console.log('chave: formato novo (sb_secret/publishable) — seguindo')
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }
const carimbo = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
const DEST = `D:/backups-voiceflow/voiceflow_${carimbo}`
mkdirSync(DEST, { recursive: true })

// --- descobre as tabelas do schema public -----------------------------------
const rSpec = await fetch(`${URL_BASE}/rest/v1/`, { headers: { ...H, Accept: 'application/openapi+json' }, signal: AbortSignal.timeout(30_000) })
if (!rSpec.ok) { console.error('nao consegui listar as tabelas:', rSpec.status, (await rSpec.text()).slice(0, 200)); process.exit(1) }
const tabelas = Object.keys((await rSpec.json()).definitions || {}).sort()
console.log(`\n${tabelas.length} tabelas/views no schema public\n`)

// --- exporta tabela por tabela, paginando -----------------------------------
const PAGINA = 1000
const resumo = []
for (const t of tabelas) {
  const linhas = []
  let erro = null
  try {
    for (let inicio = 0; ; inicio += PAGINA) {
      const r = await fetch(`${URL_BASE}/rest/v1/${t}?select=*`, {
        headers: { ...H, Range: `${inicio}-${inicio + PAGINA - 1}`, Prefer: 'count=exact' },
        signal: AbortSignal.timeout(60_000),
      })
      if (!r.ok) { erro = `HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`; break }
      const lote = await r.json()
      linhas.push(...lote)
      if (lote.length < PAGINA) break
    }
  } catch (e) { erro = e.message }

  if (erro) {
    console.log(`  ${t.padEnd(28)} FALHOU — ${erro}`)
    resumo.push({ tabela: t, linhas: null, erro })
  } else {
    writeFileSync(`${DEST}/${t}.json`, JSON.stringify(linhas, null, 1), 'utf8')
    console.log(`  ${t.padEnd(28)} ${String(linhas.length).padStart(6)} registros`)
    resumo.push({ tabela: t, linhas: linhas.length, erro: null })
  }
}

// --- usuarios do auth (nao passam pelo PostgREST) ---------------------------
console.log('\nusuarios do auth:')
const usuarios = []
let erroAuth = null
try {
  for (let pag = 1; ; pag++) {
    const r = await fetch(`${URL_BASE}/auth/v1/admin/users?page=${pag}&per_page=200`, { headers: H, signal: AbortSignal.timeout(60_000) })
    if (!r.ok) { erroAuth = `HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`; break }
    const d = await r.json()
    const lote = d.users || []
    usuarios.push(...lote)
    if (lote.length < 200) break
  }
} catch (e) { erroAuth = e.message }

if (erroAuth) {
  console.log(`  FALHOU — ${erroAuth}`)
} else {
  writeFileSync(`${DEST}/_auth_users.json`, JSON.stringify(usuarios, null, 1), 'utf8')
  console.log(`  ${String(usuarios.length).padStart(6)} contas`)
}

// --- manifesto --------------------------------------------------------------
const totalLinhas = resumo.reduce((s, r) => s + (r.linhas || 0), 0)
writeFileSync(`${DEST}/_manifesto.json`, JSON.stringify({
  projeto: refUrl, url: URL_BASE, gerado_em: new Date().toISOString(),
  origem: 'API PostgREST + Auth Admin (sem senha de banco)',
  observacao: 'Dados apenas. O schema (DDL) esta versionado no repositorio: CREATE_*.sql e MIGRATION_*.sql',
  tabelas: resumo, usuarios_auth: erroAuth ? null : usuarios.length,
}, null, 2), 'utf8')

console.log(`\n=== BACKUP GRAVADO ===`)
console.log(`pasta    : ${DEST}`)
console.log(`tabelas  : ${resumo.filter((r) => !r.erro).length}/${resumo.length}`)
console.log(`registros: ${totalLinhas}`)
console.log(`contas   : ${erroAuth ? 'FALHOU' : usuarios.length}`)
