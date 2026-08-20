// Devolve uma sessão do cliente na NewPost-IA (rede social própria) pro navegador
// conseguir publicar no feed como ELE MESMO — não por um perfil genérico "VoiceFlow".
//
// Como funciona:
//   1ª vez  -> cria a conta na NewPost-IA com o mesmo e-mail do VoiceFlow (o cadastro
//              de lá é aberto e não exige confirmação de e-mail, então já volta logado),
//              cria o perfil no feed e guarda o refresh_token em newpost_contas.
//   próximas -> troca o refresh_token guardado por um access_token novo.
//
// O que NÃO sai daqui: o refresh_token. Ele fica no banco do VoiceFlow, numa tabela sem
// policy de RLS (só service_role lê). Pro navegador vai só o access_token, que expira em
// ~1h — o suficiente pra subir os cards e inserir o post.
//
// Por que o upload não passa por aqui: função da Vercel tem teto de ~4,5MB por requisição,
// e 4 cards PNG + a locução em MP3 estouram isso em base64. O navegador sobe direto pro
// Storage da NewPost-IA usando o access_token que esta rota devolve.
//
// Runtime Node.js (padrão { fetch } — ver api/radar/cron-alerts.ts).

// 60 (padrão das outras rotas): o pior caminho encadeia refresh + senha + signup + perfil,
// e cada fetch tem timeout próprio de 15-20s — em 30s a função morreria com o HTML de erro
// da Vercel em vez de uma mensagem tratada.
export const maxDuration = 60

import { createClient } from '@supabase/supabase-js'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// Senha aleatória pra conta criada por nós. Só letras e números de propósito: símbolo em
// senha já nos custou horas de depuração quando vai parar dentro de URL de conexão.
function senhaAleatoria(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join('')
}

// A chave da NewPost-IA volta pro NAVEGADOR (linha do return) — então ela TEM que ser a
// anon. Como o nome antigo da variável é ...SERVICE_ROLE_KEY, uma chave secreta de verdade
// posta ali vazaria pra todo cliente que clicasse em "Publicar", com acesso total ao banco
// da rede. Aqui a gente confere o claim `role` do JWT antes de devolver: na dúvida, falha.
function chaveEhPublica(chave: string): boolean {
  if (chave.startsWith('sb_secret_')) return false
  if (chave.startsWith('sb_publishable_')) return true
  const partes = chave.split('.')
  if (partes.length !== 3) return false // formato desconhecido: não arrisca
  try {
    const payload = JSON.parse(Buffer.from(partes[1], 'base64').toString('utf8'))
    return payload?.role === 'anon'
  } catch {
    return false
  }
}

