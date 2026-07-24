-- ============================================================================
-- VoiceFlow IA — Lembrete de re-engajamento ("gere o conteúdo do próximo mês")
-- ============================================================================
-- Retenção: cliente pago gera o kit do mês e some. Um cron diário
-- (/api/reminders/cron-reengajamento) acha quem ficou X dias SEM gerar e manda
-- um e-mail chamando de volta pra gerar o próximo mês (a Memória da Marca já
-- garante que o mês 2 sai melhor que o 1).
--
-- Rodar no SQL Editor do Supabase. Idempotente: pode rodar de novo sem medo.
--
-- Esta coluna é o ANTI-SPAM: guarda quando mandamos o último lembrete. O cron só
-- reenvia se a pessoa GEROU algo depois do último lembrete (reminder_last_sent_at
-- < última geração), então cada período dormente rende no máximo 1 e-mail. Sem
-- esta coluna, o cron NÃO envia nada (falha segura no código) — justamente pra
-- nunca virar spam diário se a migração ainda não tiver rodado.
-- ============================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS reminder_last_sent_at TIMESTAMPTZ;

-- Conferência:
--   SELECT id, email, subscription_plan, reminder_last_sent_at
--     FROM profiles
--    WHERE subscription_plan IN ('crescimento','dominacao')
--    ORDER BY reminder_last_sent_at DESC NULLS LAST;
