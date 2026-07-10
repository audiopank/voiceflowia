# Guia de Configuração da Kiwify

## Passo 1: Configurar o Supabase

1. Acesse o painel do Supabase
2. Vá para **SQL Editor**
3. Execute o arquivo `CREATE_PROFILES_TABLE.sql` para criar a tabela de profiles e triggers

## Passo 2: Criar Produtos na Kiwify

1. Acesse o painel da Kiwify: https://app.kiwify.com.br/
2. Vá para **Produtos** > **Criar Produto**
3. Crie os 2 planos:

   - **Plano Crescimento** - R$ 97,90/mês (assinatura) - DESTAQUE
   - **Plano Dominação** - R$ 167,90/mês (assinatura) - 5 vagas
4. Copie os links de checkout de cada produto

## Passo 3: Configurar Variáveis de Ambiente

Atualize o arquivo `.env`:
```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anonima
KIWIFY_WEBHOOK_SECRET=seu-token-secreto
VITE_KIWIFY_CRESCIMENTO_URL=https://checkout.kiwify.com.br/seu-link-crescimento
VITE_KIWIFY_DOMINACAO_URL=https://checkout.kiwify.com.br/seu-link-dominacao
```

## Passo 4: Configurar Webhook na Kiwify

1. No painel da Kiwify, vá para **Configurações** > **Webhooks**
2. Clique em **Criar Webhook**
3. Preencha os dados:
   - **URL do Webhook**: `https://seu-dominio.com/api/kiwify/webhook` (para produção, use Vercel, Render, etc.)
   - **Eventos**: Selecione apenas **Pedido Aprovado (order.approved)**
4. Copie o **Token Secreto** gerado e adicione ao `.env` na variável `KIWIFY_WEBHOOK_SECRET`

## Passo 5: Rodar o Webhook Local (para desenvolvimento)

Para testes locais, use ngrok para expor sua porta:
```bash
# Instale o ngrok (se não tiver)
# No diretório kiwify-webhook
cd kiwify-webhook
npm install

# Configure o .env no diretório kiwify-webhook com as mesmas variáveis, incluindo SUPABASE_SERVICE_ROLE_KEY

# Rode o servidor
npm start

# Em outro terminal, exponha com ngrok
ngrok http 3001
```

Use o link do ngrok (ex: `https://abc123.ngrok.io/api/kiwify/webhook`) na Kiwify para testes!
