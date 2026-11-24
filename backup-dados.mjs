// Backup pela API do Supabase — serve os 3 projetos do Mestre.
//
// Como rodar:
//   node backup-dados.mjs .env.local            -> VoiceFlow IA (padrao)
//   node backup-dados.mjs .env.local newpost    -> NewPost-IA (a rede)
//   node backup-dados.mjs .env.local manager    -> NewPost-IA Manager (ykswhz)
//
// Precisa no .env.local:
//   VoiceFlow : VITE_SUPABASE_URL     + VOICEFLOW_SERVICE_ROLE_KEY
//   NewPost   : NEWPOST_SUPABASE_URL  + NEWPOST_SERVICE_ROLE_KEY
//   Manager   : MANAGER_SUPABASE_URL  + MANAGER_SERVICE_ROLE_KEY
//              (nenhuma dependencia: so Node 18+, usa fetch nativo)
//
// POR QUE A NEWPOST-IA ENTROU AQUI (21/08/2026): o projeto Supabase dela vivia
// dentro da organizacao da LOVABLE e ja tinha sumido da lista uma vez. A rede
// saiu da Lovable em 28/08, mas sao milhares de posts e 10 GB de midia num
// projeto Free sem backup — a copia continua valendo.
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
// Qual projeto: sem argumento = VoiceFlow, que e o que a Tarefa Agendada do Windows
// chama todo dia (backup-auto.cmd). NAO mudar esse padrao sem mexer la tambem.
const PROJETO = (process.argv[3] || 'voiceflow').toLowerCase()
const PERFIS = {
  voiceflow: {
    nome: 'VoiceFlow IA',
    varUrl: 'VITE_SUPABASE_URL',
    varKey: 'VOICEFLOW_SERVICE_ROLE_KEY',
    pasta: 'D:/backups-voiceflow',
    prefixo: 'voiceflow',
    storage: false, // o VoiceFlow nao guarda midia de cliente no Storage
  },
  newpost: {
    nome: 'NewPost-IA',
    varUrl: 'NEWPOST_SUPABASE_URL',
    varKey: 'NEWPOST_SERVICE_ROLE_KEY',
    pasta: 'D:/backups-newpost',
    prefixo: 'newpost',
    storage: true, // 10 GB de midia: gera o INVENTARIO, nao baixa os arquivos
  },
  // O projeto que se CHAMA "NewPost-IA" no painel mas NAO e a rede — e o Manager:
  // agregador de noticias + espelho de posts + tabelas do Locutores IA. Esta na
  // org do Mestre (ao contrario do hzmtd) mas tem meses de trabalho igual.
  manager: {
    nome: 'NewPost-IA Manager (ykswhz)',
    varUrl: 'MANAGER_SUPABASE_URL',
    varKey: 'MANAGER_SERVICE_ROLE_KEY',
    pasta: 'D:/backups-manager',
    prefixo: 'manager',
    storage: true,
  },
}
const P = PERFIS[PROJETO]
if (!P) { console.error(`projeto desconhecido: "${PROJETO}" — use voiceflow, newpost ou manager`); process.exit(1) }

const URL_BASE = (env[P.varUrl] || '').replace(/\/+$/, '')
const KEY = env[P.varKey]
if (!URL_BASE || !KEY) { console.error(`faltam ${P.varUrl} / ${P.varKey} no arquivo de ambiente`); process.exit(1) }
console.log(`projeto: ${P.nome}`)

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
const DEST = `${P.pasta}/${P.prefixo}_${carimbo}`

// --- descobre as tabelas do schema public -----------------------------------
const rSpec = await fetch(`${URL_BASE}/rest/v1/`, { headers: { ...H, Accept: 'application/openapi+json' }, signal: AbortSignal.timeout(30_000) })
if (!rSpec.ok) { console.error('nao consegui listar as tabelas:', rSpec.status, (await rSpec.text()).slice(0, 200)); process.exit(1) }
// So cria a pasta depois que o Supabase respondeu: falha nao deixa pasta vazia
// (pasta vazia contava na retencao de 14 e empurrava copias boas pra fora).
mkdirSync(DEST, { recursive: true })
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

