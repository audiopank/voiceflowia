// Partes puras do vídeo dos cards (src/lib/videoDosCards.ts): troca entre cards e encaixe no 9:16.
// A montagem do MP4 em si roda no navegador — ver tests/e2e/video-cards-e2e.cjs.
// Rodar: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trocaDeCard, caixaDoCard } from '../src/lib/videoDosCards.ts'

test('3 cards em 30 s: fatias de 10 s, transição suave de 0,6 s nas trocas', () => {
  assert.deepEqual(trocaDeCard(1, 30, 3), { de: 0, para: 0, alfa: 0 })
  assert.deepEqual(trocaDeCard(15, 30, 3), { de: 1, para: 1, alfa: 0 })
  assert.deepEqual(trocaDeCard(29.9, 30, 3), { de: 2, para: 2, alfa: 0 }) // sem troca fantasma no fim
  const meio = trocaDeCard(10, 30, 3)
  assert.equal(meio.de, 0); assert.equal(meio.para, 1); assert.ok(Math.abs(meio.alfa - 0.5) < 1e-9)
  const antes = trocaDeCard(9.75, 30, 3), depois = trocaDeCard(10.25, 30, 3)
  assert.ok(antes.alfa > 0 && antes.alfa < 0.5 && depois.alfa > 0.5 && depois.alfa < 1)
  assert.deepEqual(trocaDeCard(10.4, 30, 3), { de: 1, para: 1, alfa: 0 })
})

test('casos de borda: 1 card, áudio vazio', () => {
  assert.deepEqual(trocaDeCard(5, 30, 1), { de: 0, para: 0, alfa: 0 })
  assert.deepEqual(trocaDeCard(0, 0, 3), { de: 0, para: 0, alfa: 0 })
})

test('card 1080x1350 ocupa a largura toda, centralizado no 1080x1920', () => {
  assert.deepEqual(caixaDoCard(1080, 1350), { x: 0, y: 285, w: 1080, h: 1350 })
})
