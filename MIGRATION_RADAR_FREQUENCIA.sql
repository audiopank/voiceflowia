-- VoiceFlow Radar: frequencia do resumo por e-mail (diario / semanal / mensal).
--
-- POR QUE: o Radar so mandava e-mail de ALERTA (menção de crise). Nao existia
-- resumo periodico nem escolha de frequencia — nem como campo na tela. Agora o
-- cliente escolhe de quanto em quanto tempo quer receber o resumo do que
-- andaram falando da marca dele.
--
-- COMO FUNCIONA SEM CRON NOVO: o plano Hobby da Vercel so permite 2 crons e os
-- dois slots ja estao ocupados (radar-alerts + reengajamento). Entao o cron
-- diario que ja existe passa a checar, pra cada cliente, se o resumo dele
-- venceu (comparando ultimo_resumo_at com a frequencia escolhida) e so envia
-- quando venceu. Um cron diario cobre as tres frequencias.
--
-- 'nunca' existe de proposito: quem so quer alerta de crise nao deve ser
-- obrigado a receber resumo.

ALTER TABLE radar_config ADD COLUMN IF NOT EXISTS frequencia_resumo TEXT NOT NULL DEFAULT 'semanal';

ALTER TABLE radar_config DROP CONSTRAINT IF EXISTS radar_config_frequencia_check;
ALTER TABLE radar_config ADD CONSTRAINT radar_config_frequencia_check
  CHECK (frequencia_resumo IN ('diario', 'semanal', 'mensal', 'nunca'));

-- Quando o ultimo resumo saiu. NULL = nunca recebeu, entao o proximo cron manda
-- o primeiro (o cliente nao fica esperando uma semana pra ver que funciona).
ALTER TABLE radar_config ADD COLUMN IF NOT EXISTS ultimo_resumo_at TIMESTAMPTZ;