// A chave certa mas do PROJETO ERRADO passa no teste acima (role: anon) e só falha lá na
// frente, com um 401 "Invalid API key" que não diz nada pro cliente. Como o VoiceFlow tem
// a própria anon key numa variável de nome parecido, trocar as duas na Vercel é o erro
// natural de se cometer — e foi o que aconteceu no 1º deploy. Aqui a gente compara o `ref`
// declarado na chave com o subdomínio da URL e falha explicando.
function chaveEDoProjeto(chave: string, url: string): boolean {
  const refDaUrl = url.replace(/^https?:\/\//, '').split('.')[0]
  const partes = chave.split('.')
  if (partes.length !== 3) return true // formato novo (sb_publishable_): não dá pra conferir
  try {
    const payload = JSON.parse(Buffer.from(partes[1], 'base64').toString('utf8'))
    return !payload?.ref || payload.ref === refDaUrl
  } catch {
    return true // não conseguiu ler: deixa seguir, o Supabase decide
  }
}

interface SessaoNewPost {
  accessToken: string
  refreshToken: string
  userId: string
}

// Só aceita a resposta como sessão se vier token E id do usuário. Sem o id, o upload iria
// pra pasta "undefined/..." no Storage e o insert do post quebraria lá na frente.
function sessaoDe(data: any): SessaoNewPost | null {
  if (!data?.access_token || !data?.user?.id) return null
  return { accessToken: data.access_token, refreshToken: data.refresh_token, userId: data.user.id }
}

async function postAuth(url: string, anon: string, caminho: string, corpo: unknown): Promise<any> {
  const res = await fetch(`${url}/auth/v1/${caminho}`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(20_000),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

// Garante que existe uma linha em `profiles` na NewPost-IA — a tabela `posts` referencia
// o perfil, então sem ele o insert do post falha.
//
// A `bio` vem do cliente (gerada por IA a partir do nicho dele e editável antes de
// confirmar — ver api/gemini/gerar-bio.ts). Antes era a string fixa "Publicando com o
// VoiceFlow IA": quem clicava no perfil da padaria lia propaganda da NOSSA ferramenta em
// vez de qualquer coisa sobre a padaria, e todos os clientes ficavam com o perfil
// idêntico. Sem bio é melhor que isso — por isso, quando ela não vem, o campo simplesmente
// não é enviado e o perfil nasce sem bio, pronto pro cliente escrever a dele na rede.
async function garantirPerfil(url: string, anon: string, token: string, userId: string, nome: string, bio: string): Promise<string | null> {
  const H = { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  try {
    const res = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}&select=id,bio`, { headers: H, signal: AbortSignal.timeout(15_000) })
    if (res.ok) {
      // Corpo não-JSON (PostgREST fora do ar devolve HTML) não pode virar exceção aqui:
      // cairia no catch e viraria um 502 falso. Sem lista = segue e tenta criar o perfil.
      const linhas = await res.json().catch(() => null)
      if (Array.isArray(linhas) && linhas.length > 0) {
        // O perfil JÁ EXISTE — e na prática é sempre este o caminho: a NewPost-IA cria a
        // linha de `profiles` sozinha no cadastro, então o POST abaixo nunca chegou a
        // rodar. Conferido no banco: 115 perfis, TODOS com bio NULL, inclusive os que
        // nós criamos. Quer dizer que a bio precisa ser escrita AQUI, senão a feature
        // inteira é decoração.
        //
        // Só preenche bio VAZIA. Se o cliente já escreveu a dele lá na rede, o que ele
        // escreveu manda — a nossa sugestão nunca sobrescreve texto de gente.
        const atual = (linhas[0]?.bio ?? '').toString().trim()
        if (bio && !atual) {
          const patch = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}`, {
            method: 'PATCH',
            headers: { ...H, Prefer: 'return=minimal' },
            body: JSON.stringify({ bio }),
            signal: AbortSignal.timeout(15_000),
          })
          // Falhar aqui NÃO derruba a publicação: bio é enfeite do perfil, o post é o
          // que o cliente veio fazer. Fica no log e segue.
          if (!patch.ok) console.error('[newpost/sessao] não gravou a bio:', patch.status, (await patch.text()).slice(0, 160))
        }
        return null
      }
    }
    const cria = await fetch(`${url}/rest/v1/profiles`, {
      method: 'POST',
      headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify(bio ? { id: userId, display_name: nome, bio } : { id: userId, display_name: nome }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!cria.ok) return `perfil: ${cria.status} ${(await cria.text()).slice(0, 160)}`
    return null
  } catch (e: any) {
    return `perfil: ${e.message}`
  }
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  const NEWPOST_URL = process.env.NEWPOST_SUPABASE_URL
  // A chave da NewPost é a ANON (pública). O nome antigo NEWPOST_SUPABASE_SERVICE_ROLE_KEY
  // continua aceito só como ponte — e passa pelo mesmo crivo do chaveEhPublica abaixo, pra
  // que uma service_role de verdade posta com esse nome NUNCA chegue ao navegador.
  const NEWPOST_ANON = process.env.NEWPOST_SUPABASE_ANON_KEY || process.env.NEWPOST_SUPABASE_SERVICE_ROLE_KEY
  const VF_URL = process.env.VITE_SUPABASE_URL
  const VF_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VOICEFLOW_SERVICE_ROLE_KEY

  if (!NEWPOST_URL || !NEWPOST_ANON) return json({ error: 'NEWPOST_SUPABASE_URL / NEWPOST_SUPABASE_ANON_KEY não configuradas' }, 500)
  if (!chaveEhPublica(NEWPOST_ANON)) {
    console.error('[newpost/sessao] a chave configurada NÃO é a anon key — recusando pra não vazar segredo')
    return json({ error: 'Configuração inválida: defina NEWPOST_SUPABASE_ANON_KEY com a chave anon (pública) da NewPost-IA.' }, 500)
  }
  if (!chaveEDoProjeto(NEWPOST_ANON, NEWPOST_URL)) {
    console.error('[newpost/sessao] NEWPOST_SUPABASE_ANON_KEY é de outro projeto Supabase, não bate com NEWPOST_SUPABASE_URL')
    return json({ error: 'Configuração inválida: a NEWPOST_SUPABASE_ANON_KEY pertence a outro projeto Supabase (provavelmente a chave do próprio VoiceFlow). Use a anon key do projeto da NewPost-IA.' }, 500)
  }
  if (!VF_URL || !VF_SERVICE) return json({ error: 'VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas' }, 500)

  // --- quem está pedindo (sessão do VoiceFlow) -----------------------------
  const auth = request.headers.get('authorization') || ''
  const tokenVf = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!tokenVf) return json({ error: 'Faça login no VoiceFlow para publicar.' }, 401)

  const admin = createClient(VF_URL, VF_SERVICE, { auth: { persistSession: false } })
  const { data: userData, error: userErr } = await admin.auth.getUser(tokenVf)
  const usuario = userData?.user
  if (userErr || !usuario?.email) return json({ error: 'Sessão inválida. Entre de novo no VoiceFlow.' }, 401)

  let body: any = {}
  try { body = await request.json() } catch { /* corpo opcional */ }
  const nomePerfil: string = (body?.nomePerfil || '').toString().trim()
  // Mesmo teto do gerador e do campo na tela (api/gemini/gerar-bio.ts). Cortar aqui
  // também porque o corpo vem do navegador e pode ter sido adulterado.
  const bioPerfil: string = (body?.bio || '').toString().trim()
    .replace(/\s*\n+\s*/g, ' ')
    .slice(0, 160)
    // `.slice()` corta por unidade UTF-16: se o índice 160 cair em cima de um emoji,
    // sobra metade do par substituto e o perfil público exibe "�". Joga a metade fora.
    .replace(/[\uD800-\uDBFF]$/, '')
  const senhaInformada: string = (body?.senhaNewpost || '').toString()

  // --- já existe vínculo? --------------------------------------------------
  const { data: vinculo } = await admin
    .from('newpost_contas')
    .select('newpost_user_id, newpost_email, refresh_token, senha_gerada')
    .eq('user_id', usuario.id)
    .maybeSingle()

  // Primeira publicação: o CLIENTE escolhe como quer aparecer na rede. Antes a gente
  // usava o campo "Nicho" do Super Agente como display_name, e quem digitava
  // "padaria em BH" nascia com isso de nome público — decisão nossa sobre a marca
  // dele, que não é nossa pra tomar. A sugestão abaixo é só um ponto de partida
  // editável; nada é criado enquanto ele não confirmar.
  if (!vinculo && !nomePerfil) {
    return json({
      precisaNome: true,
      sugestao: (body?.marca || '').toString().trim() || usuario.email.split('@')[0],
      email: usuario.email,
    }, 409)
  }
  const marca = nomePerfil || usuario.email.split('@')[0]

  let sessao: SessaoNewPost | null = null
  let contaCriadaAgora = false
  let senhaGerada: string | null = null

  // 1) tenta renovar pelo refresh_token guardado
  if (vinculo?.refresh_token) {
    const r = await postAuth(NEWPOST_URL, NEWPOST_ANON, 'token?grant_type=refresh_token', { refresh_token: vinculo.refresh_token })
    if (r.ok) sessao = sessaoDe(r.data)
  }

  // 2) refresh falhou (token rotacionado/expirado) mas temos a senha que nós geramos
  if (!sessao && vinculo?.senha_gerada) {
    const r = await postAuth(NEWPOST_URL, NEWPOST_ANON, 'token?grant_type=password', { email: vinculo.newpost_email, password: vinculo.senha_gerada })
    if (r.ok) sessao = sessaoDe(r.data)
  }

  // 3) o cliente informou a senha da conta que ele já tinha na NewPost-IA
  if (!sessao && senhaInformada) {
    const r = await postAuth(NEWPOST_URL, NEWPOST_ANON, 'token?grant_type=password', { email: usuario.email, password: senhaInformada })
    sessao = r.ok ? sessaoDe(r.data) : null
    if (!sessao) {
      return json({ error: 'E-mail ou senha da NewPost-IA não conferem.', precisaSenha: true }, 401)
    }
  }

  // 4) sem vínculo: cria a conta na NewPost-IA com o mesmo e-mail
  if (!sessao) {
    senhaGerada = senhaAleatoria()
    const r = await postAuth(NEWPOST_URL, NEWPOST_ANON, 'signup', {
      email: usuario.email,
      password: senhaGerada,
      data: { display_name: marca, origem: 'voiceflow' },
    })

    sessao = r.ok ? sessaoDe(r.data) : null
    if (sessao) {
      contaCriadaAgora = true
    } else {
      // O e-mail já tem conta na NewPost-IA e a senha é do cliente, não nossa. Sem
      // service_role daquele projeto não há como entrar por ele — então pedimos a senha
      // uma única vez (guardamos o refresh_token e nunca mais perguntamos).
      const msg = (r.data?.msg || r.data?.error_description || r.data?.message || '').toString().toLowerCase()
      if (msg.includes('already') || msg.includes('registered') || r.status === 422) {
        return json({
          error: 'Você já tem conta na NewPost-IA com este e-mail. Informe a senha uma vez para conectar.',
          precisaSenha: true,
          email: usuario.email,
        }, 409)
      }
      return json({ error: `Não consegui criar a conta na NewPost-IA: ${r.data?.msg || r.status}` }, 502)
    }
  }

  // --- perfil no feed ------------------------------------------------------
  const erroPerfil = await garantirPerfil(NEWPOST_URL, NEWPOST_ANON, sessao.accessToken, sessao.userId, marca, bioPerfil)
  if (erroPerfil) return json({ error: `Conta ok, mas não consegui preparar seu perfil na NewPost-IA (${erroPerfil}).` }, 502)

  // --- guarda/atualiza o vínculo ------------------------------------------
  const { error: erroSalvar } = await admin.from('newpost_contas').upsert({
    user_id: usuario.id,
    newpost_user_id: sessao.userId,
    newpost_email: usuario.email,
    refresh_token: sessao.refreshToken,
    senha_gerada: senhaGerada ?? vinculo?.senha_gerada ?? null,
    criada_por_nos: contaCriadaAgora || Boolean(vinculo?.senha_gerada),
    updated_at: new Date().toISOString(),
  })
  // Falha ao gravar o vínculo não impede a publicação de agora — só faz a próxima vez
  // perguntar de novo (o nome do perfil e, se a conta já existia, a senha). Melhor
  // publicar e repetir uma pergunta do que travar o cliente.
  if (erroSalvar) console.error('[newpost/sessao] não gravou o vínculo:', erroSalvar.message)

  return json({
    accessToken: sessao.accessToken,
    newpostUserId: sessao.userId,
    supabaseUrl: NEWPOST_URL,
    anonKey: NEWPOST_ANON, // pública por natureza: já vai no bundle do site da NewPost-IA
    contaCriadaAgora,
    // Só na criação: o cliente precisa saber a senha pra conseguir entrar direto na rede.
    senhaGerada: contaCriadaAgora ? senhaGerada : null,
    email: usuario.email,
  })
}

export default { fetch: handler }
