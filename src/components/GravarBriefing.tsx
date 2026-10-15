import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'

// BRIEFING POR VOZ (15/10/2026): o cliente fala sobre a marca (até 1 min), a IA transcreve
// e o TEXTO entra na caixa "Comece rápido" — ele confere/corrige e só então toca em
// "Preencher com IA". Mesmo padrão da pergunta por voz da NewPost-IA. O áudio não é guardado.
// 1 min (não 2): a transcrição roda numa função Edge de teto ~22s; no teste de 15/10 30s de fala
// levaram 18s com a fila cheia. 1 min basta pra contar a marca.
const LIMITE_S = 60

export function GravarBriefing({ onTexto, disabled }: { onTexto: (texto: string) => void; disabled?: boolean }) {
  const [gravando, setGravando] = useState(false)
  const [ouvindo, setOuvindo] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const [aviso, setAviso] = useState('')
  const [erro, setErro] = useState('')
  const gravadorRef = useRef<MediaRecorder | null>(null)
  const pedacosRef = useRef<Blob[]>([])
  const relogioRef = useRef<number | null>(null)

  const podeGravar = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

  useEffect(() => () => {
    if (relogioRef.current) window.clearInterval(relogioRef.current)
    // Saiu da tela gravando: descarta (sem onstop, o áudio não é enviado pra ninguém ouvir).
    if (gravadorRef.current) gravadorRef.current.onstop = null
    gravadorRef.current?.stream.getTracks().forEach((t) => t.stop())
  }, [])

  // Teto de 1 min: para sozinho e transcreve o que foi falado.
  useEffect(() => {
    if (gravando && segundos >= LIMITE_S) parar()
  }, [gravando, segundos])

  async function comecar() {
    if (gravando || ouvindo || disabled) return
    setErro('')
    setAviso('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const gravador = new MediaRecorder(stream)
      pedacosRef.current = []
      gravador.ondataavailable = (e) => { if (e.data.size) pedacosRef.current.push(e.data) }
      gravador.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        if (relogioRef.current) { window.clearInterval(relogioRef.current); relogioRef.current = null }
        void transcrever(new Blob(pedacosRef.current, { type: gravador.mimeType || 'audio/webm' }))
      }
      gravadorRef.current = gravador
      gravador.start()
      setSegundos(0)
      setGravando(true)
      relogioRef.current = window.setInterval(() => setSegundos((s) => s + 1), 1000)
    } catch {
      setErro('Não consegui usar o microfone. Libere a permissão no navegador ou escreva o briefing.')
    }
  }

  function parar() {
    const g = gravadorRef.current
    if (g && g.state !== 'inactive') g.stop()
    setGravando(false)
  }

  async function transcrever(blob: Blob) {
    if (blob.size < 2000) { setAviso('Não deu pra ouvir nada. Toque no microfone e fale de novo.'); return }
    setOuvindo(true)
    try {
      const audio = await new Promise<string>((ok, falha) => {
        const leitor = new FileReader()
        leitor.onload = () => ok(String(leitor.result || ''))
        leitor.onerror = () => falha(leitor.error)
        leitor.readAsDataURL(blob)
      })
      const r = await fetch('/api/gemini/extrair-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio, mime: blob.type })
      })
      // Corpo pode não ser JSON (página de erro da Vercel): ler como texto primeiro.
      const bruto = await r.text()
      let dados: any = null
      try { dados = JSON.parse(bruto) } catch { /* segue com null */ }
      if (!r.ok || !dados) { setErro(dados?.error || `Não consegui ouvir agora (erro ${r.status}). Tente de novo ou escreva.`); return }
      if (!dados.entendeu) { setAviso('Não entendi o áudio. Tente de novo num lugar mais silencioso, ou escreva.'); return }
      onTexto(String(dados.texto || ''))
      setAviso('Confira o que eu entendi na caixa acima, corrija se precisar e clique em Preencher com IA.')
    } catch {
      setErro('Sem conexão agora. Tente de novo ou escreva o briefing.')
    } finally {
      setOuvindo(false)
    }
  }

  if (!podeGravar) return null
  const mm = `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={gravando ? parar : comecar}
        disabled={ouvindo || (disabled && !gravando)}
        className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium border disabled:opacity-40 ${
          gravando ? 'bg-red-600/20 border-red-500 text-red-200 animate-pulse' : 'bg-[#1A1A1A] border-gray-700 text-gray-200 hover:border-[#8B5CF6]'
        }`}
      >
        {ouvindo ? <><Loader2 className="w-4 h-4 animate-spin" /> Ouvindo…</>
          : gravando ? <><Square className="w-4 h-4" /> Parar ({mm} de 1:00)</>
          : <><Mic className="w-4 h-4" /> Falar o briefing</>}
      </button>
      {aviso && <p className="text-xs text-[#F59E0B]">{aviso}</p>}
      {erro && <p className="text-xs text-red-300">{erro}</p>}
    </div>
  )
}
