import { useCallback, useEffect, useRef, useState } from 'react'
import { COR_FUNDO_PADRAO, COR_DESTAQUE_PADRAO } from './estiloCard'
import { carregarMinhaMarca, salvarCoresMarca } from './minhaMarca'

// As cores escolhidas (fundo + destaque) valem pra TODOS os cards do VoiceFlow — Card
// Mágico e carrossel do Super Agente/Agente. Desde 12/11/2026 ficam NA CONTA (marca_perfil):
// o navegador só dá o valor instantâneo enquanto a conta responde.
const CHAVE_ESTILO = 'vfia:card-estilo'
const hex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9A-F]{6}$/i.test(v)

function lerEstiloSalvo(): { fundo: string; destaque: string } {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_ESTILO) || 'null')
    if (salvo && hex(salvo.fundo) && hex(salvo.destaque)) return salvo
  } catch { /* navegador sem storage: usa o padrão */ }
  return { fundo: COR_FUNDO_PADRAO, destaque: COR_DESTAQUE_PADRAO }
}

export function useEstiloCard() {
  const [corFundo, setFundo] = useState(() => lerEstiloSalvo().fundo)
  const [corDestaque, setDestaque] = useState(() => lerEstiloSalvo().destaque)
  // O que está gravado na conta ("fundo|destaque"); null = a conta ainda não respondeu.
  const [naConta, setNaConta] = useState<string | null>(null)
  const mexeu = useRef(false)

  useEffect(() => {
    let vivo = true
    carregarMinhaMarca().then((m) => {
      if (!vivo) return
      const daConta = m && hex(m.corFundo) && hex(m.corDestaque) ? `${m.corFundo}|${m.corDestaque}` : ''
      // A conta vence o navegador — a não ser que o cliente já tenha trocado a cor nesta tela.
      if (m && daConta && !mexeu.current) {
        setFundo(m.corFundo!)
        setDestaque(m.corDestaque!)
      }
      setNaConta(daConta)
    })
    return () => { vivo = false }
  }, [])

  useEffect(() => {
    try { localStorage.setItem(CHAVE_ESTILO, JSON.stringify({ fundo: corFundo, destaque: corDestaque })) } catch { /* sem storage */ }
    const atual = `${corFundo}|${corDestaque}`
    // Só grava escolha do cliente (nunca a cor padrão de quem não mexeu) e só depois de a conta responder.
    if (naConta === null || !mexeu.current || atual === naConta) return
    setNaConta(atual)
    void salvarCoresMarca(corFundo, corDestaque)
  }, [corFundo, corDestaque, naConta])

  const setCorFundo = useCallback((c: string) => { mexeu.current = true; setFundo(c) }, [])
  const setCorDestaque = useCallback((c: string) => { mexeu.current = true; setDestaque(c) }, [])
  return { corFundo, setCorFundo, corDestaque, setCorDestaque }
}
