# Trilhas prontas do Estúdio de Mixagem

Coloque aqui os arquivos de trilha instrumental (royalty-free) que aparecem como
"trilhas prontas" no Editor de Voz. Os nomes devem ser EXATAMENTE estes (o código
em `src/routes/editor.tsx`, constante `PRESET_TRACKS`, aponta pra eles):

| Chip no app    | Arquivo          | Obs                                    |
| -------------- | ---------------- | -------------------------------------- |
| 💼 Corporativa | `corporativa.mp3`| ⚠️ só 12s — trocar por versão mais longa |
| 🏢 Business    | `business.mp3`   | 60s                                    |
| 🌎 Global      | `global.mp3`     | 2:16                                   |
| 🎵 Pop         | `pop.mp3`        | 61s                                    |

Pra adicionar um 5º chip (ex: um Funk de verdade — o que veio era cópia do Business),
coloque o MP3 aqui e adicione uma linha em `PRESET_TRACKS`.

Os arquivos são reencodados pra MP3 192kbps estéreo 44.1kHz antes de subir (ffmpeg),
pra ficarem leves. Os originais em WAV (que vieram como `.mp3`) foram movidos pra fora
do repositório.

## Requisitos dos arquivos

- **Formato:** MP3 (o navegador decodifica nativo pro Web Audio).
- **Licença:** royalty-free / uso comercial liberado (o cliente vai usar em rádio,
  streaming e anúncios). Guarde o comprovante de licença de cada faixa.
- **Duração:** ~1 a 2 minutos é suficiente — a trilha é aparada no tamanho da
  locução e recebe fade-out automático de 1,10s no fim.
- **Volume:** pode vir em volume cheio; no mixer ela entra como cama em ~25% e o
  cliente ajusta o fader.
- **Peso:** de preferência abaixo de ~3 MB cada (bitrate 128–192 kbps já basta pra
  música de fundo) — são servidas estáticas pela Vercel.

Enquanto um arquivo não existir, o chip correspondente mostra um aviso amigável
("Essa trilha ainda não está disponível...") em vez de quebrar.
