// Resultado da conferência de preço/porcentagem/promessa de um post do Super Agente contra o
// briefing (src/lib/conferirCatalogo.ts → conferirPostDaMarca). É AVISO, não trava: o
// cliente pode ter um preço verdadeiro que só esqueceu de escrever no briefing.
//
// `onde="kit"` (10/11/2026): a mesma régua no Kit de Respostas de WhatsApp, com as palavras
// daquela tela ("Fatos da sua marca", "resposta", "usar"). Sem a prop, o Super Agente fica
// letra por letra como antes.
export function AvisoConferencia({ avisos, onde = 'post' }: { avisos: string[]; onde?: 'post' | 'kit' }) {
  const kit = onde === 'kit'
  if (avisos.length === 0) {
    return (
      <p className="text-xs text-emerald-400/80" data-testid="conferencia-ok">
        {kit
          ? '✅ Conferido: preços, porcentagens e promessas comuns batem com os Fatos da sua marca.'
          : '✅ Conferido: preços, porcentagens e promessas comuns (frete, desconto, parcelamento, garantia, urgência, fama) batem com o seu briefing.'}
      </p>
    )
  }
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200" data-testid="conferencia-avisos">
      <p className="font-semibold mb-1">{kit ? '⚠️ Confira antes de usar' : '⚠️ Confira antes de postar'}</p>
      <ul className="list-disc pl-4 space-y-0.5">
        {avisos.map((a, i) => <li key={i}>{kit ? a.replace(/no briefing/g, 'nos Fatos da sua marca') : a}</li>)}
      </ul>
      <p className="mt-1 text-amber-300/70">
        {kit
          ? 'Se for verdade, acrescente nos Fatos da sua marca. Se não for, edite a resposta.'
          : 'Se for verdade, acrescente no briefing (Serviços ou Diferenciais). Se não for, edite o post.'}
      </p>
    </div>
  )
}
