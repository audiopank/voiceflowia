---
name: conferir-campanha
description: Confere uma campanha ANTES de publicar — roteiro, locução, legenda, texto pros grupos de WhatsApp e PRINTS DE CARDS (inclusive o texto escrito dentro da imagem) — contra a régua de promessas do VoiceFlow IA e a regra "Só vendemos a verdade". Devolve, peça por peça, 🟢 pode publicar / 🟡 ajuste pequeno / 🔴 refazer, com o trecho exato e a troca pronta. Use sempre que o Mestre mandar texto ou cards de divulgação do VoiceFlow IA, Locutores IA, NewPost-IA ou Achadinhos e perguntar se está bom, se pode publicar, pedir pra revisar, conferir ou "ver se tem mentira" — mesmo que ele não diga "conferir campanha".
---

# Conferir campanha

O Mestre divulga o VoiceFlow IA (e os outros produtos dele) nos grupos de WhatsApp. O padrão da casa é **"Só vendemos a verdade"**: a copy descreve o que o produto faz HOJE, nunca promete resultado. O cliente que descobre uma promessa falsa não volta.

Duas coisas tornam esta conferência necessária:
1. A **régua** do VoiceFlow (`src/lib/conferirCatalogo.ts`) pega promessas por palavra, mas só lê TEXTO.
2. Os cards costumam ser feitos com IA de imagem, que **escreve frases e números dentro do desenho** — e isso a régua nunca vê. Em 24/11/2026, 2 de 12 cards tinham promessa falsa escrita na imagem ("Postou, vendeu?" com métricas inventadas; "Ela para na hora" quando a IA só avisa).

## Passo a passo

### 1. Junte todo o texto, peça por peça
- Texto colado: cada bloco (locução, legenda, texto do grupo) é uma peça.
- Imagens: abra cada uma e **transcreva TODO texto visível** — título, subtítulo, letra pequena, telas de celular/notebook dentro da imagem, canecas, botões, balões de chat, números de métricas, rodapé/©. Letra pequena é onde a IA de imagem mais inventa. Chame as peças de "Card 1", "Card 2"… na ordem recebida, com o título do card entre parênteses.

### 2. Rode a régua (código, não opinião)
Salve as peças num arquivo de texto, separadas por uma linha só com `---`, e rode da raiz do repositório:

```bash
node --experimental-strip-types --no-warnings .claude/skills/conferir-campanha/scripts/regua.mts <arquivo-das-pecas.txt>
```

Ele usa a régua real do VoiceFlow e compara com as verdades em `references/verdades-voiceflow.md`. Para outro produto (Locutores, Achadinhos), passe um 2º arquivo com os fatos daquele produto. Se o script não rodar, diga isso no relatório — nunca diga "passou na régua" sem ter rodado.

### 3. Leia com olho de dono (o que a régua não pega)
Leia `references/verdades-voiceflow.md` e confira cada peça contra a seção "Armadilhas que a régua não pega". Pergunta-guia: **"Se um cliente me cobrar isso, eu provo?"** Se a frase descreve um recurso e você não tem certeza de que ele existe, procure no código (`src/`) antes de aprovar; se não achar, marque 🟡 "não confirmei".

### 4. Entregue o relatório
Português simples (o Mestre é dono de negócio aprendendo a programar). Formato:

```
## Resultado: X de Y peças podem ir como estão

### 🔴 Card 2 ("Postou, vendeu?") — refazer
- "Identifica o que vende" → não existe: quem diz o que funcionou é o dono, com o 👍.
  Troca: "Você marca o que funcionou"
- (um item por problema: trecho exato → por que → troca pronta)

### 🟡 Card 5 (…) — ajuste pequeno
- …

### 🟢 Podem ir: Card 1 (…), Card 3 (…)

Régua: rodou — N avisos (ou: não rodou, motivo).
```

- 🔴 = promessa falsa, recurso que não existe, número inventado, resultado prometido.
- 🟡 = erro de digitação, palavra estranha, inglês/ano errado, exagero leve, ambiguidade.
- 🟢 = nada a corrigir.

Sugira a troca só do trecho com problema, no mesmo tom da campanha — não reescreva a campanha inteira. A troca também tem que passar nas regras (não troque uma promessa por outra).
