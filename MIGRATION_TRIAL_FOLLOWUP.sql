-- ============================================================================
-- VoiceFlow IA — Follow-up automático de trial (2 e-mails novos no cron diário)
-- ============================================================================
-- 1. "Trial expirado": User_7_dias_Free que expirou (tempo ou 10 gerações) e não
--    assinou recebe UM e-mail de follow-up — copy muda conforme o uso (quem usou
--    muito leva push de venda; quem usou pouco leva convite de voltar).
-- 2. "Trial esperando": quem se cadastrou PEDINDO o trial (trial_intent) e nunca
--    ativou recebe UM e-mail lembrando de ativar.
--
-- Os dois pegam carona no cron /api/reminders/cron-reengajamento (Hobby tem teto
-- de 2 crons na Vercel, os dois slots já estão em uso — nada de cron novo).
--
-- Rodar no SQL Editor do Supabase. Idempotente: pode rodar de novo sem medo.
--
-- Estas colunas são o ANTI-SPAM (cada e-mail é one-shot: manda 1x e nunca mais).
-- Sem elas o cron NÃO envia esses segmentos (falha segura no código), igual ao
-- reminder_last_sent_at do MIGRATION_REENGAJAMENTO.sql.
-- ============================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trial_followup_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_waiting_email_sent_at TIMESTAMPTZ;

-- Conferência:
--   SELECT email, subscription_plan, trial_started_at, trial_generations_used,
--          trial_followup_email_sent_at, trial_waiting_email_sent_at
--     FROM profiles
--    WHERE trial_started_at IS NOT NULL
--    ORDER BY trial_started_at DESC;
