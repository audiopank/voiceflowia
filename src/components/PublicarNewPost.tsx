import { useState } from 'react'
import { Send, Loader2, CheckCircle2, ExternalLink, KeyRound } from 'lucide-react'
import { Button } from './ui/button'
import {
  obterSessaoNewPost,
  publicarNaNewPost,
  PrecisaSenhaNewPost,
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
  marca: string
  chaveUnica: string
  prepararMidia: () => Promise<{ imagens: Blob[]; audio: Blob | null }>
  disabled?: boolean
}) {
  const [estado, setEstado] = useState<'parado' | 'preparando' | 'enviando' | 'pronto'>('parado')
  const [erro, setErro] = useState('')
  const [pedindoSenha, setPedindoSenha] = useState<{ email: string } | null>(null)
  const [senha, setSenha] = useState('')
  const [resultado, setResultado] = useState<ResultadoPublicacao | null>(null)

  async function publicar(senhaNewpost?: string) {
    setErro('')
    try {
      // A conta vem primeiro: se o cliente precisar informar a senha, é melhor descobrir
      // isso ANTES de gastar tempo renderizando 4 PNGs e convertendo áudio.
      setEstado('preparando')
      const sessao = await obterSessaoNewPost(marca, senhaNewpost)
      setPedindoSenha(null)

      const { imagens, audio } = await prepararMidia()

      setEstado('enviando')
      const r = await publicarNaNewPost({ texto, imagens, audio, chaveUnica }, sessao)
      setResultado(r)
      setEstado('pronto')
    } catch (e) {
      if (e instanceof PrecisaSenhaNewPost) {
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
            onKeyDown={(e) => { if (e.key === 'Enter' && senha) publicar(senha) }}
            placeholder="Senha da NewPost-IA"
            className="flex-1 p-2 bg-[#1A1A1A] border border-gray-700 rounded-lg text-white placeholder-gray-600 text-sm focus:outline-none focus:border-[#8B5CF6]"
          />
          <Button
            onClick={() => publicar(senha)}
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
