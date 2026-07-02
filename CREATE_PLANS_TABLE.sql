-- Tabela de planos (editavel pelo Painel Admin)
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  price TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT '/mês',
  features JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ "text": "...", "included": true }]
  cta_label TEXT NOT NULL DEFAULT 'Assinar',
  kiwify_url TEXT,
  badge TEXT,
  highlight BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

-- Qualquer visitante (anon) pode LER apenas planos ativos
DROP POLICY IF EXISTS "plans_public_read" ON plans;
CREATE POLICY "plans_public_read" ON plans
  FOR SELECT USING (active = true);

-- Somente o admin (pankilhas@gmail.com) pode ler tudo e escrever
DROP POLICY IF EXISTS "plans_admin_all" ON plans;
CREATE POLICY "plans_admin_all" ON plans
  FOR ALL
  USING ((auth.jwt() ->> 'email') = 'pankilhas@gmail.com')
  WITH CHECK ((auth.jwt() ->> 'email') = 'pankilhas@gmail.com');

-- Seed com os 3 planos atuais (nao sobrescreve se ja existirem)
INSERT INTO plans (slug, name, price, period, features, cta_label, badge, highlight, sort_order, active)
VALUES
  (
    'inicial', 'Plano Inicial', 'R$ 97', '/mês',
    '[{"text":"Dashboard de Métricas Completo","included":true},{"text":"10 Projetos de Voz / mês","included":true},{"text":"Sem Agente de Conteúdo IA","included":false}]'::jsonb,
    'Começar Agora', NULL, false, 1, true
  ),
  (
    'crescimento', 'Plano Crescimento', 'R$ 297', '/mês',
    '[{"text":"Tudo do Plano Inicial","included":true},{"text":"Agente de Conteúdo IA 24h","included":true},{"text":"30 Projetos de Voz / mês","included":true}]'::jsonb,
    'Testar 7 Dias Grátis', 'MAIS VENDIDO', true, 2, true
  ),
  (
    'dominacao', 'Plano Dominação', 'R$ 497', '/mês',
    '[{"text":"Tudo do Plano Crescimento","included":true},{"text":"Atendimento por Voz no WhatsApp","included":true},{"text":"Estratégia 1x1 com o Mestre 2x/mês","included":true},{"text":"Vagas Limitadas: 5 vagas","included":true}]'::jsonb,
    'Quero Dominar', NULL, false, 3, true
  )
ON CONFLICT (slug) DO NOTHING;
