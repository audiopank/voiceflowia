-- ============================================================
-- Aba "Trials" do /admin: lista quem se interessou pelo trial.
-- Rode este script UMA vez no SQL Editor do Supabase.
-- ============================================================

-- Leitura administrativa, nos moldes de admin_list_referred_profiles
-- (MIGRATION_REFERRALS.sql): SECURITY DEFINER pra alcançar auth.users e
-- profiles de todo mundo, mas travada no e-mail do admin — sem isso a
-- GRANT authenticated deixaria qualquer usuário logado rodar pelo DevTools.
--
-- Entram na lista dois sinais, do mais fraco pro mais forte:
--   1. trial_intent no user_metadata — se cadastrou PEDINDO o trial
--      (gravado pelo cadastro.tsx), mesmo que nunca tenha iniciado;
--   2. trial_started_at em profiles — iniciou o trial de fato (start_trial).
-- Clique puro no link ninguém guarda; esses dois são o que existe de rastro.
CREATE OR REPLACE FUNCTION public.admin_list_trial_users()
RETURNS TABLE (
  email TEXT,
  cadastro_em TIMESTAMPTZ,
  trial_started_at TIMESTAMPTZ,
  trial_generations_used INTEGER,
  subscription_plan TEXT,
  subscription_status TEXT,
  pediu_trial_no_cadastro BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (auth.jwt() ->> 'email') IS DISTINCT FROM 'novaaudiopank@gmail.com' THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  RETURN QUERY
    SELECT u.email::TEXT,
           u.created_at,
           p.trial_started_at,
           COALESCE(p.trial_generations_used, 0),
           p.subscription_plan,
           p.subscription_status,
           (u.raw_user_meta_data ->> 'trial_intent') IS NOT NULL
      FROM auth.users u
      LEFT JOIN profiles p ON p.id = u.id
     WHERE p.trial_started_at IS NOT NULL
        OR (u.raw_user_meta_data ->> 'trial_intent') IS NOT NULL
     ORDER BY u.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_trial_users() TO authenticated;