// --- inventario do Storage --------------------------------------------------
// NAO baixa os arquivos: sao 10 GB na NewPost-IA, e puxar isso a cada backup
// entupiria a maquina e a banda. O que fica aqui e o INVENTARIO — caminho,
// tamanho, tipo e URL publica de cada objeto. Com ele da pra (a) saber
// exatamente o que existia, (b) detectar o que sumiu, e (c) rebaixar tudo
// depois, em lote, se o projeto for perdido. Sem o inventario, "10 GB de midia"
// e um numero: com ele, e uma lista.
let invStorage = null
if (P.storage) {
  console.log('\ninventario do Storage:')
  try {
    const rb = await fetch(`${URL_BASE}/storage/v1/bucket`, { headers: H, signal: AbortSignal.timeout(30_000) })
    const buckets = rb.ok ? await rb.json() : []
    invStorage = { gerado_em: new Date().toISOString(), buckets: [] }

    for (const b of buckets) {
      const objetos = []
      let incompleto = false
      // Percorre recursivamente: o list do Supabase so devolve UM nivel, e
      // pasta vem sem `metadata` (e assim que se distingue de arquivo).
      const pilha = ['']
      while (pilha.length) {
        const prefix = pilha.pop()
        for (let offset = 0; ; offset += 100) {
          const r = await fetch(`${URL_BASE}/storage/v1/object/list/${b.name}`, {
            method: 'POST',
            headers: { ...H, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }),
            signal: AbortSignal.timeout(60_000),
          })
          if (!r.ok) { incompleto = true; break } // lista pela metade fica marcada, nunca calada
          const itens = await r.json()
          for (const it of itens) {
            const caminho = prefix ? `${prefix}${it.name}` : it.name
            if (!it.metadata) pilha.push(`${caminho}/`)
            else objetos.push({
              caminho, tamanho: it.metadata.size, tipo: it.metadata.mimetype,
              criado: it.created_at,
              url: b.public ? `${URL_BASE}/storage/v1/object/public/${b.name}/${caminho}` : null,
            })
          }
          if (itens.length < 100) break
        }
      }
      const bytes = objetos.reduce((s, o) => s + (o.tamanho || 0), 0)
      invStorage.buckets.push({ nome: b.name, publico: b.public, incompleto, objetos: objetos.length, bytes, lista: objetos })
      console.log(`  ${b.name.padEnd(20)} ${String(objetos.length).padStart(5)} arquivos  ${(bytes / 1073741824).toFixed(2)} GB${incompleto ? '  ⚠ INCOMPLETO (listagem falhou no meio)' : ''}`)
    }
    writeFileSync(`${DEST}/_storage_inventario.json`, JSON.stringify(invStorage, null, 1), 'utf8')
  } catch (e) {
    console.log(`  FALHOU — ${e.message}`)
    invStorage = null
  }
}

// --- manifesto --------------------------------------------------------------
const totalLinhas = resumo.reduce((s, r) => s + (r.linhas || 0), 0)
writeFileSync(`${DEST}/_manifesto.json`, JSON.stringify({
  projeto_nome: P.nome, projeto: refUrl, url: URL_BASE, gerado_em: new Date().toISOString(),
  origem: 'API PostgREST + Auth Admin (sem senha de banco)',
  observacao: 'Dados apenas. O schema (DDL) esta versionado no repositorio: CREATE_*.sql e MIGRATION_*.sql',
  tabelas: resumo, usuarios_auth: erroAuth ? null : usuarios.length,
  storage: invStorage
    ? invStorage.buckets.map((b) => ({ bucket: b.nome, incompleto: b.incompleto, objetos: b.objetos, bytes: b.bytes }))
    : null,
}, null, 2), 'utf8')

console.log(`\n=== BACKUP GRAVADO ===`)
console.log(`projeto  : ${P.nome}`)
console.log(`pasta    : ${DEST}`)
console.log(`tabelas  : ${resumo.filter((r) => !r.erro).length}/${resumo.length}`)
console.log(`registros: ${totalLinhas}`)
console.log(`contas   : ${erroAuth ? 'FALHOU' : usuarios.length}`)
if (invStorage) {
  const o = invStorage.buckets.reduce((s, b) => s + b.objetos, 0)
  const g = invStorage.buckets.reduce((s, b) => s + b.bytes, 0) / 1073741824
  console.log(`storage  : ${o} arquivos inventariados (${g.toFixed(2)} GB) — arquivos NAO baixados`)
}
