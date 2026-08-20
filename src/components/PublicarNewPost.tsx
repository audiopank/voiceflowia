import { useRef, useState } from 'react'
import { Send, Loader2, CheckCircle2, ExternalLink, KeyRound, AtSign, RefreshCw } from 'lucide-react'
import { Button } from './ui/button'
import {
  obterSessaoNewPost,
  publicarNaNewPost,
  sugerirBioNewPost,
  limitarBio,
  LIMITE_BIO,
  PrecisaSenhaNewPost,
  PrecisaNomeNewPost,
  URL_NEWPOST,
  type ResultadoPublicacao,
} from '../lib/newpost'

// Botão "Publicar na NewPost-IA" de um card do Super Agente.
//
// A NewPost-IA é a rede própria do Mestre, então aqui a publicação é DE VERDADE — não é
// "copia a legenda e abre o site" como nas outras redes. E é a única que aceita a locução
// junto: o post sai com texto + cards + áudio, que é o kit inteiro que o VoiceFlow produz.
//
// `prepararMidia` é um callback porque renderizar os PNGs (html-to-image sobre os slides
// ocultos) e converter o áudio pra MP3 são coisas do Super Agente — este componente só
// orquestra o fluxo e cuida do estado da tela.
export function PublicarNewPost({
  texto,
  marca,
  chaveUnica,
  prepararMidia,
  disabled,
}: {
  texto: string
  /** Hoje as duas telas passam aqui o NICHO que o cliente digitou ("padaria artesanal em
   *  Fortaleza"). Serve pra sugerir o nome do perfil e como contexto da bio — repare que
   *  o nome que vai pro perfil é o que o cliente confirma na tela, não este. */
  marca: string
  chaveUnica: string
  prepararMidia: () => Promise<{ imagens: Blob[]; audio: Blob | null }>
  disabled?: boolean
}) {
  const [estado, setEstado] = useState<'parado' | 'preparando' | 'enviando' | 'pronto'>('parado')
  const [erro, setErro] = useState('')
  const [pedindoNome, setPedindoNome] = useState<{ sugestao: string } | null>(null)
  const [nomePerfil, setNomePerfil] = useState('')
  const [bio, setBio] = useState('')
  const [gerandoBio, setGerandoBio] = useState(false)
  // Identifica o pedido de bio em voo. A resposta da IA pode chegar DEPOIS de o cliente
  // cancelar o bloco (que limpa o campo) ou pedir outra bio — e aí a resposta velha
  // repovoaria um campo que ele acabou de limpar, ou sobrescreveria a bio mais nova.
  const pedidoBioRef = useRef(0)
  const [pedindoSenha, setPedindoSenha] = useState<{ email: string } | null>(null)
  const [senha, setSenha] = useState('')
  const [resultado, setResultado] = useState<ResultadoPublicacao | null>(null)

  // Escreve a bio a partir do nicho que o cliente JÁ digitou, pra ele não encarar um
  // campo em branco no momento mais frágil do fluxo (a primeira publicação). Nunca
  // trava: se a IA falhar, o campo fica vazio e o perfil nasce sem bio.
  async function gerarBio(nome: string) {
    if (!nome.trim()) return
    const pedido = ++pedidoBioRef.current
    setGerandoBio(true)
    try {
      // `nome` é o que o cliente confirmou; `marca` é o nicho que ele digitou na tela —
      // o nome vira o sujeito da bio e o nicho dá o que o negócio faz.
      const sugerida = await sugerirBioNewPost(nome.trim(), marca)
      // Pedido vencido (cancelou ou pediu outra): descarta em vez de escrever na tela.
      if (pedido !== pedidoBioRef.current) return
      if (sugerida) setBio(sugerida)
    } finally {
      // Só o pedido mais recente desliga o spinner — senão o que chega primeiro
      // apaga o "Escrevendo sua bio…" de um pedido que ainda está em voo.
      if (pedido === pedidoBioRef.current) setGerandoBio(false)
    }
  }

  async function publicar(opcoes: { nomePerfil?: string; senhaNewpost?: string } = {}) {
    setErro('')
    try {
      // A conta vem primeiro: se faltar o nome do perfil ou a senha, é melhor descobrir
      // isso ANTES de gastar tempo renderizando 4 PNGs e convertendo áudio.
      setEstado('preparando')
      // `nomePerfil` do estado sobrevive entre as duas perguntas: se ele escolher o nome e
      // logo depois a conta pedir senha, não perguntamos o nome de novo. A bio viaja junto
      // e só é usada quando o perfil está sendo criado agora.
      const sessao = await obterSessaoNewPost(marca, {
        nomePerfil: opcoes.nomePerfil ?? (nomePerfil.trim() || undefined),
        senhaNewpost: opcoes.senhaNewpost,
        bio: bio.trim() || undefined,
      })
      setPedindoNome(null)
      setPedindoSenha(null)

      const { imagens, audio } = await prepararMidia()

      setEstado('enviando')
      const r = await publicarNaNewPost({ texto, imagens, audio, chaveUnica }, sessao)
      setResultado(r)
      setEstado('pronto')
    } catch (e) {
      if (e instanceof PrecisaNomeNewPost) {
        setPedindoNome({ sugestao: e.sugestao })
        const nome = nomePerfil || e.sugestao
        if (!nomePerfil) setNomePerfil(e.sugestao)
        setEstado('parado')
        // Dispara sem await: o cliente já vê o campo do nome e começa a ler enquanto a
        // bio é escrita. Só na primeira vez — se ele cancelar e voltar, o texto que já
        // estava lá é preservado.
        if (!bio) void gerarBio(nome).catch(() => {})
        return
      }
      if (e instanceof PrecisaSenhaNewPost) {
        // Fecha a pergunta do nome ANTES de abrir a da senha: na renderizacao o bloco
        // do nome vem primeiro, entao deixa-lo aberto prendia o cliente que ja tem
        // conta na mesma tela, sem nunca ver o campo de senha. O nome digitado fica
        // no estado `nomePerfil` e viaja junto na proxima tentativa.
        setPedindoNome(null)
        setPedindoSenha({ email: e.email })
        setEstado('parado')
        return
      }
      setErro(e instanceof Error ? e.message : 'Não consegui publicar.')
      setEstado('parado')
    }
  }

  if (estado === 'pronto' && resultado) {
    return (
      <div className="no-export space-y-2 pt-1">
        <div className="flex items-center gap-2 text-[#22C55E] text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Publicado na NewPost-IA</span>
          <a
            href={URL_NEWPOST}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-xs text-[#8B5CF6] hover:underline"
          >
            Ver no feed <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* Conta criada agora: sem mostrar a senha, o cliente ficaria com um perfil
            na rede sem saber como entrar nele depois. */}
        {resultado.contaCriadaAgora && resultado.senhaGerada && (
          <div className="rounded-lg border border-[#8B5CF6]/40 bg-[#8B5CF6]/10 p-3 text-xs space-y-1">
            <p className="text-white font-medium">Criamos sua conta na NewPost-IA</p>
            <p className="text-gray-300">
              E-mail: <span className="text-white">{resultado.email}</span>
            </p>
            <p className="text-gray-300">
              Senha: <span className="text-white font-mono">{resultado.senhaGerada}</span>
            </p>
            <p className="text-gray-500">
              Anote agora — só mostramos uma vez. Você pode trocá-la depois dentro da rede.
            </p>
          </div>
        )}
      </div>
    )
  }

  // Primeira publicação: quem escolhe o nome público do perfil é o CLIENTE. A sugestão
  // vem preenchida só pra ele não começar do zero — e é editável. Antes a gente usava o
  // campo "Nicho" sem perguntar, e quem digitava "padaria em BH" nascia com isso de nome.
  if (pedindoNome) {
    return (
      <div className="no-export space-y-2 pt-1 rounded-lg border border-gray-700 bg-[#0A0A0A] p-3">
        <p className="text-xs text-gray-300 flex items-start gap-1.5">
          <AtSign className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#0EA5A4]" />
          Como você quer aparecer na NewPost-IA? É o nome que o público vê no seu perfil —
          você pode mudar depois, dentro da rede.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={nomePerfil}
            onChange={(e) => setNomePerfil(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && nomePerfil.trim() && estado === 'parado') publicar({ nomePerfil: nomePerfil.trim() }) }}
            placeholder="Nome do seu perfil"
            maxLength={60}
            autoFocus
            className="flex-1 p-2 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white placeholder-gray-600 text-sm focus:outline-none focus:border-[#0EA5A4]"
          />
          <Button
            onClick={() => publicar({ nomePerfil: nomePerfil.trim() })}
            disabled={!nomePerfil.trim() || estado !== 'parado'}
            className="bg-[#0EA5A4] hover:opacity-90 disabled:opacity-50 px-3"
          >
            Continuar
          </Button>
        </div>
        {/* Bio: escrita pela IA a partir do nicho que ele já digitou, e editável. Antes
            todo perfil criado por nós nascia com a bio fixa "Publicando com o VoiceFlow
            IA" — quem clicava no perfil da padaria lia propaganda da nossa ferramenta em
            vez de qualquer coisa sobre a padaria, e todos os clientes ficavam iguais. */}
        <div className="space-y-1 pt-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-400">Sua bio no perfil</span>
            <button
              onClick={() => gerarBio(nomePerfil || pedindoNome.sugestao)}
              disabled={gerandoBio || !nomePerfil.trim()}
              title="Escrever outra bio (usa o nome que está no campo acima)"
              className="text-gray-500 hover:text-gray-300 disabled:opacity-40"
            >
              {gerandoBio ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </button>
            <span className={`ml-auto text-[10px] ${bio.length > LIMITE_BIO ? 'text-red-400' : 'text-gray-600'}`}>
              {bio.length}/{LIMITE_BIO}
            </span>
          </div>
          <textarea
            value={bio}
            onChange={(e) => setBio(limitarBio(e.target.value))}
            rows={2}
            placeholder={gerandoBio ? 'Escrevendo sua bio…' : 'Conte em uma linha o que seu negócio faz (opcional)'}
            className="w-full p-2 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white placeholder-gray-600 text-xs resize-y focus:outline-none focus:border-[#0EA5A4]"
          />
        </div>

        {/* Cancelar limpa tambem os campos: a sugestao vem preenchida por nos, e se ela
            sobrevivesse ao cancelamento o proximo clique em "Publicar" criaria o perfil
            com um nome que o cliente nunca confirmou. Ao reabrir, a sugestao volta. */}
        <button onClick={() => { setPedindoNome(null); setNomePerfil(''); setBio(''); pedidoBioRef.current++ }} className="text-xs text-gray-500 hover:text-gray-300">
          Cancelar
        </button>
        {erro && <p className="text-yellow-500 text-xs">{erro}</p>}
      </div>
    )
  }

  if (pedindoSenha) {
    return (
      <div className="no-export space-y-2 pt-1 rounded-lg border border-gray-700 bg-[#0A0A0A] p-3">
        <p className="text-xs text-gray-300 flex items-start gap-1.5">
          <KeyRound className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#8B5CF6]" />
          Você já tem conta na NewPost-IA com <span className="text-white">{pedindoSenha.email}</span>.
          Informe a senha uma vez — depois disso não perguntamos mais.
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && senha) publicar({ senhaNewpost: senha }) }}
            placeholder="Senha da NewPost-IA"
            className="flex-1 p-2 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white placeholder-gray-600 text-sm focus:outline-none focus:border-[#8B5CF6]"
          />
          <Button
            onClick={() => publicar({ senhaNewpost: senha })}
            disabled={!senha || estado !== 'parado'}
            className="bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 px-3"
          >
            Conectar
          </Button>
        </div>
        <button onClick={() => { setPedindoSenha(null); setSenha('') }} className="text-xs text-gray-500 hover:text-gray-300">
          Cancelar
        </button>
        {erro && <p className="text-yellow-500 text-xs">{erro}</p>}
      </div>
    )
  }

  const ocupado = estado !== 'parado'
  return (
    <div className="no-export space-y-1 pt-1">
      <Button
        onClick={() => publicar()}
        disabled={disabled || ocupado}
        title="Publica este conteúdo no feed da NewPost-IA, no seu nome — com os cards e a locução"
        className="w-full bg-gradient-to-r from-[#0EA5A4] to-[#22C55E] hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        {estado === 'preparando' ? 'Preparando cards e áudio…'
          : estado === 'enviando' ? 'Publicando…'
          : 'Publicar na NewPost-IA'}
      </Button>
      {erro && <p className="text-yellow-500 text-xs">{erro}</p>}
    </div>
  )
}
