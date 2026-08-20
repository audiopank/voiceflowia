# Trilhas prontas do Estúdio

Camas instrumentais royalty-free que aparecem como chips no **Editor de Voz** e no
**Estúdio** dos cards do Agente / Super Agente.

## Como acrescentar uma trilha nova

1. Coloque o MP3 nesta pasta.
2. Acrescente **uma linha** em `TRILHAS_PRONTAS`, em `src/lib/estudioCards.ts`:

```ts
{ id: 'cinematica', label: 'Cinemática', emoji: '🎬', file: 'cinematica.mp3' },
```

Só isso. O Editor importa dessa mesma constante — **não existe mais uma segunda
lista pra manter em sincronia** (antes havia uma cópia em `editor.tsx`, e esquecer
de atualizá-la fazia a trilha aparecer num lugar e sumir no outro).

Enquanto o arquivo não existir, o chip mostra um aviso amigável em vez de quebrar.

## Trilhas hoje (7)

| Chip           | Arquivo             | Duração | Peso   |
| -------------- | ------------------- | ------- | ------ |
| 🏢 Business    | `business.mp3`      | 1:00    | 1,4 MB |
| 🌎 Global      | `global.mp3`        | 2:16    | 3,2 MB |
| 🎵 Pop         | `pop.mp3`           | 1:01    | 1,5 MB |
| 🏙️ Business Day | `business-day.mp3` | 2:02    | 3,7 MB |
| 🚀 Movimento   | `movimento.mp3`     | 1:02    | 1,9 MB |
| 📈 Business 02 | `business-02.mp3`   | 0:25    | 0,8 MB |
| 🏭 Industrial  | `industrial.mp3`    | 1:06    | 2,0 MB |

A **Corporativa (12s) foi aposentada em 18/08/2026**: curta demais, repetia no meio
de qualquer locução e a emenda do loop era audível. Com 7 trilhas melhores no
catálogo, não valia manter uma que soava defeituosa.

## Camas exclusivas do Modo Diálogo (2)

| Chip                | Arquivo                | Duração | Peso   | Nível       |
| ------------------- | ---------------------- | ------- | ------ | ----------- |
| 💬 Conversa neutra  | `conversa-neutra.mp3`  | 1:50    | 2,1 MB | −21,4 LUFS  |
| 🤔 Conversa séria   | `conversa-seria.mp3`   | 1:20    | 1,5 MB | −21,4 LUFS  |

### Nível: camas de diálogo são entregues MAIS BAIXAS que as outras

As 7 trilhas comuns ficam entre **−7 e −14 LUFS**. As duas camas de diálogo são
convertidas pra **−21,4 LUFS** — cerca de 10 dB abaixo. Isso é de propósito, e é o
que faz o **mesmo** controle de volume servir pros dois casos: no mesmo ponto do
slider, a cama de conversa entra bem mais discreta que uma trilha de spot.

O motivo é acústico: cama sob **diálogo** precisa de mais folga que sob narração.
Duas vozes alternando deixam pausas entre as falas, e nessas pausas a cama fica
exposta. Medido: sem atenuar, a 25% a cama ficava a **2,7 dB** da locução — uma cama
sob fala pede de 12 a 18 dB de folga.

Ao trocar ou acrescentar uma cama de diálogo, **normalize pra −21 LUFS**:

```
ffprobe/ffmpeg -i original.mp3 -af ebur128 -f null -      # mede o LUFS atual
ffmpeg -i original.mp3 -af volume=<-21 menos o medido>dB \
  -c:a libmp3lame -b:a 160k -ar 44100 -ac 2 conversa-<nome>.mp3
```

Estas duas vivem em `TRILHAS_DIALOGO` (`src/lib/estudioCards.ts`), **fora de
`TRILHAS_PRONTAS`**, e é essa separação que faz a regra valer: não estando naquela
lista, elas não têm como aparecer como chip no Editor de Voz nem no painel de
trilha do kit. Uma cama de conversa **nunca sonoriza um spot de rádio** — não por
disciplina de quem edita o código, por construção.

O inverso também vale: com uma cama de conversa marcada num card, ela substitui a
trilha do kit só naquele card. Se o MP3 não estiver aqui, o áudio sai **sem cama
nenhuma** e o cliente é avisado na tela — jamais caindo calado numa trilha
corporativa.

**Por que duas e não uma:** "conversa" cobre desde a padaria brincando com o
cliente até a oficina respondendo a alguém com medo de ser passado pra trás. Cama
alegre embaixo de um diálogo sobre desconfiança soa como deboche — e metade dos
nichos do produto (oficina, saúde, contábil, jurídico) cai nesse segundo caso.

**Requisito extra em relação às trilhas normais:** duas vozes alternando ocupam
muito mais do meio do espectro que um narrador só, então a cama tem que ser **mais
rala** — percussão leve e notas soltas, nada de acorde sustentado ou naipe de
cordas. Se ela preenche o meio, briga com as duas vozes ao mesmo tempo.

Duração: o diálogo dá 40–50s, então **1 a 2 minutos não chega a repetir** — sem
emenda audível. Todo o resto (licença, peso, sem vocal) segue igual à seção abaixo.

## Requisitos do arquivo

- **Formato:** MP3 — o navegador decodifica nativo no Web Audio.
- **Licença:** royalty-free com **uso comercial liberado**. O cliente vai usar em
  rádio, streaming e anúncio; guarde o comprovante de licença de cada faixa.
- **Duração:** 1 a 2 minutos. A trilha é aparada no tamanho da locução e recebe
  fade-out automático de 1,10s no fim. Se for mais curta que a locução, ela repete
  automaticamente — mas uma faixa curta demais fica com repetição audível.
- **Peso:** abaixo de ~3 MB (128–192 kbps já basta pra cama de fundo). São
  servidas estáticas pela Vercel e entram na banda do projeto.
- **Volume:** pode vir em volume cheio — no mixer ela entra como cama em ~25% e o
  cliente ajusta o fader.
- **Escolha musical:** instrumental, sem vocal e sem melodia marcante. A cama não
  pode disputar atenção com a locução — se a música "canta", o cliente abaixa o
  volume até ela sumir, e aí ela não serve pra nada.

## Onde conseguir (royalty-free, uso comercial)

- **Pixabay Music** e **Free Music Archive** — grátis, sem atribuição na maioria.
- **Uppbeat**, **Epidemic Sound**, **Artlist** — assinatura, catálogo muito maior
  e licença mais firme pra uso em anúncio de cliente.

Reencode antes de subir, pra ficar leve:

```
ffmpeg -i original.wav -c:a libmp3lame -b:a 192k -ar 44100 -ac 2 nome-da-trilha.mp3
```
