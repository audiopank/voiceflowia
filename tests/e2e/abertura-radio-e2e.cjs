// COMO RODAR: com o dev server ligado (npx vite --port 5181 --strictPort), num terminal Git Bash:
//   NODE_PATH="$(npm config get cache)/_npx/<pasta-do-playwright>/node_modules" node tests/e2e/abertura-radio-e2e.cjs
// (o Playwright não é dependência do projeto; vem do npx). Login, plano e IA são SIMULADOS — nada real é tocado.
// Os testes de vídeo usam o Microsoft Edge (channel 'msedge'): o Chromium do Playwright não tem AAC.
// E2E 23/11: abertura de rádio medida no renderMix REAL (Chromium), com sinais conhecidos.
const { chromium } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:5181'
const ok = []; const falha = []
const conferir = (c, m) => (c ? ok : falha).push(m)

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.addInitScript(() => new MutationObserver(() => document.querySelectorAll('vite-error-overlay').forEach((e) => e.remove())).observe(document, { childList: true, subtree: true }))
  await page.goto(`${BASE}/`)
  const r = await page.evaluate(async () => {
    const { renderMix } = await import('/src/lib/audioMix.ts')
    const { aplicarTrilha, ABERTURA_TRILHA_SEGUNDOS } = await import('/src/lib/estudioCards.ts')
    const SR = 44100
    const buf = (seg, f) => { const b = new AudioBuffer({ length: Math.round(seg * SR), sampleRate: SR, numberOfChannels: 1 }); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = f(i / SR); return b }
    const rms = (b, t0, t1) => { const d = b.getChannelData(0); let s = 0, n = 0; for (let i = Math.round(t0 * SR); i < Math.round(t1 * SR); i++) { s += d[i] * d[i]; n++ } return Math.sqrt(s / n) }
    const seno = (amp, hz) => (t) => amp * Math.sin(2 * Math.PI * hz * t)
    const voz = buf(2, seno(1, 440)), vozMuda = buf(2, () => 0)
    const trilha = buf(10, seno(1, 220)), trilhaMuda = buf(10, () => 0)

    // A) onde a voz começa: trilha muda + intro 2 s
    const a = await renderMix(voz, trilhaMuda, 1, 0.2, 2)
    // B) volumes da música: voz muda + trilha alta + intro 2 s, cama 0.2
    const b = await renderMix(vozMuda, trilha, 1, 0.2, 2)
    // C) sem trilha: intro ignorada, voz começa no 0
    const c = await renderMix(voz, null, 1, 0.2, 2)
    // D) chamada antiga (Editor): sem intro, igual a antes
    const d = await renderMix(voz, trilha, 1, 0.2)
    // E) aplicarTrilha (o que as telas usam) entrega a abertura
    const wav = (ab) => { const n = ab.length, out = new DataView(new ArrayBuffer(44 + n * 2)); const w = (o, s) => [...s].forEach((ch, i) => out.setUint8(o + i, ch.charCodeAt(0))); w(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, SR, true); out.setUint32(28, SR * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * 2, true); const ch = ab.getChannelData(0); for (let i = 0; i < n; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, ch[i])) * 32767, true); return new Blob([out], { type: 'audio/wav' }) }
    const eBlob = await aplicarTrilha(wav(voz), trilha, 20)
    const eBuf = await new AudioContext().decodeAudioData(await eBlob.arrayBuffer())
    return {
      abertura: ABERTURA_TRILHA_SEGUNDOS,
      a: { dur: a.duration, antes: rms(a, 0.1, 1.9), depois: rms(a, 2.1, 3.9) },
      b: { inicio: rms(b, 0, 0.05), abertura: rms(b, 0.6, 1.5), cama: rms(b, 2.2, 3.8), fim: rms(b, b.duration - 0.05, b.duration) },
      c: { dur: c.duration, inicio: rms(c, 0.05, 0.5) },
      d: { dur: d.duration, inicio: rms(d, 0.05, 0.5) },
      e: { dur: eBuf.duration },
    }
  })
  const f = (x) => x.toFixed(3)
  conferir(r.abertura === 2, 'abertura padrão das telas = 2 s')
  conferir(r.a.antes < 0.01 && r.a.depois > 0.6, `a voz só entra em 2 s (antes ${f(r.a.antes)}, depois ${f(r.a.depois)})`)
  conferir(r.b.inicio < 0.05, `a música começa do silêncio, sem estalo (${f(r.b.inicio)})`)
  conferir(Math.abs(r.b.abertura - 0.5 / Math.SQRT2) < 0.03, `abertura em 2,5x a cama (rms ${f(r.b.abertura)} ≈ 0.354)`)
  conferir(Math.abs(r.b.cama - 0.2 / Math.SQRT2) < 0.02, `com a voz, a música abaixa até a cama escolhida (rms ${f(r.b.cama)} ≈ 0.141)`)
  conferir(r.b.fim < 0.02, `no fim desce até o silêncio (${f(r.b.fim)})`)
  conferir(Math.abs(r.c.dur - 2.3) < 0.02 && r.c.inicio > 0.6, `sem trilha: nada de silêncio no começo (dur ${f(r.c.dur)} s, voz já no início)`)
  conferir(Math.abs(r.d.dur - 3.2) < 0.02 && r.d.inicio > 0.6, `Editor (sem intro): igual a antes (dur ${f(r.d.dur)} s)`)
  conferir(Math.abs(r.e.dur - 5.2) < 0.05, `aplicarTrilha (telas) entrega voz 2 s + abertura 2 s + fade (dur ${f(r.e.dur)} s ≈ 5.2)`)

  await browser.close()
  console.log(ok.map((m) => '✅ ' + m).join('\n'))
  console.log(falha.map((m) => '❌ ' + m).join('\n'))
  console.log(`${ok.length}/${ok.length + falha.length}`)
  process.exit(falha.length ? 1 : 0)
})().catch((e) => { console.error('QUEBROU:', e.message.split('\n')[0]); process.exit(2) })
