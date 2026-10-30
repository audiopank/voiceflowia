import { useEffect, useState } from 'react'
import { COR_FUNDO_PADRAO, COR_DESTAQUE_PADRAO } from './estiloCard'

// As cores escolhidas (fundo + destaque) valem pra TODOS os cards do VoiceFlow — Card
// Mágico e carrossel do Super Agente/Agente — e ficam lembradas NESTE navegador
// (conveniência, não dado da conta). "Cores da minha marca" na conta = fase seguinte.
const CHAVE_ESTILO = 'vfia:card-estilo'

function lerEstiloSalvo(): { fundo: string; destaque: string } {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_ESTILO) || 'null')
    const hex = (v: unknown) => typeof v === 'string' && /^#[0-9A-F]{6}$/i.test(v)
    if (salvo && hex(salvo.fundo) && hex(salvo.destaque)) return salvo
  } catch { /* navegador sem storage: usa o padrão */ }
  return { fundo: COR_FUNDO_PADRAO, destaque: COR_DESTAQUE_PADRAO }
}

export function useEstiloCard() {
  const [corFundo, setCorFundo] = useState(() => lerEstiloSalvo().fundo)
  const [corDestaque, setCorDestaque] = useState(() => lerEstiloSalvo().destaque)

  useEffect(() => {
    try { localStorage.setItem(CHAVE_ESTILO, JSON.stringify({ fundo: corFundo, destaque: corDestaque })) } catch { /* sem storage */ }
  }, [corFundo, corDestaque])

  return { corFundo, setCorFundo, corDestaque, setCorDestaque }
}
