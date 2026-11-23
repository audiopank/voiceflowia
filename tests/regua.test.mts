// Testes da CONFERÊNCIA DE PROMESSAS (src/lib/conferirCatalogo.ts) — cada caso aqui foi uma frase
// REAL que escapou ou um falso alarme achado em teste. Guardados no repo em 23/11/2026: os testes
// soltos na pasta temporária foram apagados 2 vezes pela limpeza.
// Rodar: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conferirPost, conferirPostDaMarca } from '../src/lib/conferirCatalogo.ts'

const post = (legenda: string) => ({ gancho: '', legenda, locucao: '' })
const avisos = (texto: string, fatos: string) => conferirPostDaMarca(post(texto), fatos).avisos.join(' | ')

// Catálogo: trava (aprovado = false) quando a promessa não tem lastro no produto nem nos fatos.
const spot = { nome: 'Spot de 30s', preco: 'R$ 50,00', detalhes: 'roteiro e locução' } as any
const catalogo = (legenda: string, fatos = 'Locutores IA.', item = spot) =>
  conferirPost({ gancho: item.nome, legenda, locucao: 'Spot.' }, item, 0, fatos).aprovado

// Briefing real do teste do Mestre (Super Agente, Locutores IA, 23/11)
const LOCUTORES = 'VERSÃO COM URGÊNCIA - PRA QUEM JÁ TÁ PERDENDO CLIENTE\nTá perdendo cliente porque não dá conta de entregar? Não perde mais! Locutores IA - Áudio Pank Produtora entra com a escala da sua agência. Mais volume, mais rápido, sem contratar locutor! Chama agora no WhatsApp: 85 9 9226-2297\n\nLocutores IA\nUrgente, direto\nChama agora no WhatsApp\nMais volume, mais rápido, sem contratar locutor!'

test('garantia: "garantem" e "garante (a) qualidade" avisam; o convite "Garante já o seu!" não (23/11)', () => {
  assert.match(avisos('Os Locutores IA garantem velocidade extrema e alto volume pra sua equipe.', LOCUTORES), /garantia/)
  assert.match(avisos('A Áudio Pank garante qualidade em cada spot.', LOCUTORES), /garantia/)
  assert.match(avisos('Garante a qualidade do seu anúncio.', LOCUTORES), /garantia/)
  assert.equal(avisos('Garante já o seu! Chama agora no WhatsApp.', LOCUTORES), '')
  assert.ok(catalogo('Spot de 30s por R$ 50,00. Garante o seu!'))
  assert.ok(catalogo('Spot de 30s por R$ 50,00. Garanta já!'))
  assert.ok(catalogo('Spot de 30s por R$ 50,00. Garante a sua vaga!'))
  assert.ok(!catalogo('Spot de 30s por R$ 50,00. Garantem qualidade.'))
})

test('exagero: velocidade extrema, impecável, tempo recorde (23/11)', () => {
  assert.match(avisos('Os Locutores IA garantem velocidade extrema e alto volume.', LOCUTORES), /exagero/)
  assert.match(avisos('Entregue áudios impecáveis em tempo recorde.', LOCUTORES), /exagero/)
  assert.ok(!catalogo('Spot de 30s por R$ 50,00 com entrega em tempo recorde.'))
  assert.ok(!catalogo('Spot de 30s por R$ 50,00, acabamento impecável.'))
  // com lastro, libera
  assert.equal(avisos('Acabamento impecável.', 'Acabamento impecável em todas as peças.'), '')
  assert.ok(catalogo('Spot de 30s por R$ 50,00, acabamento impecável.', 'Locutores IA.', { ...spot, detalhes: 'acabamento impecável' }))
  assert.ok(catalogo('Spot de 30s por R$ 50,00. Sainha impecavelmente.'))
})

test('certeza sobre cliente: "nenhum cliente fugir/perdido" (23/11)', () => {
  assert.match(avisos('Sua produtora não deixa nenhum cliente fugir pra concorrência.', LOCUTORES), /certeza de resultado/)
  assert.ok(!catalogo('Spot de 30s por R$ 50,00. Nenhum cliente sai insatisfeito.'))
  assert.ok(catalogo('Spot de 30s por R$ 50,00. Nenhum cliente saiu daqui sem sorrir.'))
})

test('o que está no briefing vale como lastro', () => {
  assert.equal(avisos('Mais volume e mais rápido, sem contratar locutor.', LOCUTORES), '')
  assert.ok(catalogo('Spot de 30s por R$ 50,00 com roteiro e locução.'))
})

test('resultado garantido: faturar/lucrar/vender mais; "fatura" substantivo não (13/11)', () => {
  assert.match(avisos('Quer faturar mais na Black Friday?', 'Locutores IA.'), /resultado garantido/)
  assert.match(avisos('Aumente suas vendas com uma voz profissional.', 'Locutores IA.'), /resultado garantido/)
  assert.doesNotMatch(avisos('Pague a fatura mais rápido pelo app.', 'Locutores IA.'), /resultado garantido/)
  assert.ok(!catalogo('Spot de 30s por R$ 50,00. Venda mais!'))
})

test('"O que NÃO fazemos" e "não possuem/tem" nunca viram lastro (09/11, 12/11)', () => {
  assert.match(avisos('Achadinhos com frete grátis!', 'Achadinhos; não possuem frete grátis.'), /frete/)
  assert.match(avisos('Achadinhos com frete grátis!', 'Ela não tem frete grátis.'), /frete/)
  assert.doesNotMatch(avisos('Achadinhos com frete grátis!', 'Frete grátis acima de R$ 99.'), /frete/)
  const bolo = { nome: 'Bolo de pote', preco: 'R$ 12,00', detalhes: '' } as any
  assert.ok(!catalogo('Bolo de pote por R$ 12,00 com frete grátis!', 'Padaria.\nO que NÃO fazemos: não temos frete grátis.', bolo))
})

test('porcentagem: "10%" sem lastro avisa; "100% online" não (10/11)', () => {
  assert.match(avisos('Ganhe 10% hoje.', 'Locutores IA.'), /orcentagem/)
  assert.doesNotMatch(avisos('Atendimento 100% online.', 'Locutores IA.'), /orcentagem/)
})
