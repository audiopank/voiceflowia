// CARTÃO DE VISITA POR ROTA — servido SÓ pra robôs de preview (WhatsApp, Facebook,
// LinkedIn, Telegram… e o `link-preview` da NewPost-IA, UA "NewPostIA-LinkPreview").
// O vercel.json roteia por User-Agent; humanos nunca passam por aqui: seguem no SPA.
//
// Por quê (25/09): o VoiceFlow é um SPA sem nenhuma tag OG — todo link compartilhado
// saía com o cartão pelado (só o domínio). Aqui cada rota de divulgação ganha
// título, descrição e imagem de verdade. Copy só com o que o produto entrega:
// texto + locução; nunca vídeo (regra da casa).
//
// Runtime Node (mesmo molde do gerar-kit-whatsapp): `export default { fetch }`.

const BASE = 'https://voiceflowia-up1.vercel.app'
const IMAGEM = `${BASE}/og/voiceflow-ia.png`

interface Cartao {
  titulo: string
  descricao: string
  caminho: string
}

const CARTOES: Record<string, Cartao> = {
  home: {
    titulo: 'VoiceFlow IA — conteúdo e voz com IA em 1 clique',
    descricao: 'Roteiros, legendas e locução na voz da sua marca, gerados por IA. Para marcas, agências e criadores.',
    caminho: '/',
  },
  trial: {
    titulo: 'Teste grátis por 7 dias — VoiceFlow IA',
    descricao: 'Roteiros, legendas e locução com IA na voz da sua marca. 10 gerações de conteúdo no teste, áudios livres, sem cartão.',
    caminho: '/trial',
  },
  cadastro: {
    titulo: 'Crie sua conta — VoiceFlow IA',
    descricao: 'Conteúdo e voz com IA pra sua marca. Teste grátis por 7 dias, sem cartão.',
    caminho: '/cadastro',
  },
  precos: {
    titulo: 'Planos — VoiceFlow IA',
    descricao: 'Conteúdo e locução com IA pra marcas, agências e criadores. Escolha o plano que cabe no seu ritmo.',
    caminho: '/precos',
  },
  'kit-whatsapp': {
    titulo: 'Kit de Respostas de WhatsApp — VoiceFlow IA',
    descricao: 'As perguntas que todo cliente manda, respondidas em texto e áudio na voz da sua marca. A IA só afirma os fatos do seu negócio.',
    caminho: '/kit-whatsapp',
  },
}

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const rota = (url.searchParams.get('rota') || 'home').toLowerCase()
  const cartao = CARTOES[rota] || CARTOES.home
  const destino = BASE + cartao.caminho + (rota === 'cadastro' && url.searchParams.get('trial') ? '?trial=1' : '')

  const html = `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<title>${esc(cartao.titulo)}</title>
<meta name="description" content="${esc(cartao.descricao)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="VoiceFlow IA">
<meta property="og:locale" content="pt_BR">
<meta property="og:title" content="${esc(cartao.titulo)}">
<meta property="og:description" content="${esc(cartao.descricao)}">
<meta property="og:image" content="${esc(IMAGEM)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(destino)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(cartao.titulo)}">
<meta name="twitter:description" content="${esc(cartao.descricao)}">
<meta name="twitter:image" content="${esc(IMAGEM)}">
<meta http-equiv="refresh" content="0;url=${esc(destino)}">
</head><body><a href="${esc(destino)}">${esc(cartao.titulo)}</a></body></html>`

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=600',
    },
  })
}

export default { fetch: handler }
