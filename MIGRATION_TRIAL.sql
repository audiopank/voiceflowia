-- ============================================================
-- Trial de 7 dias (plano User_7_dias_Free)
-- Rode este script UMA vez no SQL Editor do Supabase.
-- ============================================================

-- 1) Colunas de controle do trial na tabela profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_generations_used INTEGER NOT NULL DEFAULT 0;

-- 2) Inicia o trial do usuario logado.
--    Anti-abuso: nao reinicia trial ja usado e nao sobrescreve plano pago ativo.
--    SECURITY DEFINER: roda com privilegio, mas so age sobre auth.uid() (o proprio).
CREATE OR REPLACE FUNCTION public.start_trial()
RETURNS profiles AS $$
DECLARE
  me profiles;
BEGIN
  SELECT * INTO me FROM profiles WHERE id = auth.uid();
  IF me.id IS NULL THEN
    RAISE EXCEPTION 'Perfil nao encontrado';
  END IF;

  -- Ja e assinante pago ativo: nao mexe.
  IF me.subscription_plan IN ('crescimento', 'dominacao')
     AND me.subscription_status = 'active' THEN
    RETURN me;
  END IF;

  -- Ja teve trial antes: nao reinicia (evita loop de trials).
  IF me.trial_started_at IS NOT NULL THEN
    RETURN me;
  END IF;

  UPDATE profiles
     SET subscription_plan       = 'User_7_dias_Free',
         subscription_status     = 'active',
         trial_started_at        = NOW(),
         trial_generations_used  = 0,
         updated_at              = NOW()
   WHERE id = auth.uid()
  RETURNING * INTO me;

  RETURN me;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3) Consome 1 geracao do trial. Retorna o total usado apos incrementar.
--    Lanca excecao se o trial expirou (tempo) ou estourou o limite (10).
--    Assinantes pagos passam batido (retorna 0, nao consome).
CREATE OR REPLACE FUNCTION public.use_trial_generation()
RETURNS INTEGER AS $$
DECLARE
  me   profiles;
  novo INTEGER;
BEGIN
  SELECT * INTO me FROM profiles WHERE id = auth.uid();
  IF me.id IS NULL THEN
    RAISE EXCEPTION 'Perfil nao encontrado';
  END IF;

  -- Assinante pago nao consome cota de trial.
  IF me.subscription_plan IN ('crescimento', 'dominacao')
     AND me.subscription_status = 'active' THEN
    RETURN 0;
  END IF;

  IF me.subscription_plan <> 'User_7_dias_Free' THEN
    RAISE EXCEPTION 'Sem trial ativo';
  END IF;

  IF me.trial_started_at IS NULL
     OR NOW() > me.trial_started_at + INTERVAL '7 days' THEN
    RAISE EXCEPTION 'Trial expirado';
  END IF;

  IF me.trial_generations_used >= 10 THEN
    RAISE EXCEPTION 'Limite de geracoes atingido';
  END IF;

  UPDATE profiles
     SET trial_generations_used = trial_generations_used + 1,
         updated_at             = NOW()
   WHERE id = auth.uid()
  RETURNING trial_generations_used INTO novo;

  RETURN novo;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4) Permite que usuarios autenticados chamem as funcoes.
GRANT EXECUTE ON FUNCTION public.start_trial()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.use_trial_generation() TO authenticated;
