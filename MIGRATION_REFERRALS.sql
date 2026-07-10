-- ============================================================
-- Agentes Expansores (indicação) — cortesia 30 dias + atribuição de leads
-- Rode este script UMA vez no SQL Editor do Supabase, DEPOIS de
-- CREATE_PROFILES_TABLE.sql e MIGRATION_TRIAL.sql.
-- ============================================================

-- 1) Registro dos agentes expansores
CREATE TABLE IF NOT EXISTS expander_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  display_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,       -- email de login do agente no VoiceFlow
  courtesy_plan TEXT NOT NULL DEFAULT 'dominacao',
  courtesy_days INT NOT NULL DEFAULT 30,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE expander_agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expander_agents_admin_all" ON expander_agents;
CREATE POLICY "expander_agents_admin_all" ON expander_agents
  FOR ALL
  USING ((auth.jwt() ->> 'email') = 'novaaudiopank@gmail.com')
  WITH CHECK ((auth.jwt() ->> 'email') = 'novaaudiopank@gmail.com');
-- Sem policy de leitura pública: nenhuma UI de agente é necessária.

-- 2) Atribuição em profiles: quem indicou + cortesia com expiração própria
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referred_by_agent_slug TEXT REFERENCES expander_agents(slug),
  ADD COLUMN IF NOT EXISTS courtesy_expires_at TIMESTAMPTZ;
-- Sem ON DELETE CASCADE/SET NULL: apagar um agente com leads atribuídos
-- falha por FK (RESTRICT é o padrão do Postgres) — o admin desativa
-- (active=false) em vez de apagar, preservando o histórico de "trazido por X".

-- 3) Reconciliação de compras Kiwify antes do cadastro (corrige o gap geral
--    de "comprou antes de criar conta" e é o mesmo mecanismo que resolve
--    indicação pré-cadastro)
CREATE TABLE IF NOT EXISTS pending_kiwify_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  subscription_plan TEXT NOT NULL,
  subscription_status TEXT NOT NULL DEFAULT 'active',
  referred_by_agent_slug TEXT REFERENCES expander_agents(slug),
  kiwify_order_id TEXT,
  raw_payload JSONB,
  processed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE pending_kiwify_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pending_kiwify_purchases_admin_all" ON pending_kiwify_purchases;
CREATE POLICY "pending_kiwify_purchases_admin_all" ON pending_kiwify_purchases
  FOR ALL
  USING ((auth.jwt() ->> 'email') = 'novaaudiopank@gmail.com')
  WITH CHECK ((auth.jwt() ->> 'email') = 'novaaudiopank@gmail.com');
-- Escritas reais vêm do webhook usando a service_role key (bypassa RLS);
-- a policy acima só existe para permitir que o admin inspecione a tabela
-- pela UI do Supabase, se necessário.

-- 4) Reconcilia no signup: estende handle_new_user() (já existe em
--    CREATE_PROFILES_TABLE.sql) para aplicar uma compra pendente, se houver.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  pending pending_kiwify_purchases;
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);

  SELECT * INTO pending
    FROM public.pending_kiwify_purchases
   WHERE email = NEW.email AND processed = false
   LIMIT 1;

  IF pending.id IS NOT NULL THEN
    UPDATE public.profiles
       SET subscription_plan      = pending.subscription_plan,
           subscription_status    = pending.subscription_status,
           referred_by_agent_slug = pending.referred_by_agent_slug,
           updated_at              = NOW()
     WHERE id = NEW.id;

    UPDATE public.pending_kiwify_purchases
       SET processed = true, updated_at = NOW()
     WHERE id = pending.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Trigger on_auth_user_created já aponta pra esta função — não precisa recriar.

-- 5) Admin concede acesso cortesia (mirror de start_trial(): SECURITY DEFINER,
--    auto-checagem do admin dentro da função, já que RLS é bypassada).
CREATE OR REPLACE FUNCTION public.grant_courtesy_access(p_email TEXT, p_agent_slug TEXT)
RETURNS profiles AS $$
DECLARE
  target profiles;
  agent  expander_agents;
BEGIN
  IF (auth.jwt() ->> 'email') IS DISTINCT FROM 'novaaudiopank@gmail.com' THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  SELECT * INTO agent FROM expander_agents WHERE slug = p_agent_slug AND active = true;
  IF agent.id IS NULL THEN
    RAISE EXCEPTION 'Agente não encontrado ou inativo';
  END IF;

  SELECT * INTO target FROM profiles WHERE email = p_email;
  IF target.id IS NULL THEN
    RAISE EXCEPTION 'Perfil não encontrado para este email. O agente precisa se cadastrar no VoiceFlow primeiro.';
  END IF;

  -- Idempotente: chamar de novo apenas RENOVA os 30 dias a partir de agora
  -- (comportamento intencional — reconceder = resetar o relógio).
  UPDATE profiles
     SET subscription_plan   = agent.courtesy_plan,
         subscription_status = 'active',
         courtesy_expires_at = NOW() + (agent.courtesy_days || ' days')::interval,
         updated_at = NOW()
   WHERE id = target.id
  RETURNING * INTO target;

  RETURN target;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6) Leitura administrativa (evita abrir policy de SELECT ampla em `profiles`,
--    que contém email/plano de TODOS os usuários — dado sensível).
CREATE OR REPLACE FUNCTION public.admin_list_referred_profiles(p_agent_slug TEXT)
RETURNS TABLE (email TEXT, subscription_plan TEXT, subscription_status TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (auth.jwt() ->> 'email') IS DISTINCT FROM 'novaaudiopank@gmail.com' THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  RETURN QUERY
    SELECT p.email, p.subscription_plan, p.subscription_status, p.created_at
      FROM profiles p
     WHERE p.referred_by_agent_slug = p_agent_slug
     ORDER BY p.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_profile_status(p_email TEXT)
RETURNS TABLE (subscription_plan TEXT, subscription_status TEXT, courtesy_expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (auth.jwt() ->> 'email') IS DISTINCT FROM 'novaaudiopank@gmail.com' THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  RETURN QUERY
    SELECT p.subscription_plan, p.subscription_status, p.courtesy_expires_at
      FROM profiles p WHERE p.email = p_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_courtesy_access(text, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_referred_profiles(text)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_profile_status(text)         TO authenticated;
