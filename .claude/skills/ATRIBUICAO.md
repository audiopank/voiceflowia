# De onde vieram estas skills

Estas 5 skills são um recorte de **Marketing Skills for AI Agents**, de Corey
Haines — https://github.com/coreyhaines31/marketingskills — licença MIT
(Copyright (c) 2025 Corey Haines). Copiadas sem modificação (só os `SKILL.md` e
`references/`; os `evals/` ficaram de fora por serem material de teste do
próprio repositório).

## Por que só 5 das 49

A coleção original é excelente, mas foi escrita pensando em SaaS americano
self-serve. Boa parte não se aplica ao VoiceFlow IA hoje:

- `churn-prevention` monta tudo em Stripe/Chargebee/Paddle — aqui é **Kiwify**.
- `referrals`, `pricing`, `launch` e os testes A/B do `cro` exigem base de
  clientes, ARPU/churn ou tráfego que ainda não existem.
- `cold-email` erra o canal: PME brasileira responde WhatsApp.
- O bloco de SEO (`seo-audit`, `programmatic-seo`, `schema`, `ai-seo`,
  `site-architecture`) é jogo de 6+ meses; a necessidade agora é cliente no mês.

As que ficaram atacam gargalo real:

| Skill | Gargalo que ataca |
|---|---|
| `prospecting` | Não ter clientes — a ramificação **Local SMB** varre Google Maps por categoria+cidade e classifica quem só tem Instagram |
| `customer-research` | Entender por que o lead mais quente usou o trial inteiro e não assinou |
| `offers` | Garantia, bônus e esforço percebido — a objeção real de quem testa e não compra |
| `onboarding` | Ativação, o maior furo do funil |
| `product-marketing` | Base que as outras leem; evita reexplicar o produto toda vez |

## Se quiser outra depois

A coleção completa está em `marketingskills-main/` (fora do controle de versão,
ver `.gitignore`). É só copiar a pasta da skill pra cá seguindo o mesmo formato.
