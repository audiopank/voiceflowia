// Resultado da conferência de preço/porcentagem/promessa de um post do Super Agente contra o
// briefing (src/lib/conferirCatalogo.ts → conferirPostDaMarca). É AVISO, não trava: o
// cliente pode ter um preço verdadeiro que só esqueceu de escrever no briefing.
export function AvisoConferencia({ avisos }: { avisos: string[] }) {
  if (avisos.length === 0) {
    return (
      <p className="text-xs text-emerald-400/80" data-testid="conferencia-ok">
        ✅ Conferido: preços, porcentagens e promessas comuns (frete, desconto, parcelamento, garantia, urgência, fama) batem com o seu briefing.
      </p>
    )
  }
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200" data-testid="conferencia-avisos">
      <p className="font-semibold mb-1">⚠️ Confira antes de postar</p>
      <ul className="list-disc pl-4 space-y-0.5">
        {avisos.map((a, i) => <li key={i}>{a}</li>)}
      </ul>
      <p className="mt-1 text-amber-300/70">
        Se for verdade, acrescente no briefing (Serviços ou Diferenciais). Se não for, edite o post.
      </p>
    </div>
  )
}
