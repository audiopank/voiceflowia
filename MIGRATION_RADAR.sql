-- ============================================================
-- VoiceFlow Radar — Fase 1 (social listening / reputação)
-- Rode este script UMA vez no SQL Editor do Supabase, DEPOIS de
-- CREATE_PROFILES_TABLE.sql / MIGRATION_TRIAL.sql / MIGRATION_REFERRALS.sql.
--
-- ADITIVO: nada do fluxo existente muda. O acesso ao Radar é um entitlement
-- PARALELO (coluna própria em profiles), estilo courtesy — NÃO sobrescreve
-- subscription_plan. Assim o cliente pode ter Dominação E Radar ao mesmo tempo.
-- ============================================================

-- 1) Entitlement do Radar em profiles (add-on, calculado no client como courtesy)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS radar_expires_at TIMESTAMPTZ;

-- 2) Configuração do Radar por usuário (1 linha por user)
CREATE TABLE IF NOT EXISTS radar_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  marca_nome TEXT NOT NULL,
  marca_instagram TEXT,
  nicho TEXT,
  concorrentes TEXT[] NOT NULL DEFAULT '{}',                    -- até 5 @ (validado no client)
  palavras_chave_alerta TEXT[] NOT NULL
    DEFAULT '{golpe,não recomendo,processo,lixo,péssimo,horrível}',
  alert_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE radar_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "radar_config_own" ON radar_config;
CREATE POLICY "radar_config_own" ON radar_config
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3) Relatórios gerados (sentimento + menções + tendências + nuvem de palavras)
CREATE TABLE IF NOT EXISTS radar_relatorios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  config_id UUID REFERENCES radar_config(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resumo TEXT,
  sentimento JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {positivo,neutro,negativo,crise}
  mencoes JSONB NOT NULL DEFAULT '[]'::jsonb,       -- [{fonte,texto,url,classificacao,motivo}]
  tendencias JSONB NOT NULL DEFAULT '[]'::jsonb,    -- string[]
  palavras JSONB NOT NULL DEFAULT '{}'::jsonb       -- {palavra: contagem} p/ nuvem
);

ALTER TABLE radar_relatorios ENABLE ROW LEVEL SECURITY;

-- Dono só LÊ; a escrita vem do endpoint via service_role (bypassa RLS).
DROP POLICY IF EXISTS "radar_relatorios_own_read" ON radar_relatorios;
CREATE POLICY "radar_relatorios_own_read" ON radar_relatorios
  FOR SELECT USING (auth.uid() = user_id);

-- 4) Alertas de crise (dos últimos dias, mostrados no Card 3)
CREATE TABLE IF NOT EXISTS radar_alertas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  config_id UUID REFERENCES radar_config(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mencao_texto TEXT,
  fonte TEXT,
  url TEXT,
  classificacao TEXT,
  motivo TEXT,
  notified_email BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE radar_alertas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "radar_alertas_own_read" ON radar_alertas;
CREATE POLICY "radar_alertas_own_read" ON radar_alertas
  FOR SELECT USING (auth.uid() = user_id);

-- 5) Admin concede acesso ao Radar (testar / cortesia / comp). Mirror de
--    grant_courtesy_access. IS DISTINCT FROM: `<>` com NULL não bloquearia
--    chamada anônima (ver bug conhecido de NULL nas RPCs).
CREATE OR REPLACE FUNCTION public.grant_radar_access(p_email TEXT, p_days INT)
RETURNS profiles AS $$
DECLARE
  target profiles;
BEGIN
  IF (auth.jwt() ->> 'email') IS DISTINCT FROM 'novaaudiopank@gmail.com' THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  SELECT * INTO target FROM profiles WHERE email = p_email;
  IF target.id IS NULL THEN
    RAISE EXCEPTION 'Perfil não encontrado para este email.';
  END IF;

  UPDATE profiles
     SET radar_expires_at = NOW() + (p_days || ' days')::interval,
         updated_at = NOW()
   WHERE id = target.id
  RETURNING * INTO target;

  RETURN target;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.grant_radar_access(text, int) TO authenticated;
