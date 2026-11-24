// 👍 "Esse funcionou" (24/11/2026): partes puras — o que entra no pedido à IA e quais exemplos vão.
// Rodar: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { limparExemplos, blocoExemplos } from '../api/_lib/exemplosQueFuncionaram.ts'
import { chaveNicho, exemplosDoNicho } from '../src/lib/exemplosDoNicho.ts'

test('sem exemplo marcado: o pedido à IA fica IDÊNTICO ao de antes', () => {
  assert.equal(blocoExemplos([]), '')
  assert.equal(blocoExemplos(limparExemplos(undefined)), '')
  assert.equal(blocoExemplos(limparExemplos('lixo')), '')
})

test('o servidor só aceita texto, corta tamanho, descarta vazio e fica em 3', () => {
  const bruto = [
    { hook: 'A'.repeat(500), roteiro: 'r', legenda: 'l' },
    { hook: 123, roteiro: { x: 1 }, legenda: null }, // tudo inválido → vazio → sai
    { hook: 'B' }, { hook: 'C' }, { hook: 'D' },
  ]
  const ex = limparExemplos(bruto)
  assert.equal(ex.length, 3)
  assert.equal(ex[0].hook.length, 200)
  assert.deepEqual(ex.map((e) => e.hook[0]), ['A', 'B', 'C'])
})

test('o bloco ensina o JEITO e proíbe copiar e usar os fatos dos exemplos', () => {
  const b = blocoExemplos([{ hook: 'Bolo de pote por R$ 12', roteiro: 'Roteiro.', legenda: 'Legenda.' }])
  assert.match(b, /MARCOU COMO "FUNCIONOU"/)
  assert.match(b, /Bolo de pote por R\$ 12/)
  assert.match(b, /NÃO copie frases/)
  assert.match(b, /BORDÕES da marca/) // 24/11: teste real — sem isto a IA largava "Psiu!" e a chamada da marca
  assert.match(b, /NÃO repita esses ganchos/)
  assert.match(b, /NÃO são fatos deste pedido/)
})

test('exemplos: só do mesmo nicho (ignora acento, caixa e espaço), mais recentes, até 3', () => {
  const linhas = [
    { nicho: 'Estética ', hook: 'h1', roteiro: '', legenda: '' },
    { nicho: 'Padaria', hook: 'outro nicho', roteiro: '', legenda: '' },
    { nicho: 'estetica', hook: 'h2', roteiro: '', legenda: '' },
    { nicho: 'ESTÉTICA', hook: '', roteiro: '', legenda: '' }, // vazio → sai
    { nicho: 'Estética', hook: 'h3', roteiro: '', legenda: '' },
    { nicho: 'Estética', hook: 'h4', roteiro: '', legenda: '' },
  ]
  assert.deepEqual(exemplosDoNicho(linhas, 'estética').map((e) => e.hook), ['h1', 'h2', 'h3'])
  assert.deepEqual(exemplosDoNicho(linhas, 'Barbearia'), [])
  assert.equal(chaveNicho('  Estética   Avançada '), 'estetica avancada')
})
