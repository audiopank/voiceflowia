// Roda a régua REAL do VoiceFlow (conferirPostDaMarca) em cada peça de uma campanha.
// Uso (da raiz do repo): node --experimental-strip-types --no-warnings .claude/skills/conferir-campanha/scripts/regua.mts pecas.txt [fatos.txt]
// Peças separadas por uma linha só com "---". Fatos padrão = references/verdades-voiceflow.md.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { conferirPostDaMarca } from '../../../../src/lib/conferirCatalogo.ts'

const [arqPecas, arqFatos] = process.argv.slice(2)
if (!arqPecas) { console.error('uso: regua.mts pecas.txt [fatos.txt]'); process.exit(1) }
// Só o que vem antes de "## Armadilhas": a lista de armadilhas cita palavras vetadas e não pode virar lastro.
const fatos = readFileSync(arqFatos ?? fileURLToPath(new URL('../references/verdades-voiceflow.md', import.meta.url)), 'utf8').split(/^## /m)[0]
const pecas = readFileSync(arqPecas, 'utf8').split(/^\s*---\s*$/m).map((p) => p.trim()).filter(Boolean)

let comAviso = 0
pecas.forEach((texto, i) => {
  const { avisos } = conferirPostDaMarca({ gancho: '', legenda: '', locucao: texto } as any, fatos)
  if (avisos.length) comAviso++
  const titulo = texto.split('\n')[0].slice(0, 60)
  console.log(`Peça ${i + 1} (${titulo}): ${avisos.length ? avisos.map((a) => '⚠️ ' + a).join(' | ') : 'sem aviso'}`)
})
console.log(`\n${pecas.length} peças, ${comAviso} com aviso da régua.`)
