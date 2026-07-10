-- ============================================================
-- Link de checkout com desconto pra indicação (Agentes Expansores)
-- Rode este script UMA vez no SQL Editor do Supabase, DEPOIS de
-- MIGRATION_REFERRALS.sql.
--
-- A Kiwify desta conta não tem cupom avulso — o desconto é dado criando
-- uma "Oferta" separada dentro do produto (com preço já reduzido), que
-- gera seu próprio link de checkout. Esse campo guarda esse link; o link
-- normal em plans.kiwify_url continua sendo o de preço cheio.
-- ============================================================

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS referral_kiwify_url TEXT;
