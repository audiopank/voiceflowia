-- ============================================================================
-- VoiceFlow RADAR — reconciliação de compra feita ANTES do cadastro
-- ============================================================================
-- Problema que isto resolve: quem comprava o Radar na Kiwify sem ter conta no
-- app não recebia nada. O webhook só logava um aviso e o admin precisava rodar
-- grant_radar_access() na mão. Aceitável quando o Radar era upsell de ~R$497
-- pra cliente existente; virou risco real quando ele virou card público na
-- /precos por R$107,90 (comprador frio compra como PRIMEIRA compra).
--
-- Rodar no SQL Editor do Supabase. Idempotente: pode rodar de novo sem medo.
--
-- DUAS decisões de segurança que valem a leitura:
--
-- 1) Tabela NOVA em vez de reusar pending_kiwify_purchases. Aquela tem
--    `subscription_plan TEXT NOT NULL`, aplicado direto no profile pelo
--    handle_new_user(). Gravar 'radar_pro' ali sobrescreveria o plano de
--    conteúdo do cliente — exatamente o que o Radar NUNCA pode fazer (ele é
--    entitlement PARALELO, em radar_expires_at).
--
-- 2) Trigger PRÓPRIO em vez de editar handle_new_user(). Esta migração NÃO
--    toca na função existente. Se ela fosse redefinida aqui, qualquer diferença
--    entre o que está no repositório e o que está de fato no banco viraria
--    perda silenciosa da reconciliação de plano e do programa de indicação.
--    Postgres dispara múltiplos triggers AFTER INSERT em ordem alfabética de
--    nome: "on_auth_user_created" vem antes de "on_auth_user_created_radar",
--    então o profile já existe quando o nosso roda. Determinístico.
-- ============================================================================

-- 1) Fila de compras do Radar aguardando cadastro.
CREATE TABLE IF NOT EXISTS pending_radar_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  -- Guardamos DIAS, não uma data absoluta: se a pessoa demorar pra se
  -- cadastrar, ela não perde o que pagou — o relógio só começa a correr
  -- quando ela realmente consegue usar o produto.
  radar_days INTEGER NOT NULL DEFAULT 32,
  kiwify_order_id TEXT,
  raw_payload JSONB,
  processed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE pending_radar_purchases ENABLE ROW LEVEL SECURITY;

-- Escritas reais vêm do webhook com a service_role key (bypassa RLS). A policy
-- existe só pra o admin conseguir inspecionar a fila pela UI do Supabase.
DROP POLICY IF EXISTS "pending_radar_purchases_admin_all" ON pending_radar_purchases;
CREATE POLICY "pending_radar_purchases_admin_all" ON pending_radar_purchases
  FOR ALL
  USING ((auth.jwt() ->> 'email') = 'novaaudiopank@gmail.com')
  WITH CHECK ((auth.jwt() ->> 'email') = 'novaaudiopank@gmail.com');

-- 2) Reconciliação do Radar no cadastro — função e trigger DEDICADOS.
--    Mexe SÓ em radar_expires_at. Um cliente que comprou plano de conteúdo E
--    Radar antes de se cadastrar recebe os dois: cada trigger cuida do seu.
CREATE OR REPLACE FUNCTION public.reconcile_pending_radar()
RETURNS TRIGGER AS $$
DECLARE
  pending public.pending_radar_purchases;
BEGIN
  -- LOWER() nos dois lados: a Kiwify pode mandar o email como o cliente
  -- digitou ("Fulano@Gmail.com"); auth.users.email vem sempre normalizado.
  SELECT * INTO pending
    FROM public.pending_radar_purchases
   WHERE LOWER(email) = LOWER(NEW.email) AND processed = false
   LIMIT 1;

  IF pending.id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.profiles
     SET radar_expires_at = NOW() + (pending.radar_days || ' days')::interval,
         updated_at       = NOW()
   WHERE id = NEW.id;

  -- Só marca como processado se o UPDATE REALMENTE encontrou o profile. A
  -- ordem alfabética dos triggers garante que ele já exista — mas se algum dia
  -- ela deixar de valer (trigger renomeado, handle_new_user desativado), o
  -- UPDATE acima afeta 0 linhas e marcar processed = true apagaria em SILÊNCIO
  -- um acesso já pago. Deixando false, a linha continua na fila e aparece na
  -- consulta de conferência lá embaixo.
  IF NOT FOUND THEN
    RAISE WARNING '[reconcile_pending_radar] profile % (%) ainda nao existia; pendencia mantida na fila', NEW.id, NEW.email;
    RETURN NEW;
  END IF;

  UPDATE public.pending_radar_purchases
     SET processed = true, updated_at = NOW()
   WHERE id = pending.id;

  RETURN NEW;

EXCEPTION
  WHEN OTHERS THEN
    -- Blindagem: este trigger roda DENTRO da transação de cadastro. Sem este
    -- bloco, qualquer erro aqui (tabela dropada, coluna renomeada, permissão)
    -- faria TODO cadastro novo do app falhar por causa de um add-on. Falha
    -- contida: a pendência fica na fila (processed = false, pois o bloco
    -- inteiro é revertido) e o cadastro conclui normalmente.
    RAISE WARNING '[reconcile_pending_radar] falhou para % (%): %', NEW.email, SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Nome propositalmente depois de "on_auth_user_created" na ordem alfabética,
-- pra rodar quando a linha em profiles já foi criada pelo trigger existente.
DROP TRIGGER IF EXISTS on_auth_user_created_radar ON auth.users;
CREATE TRIGGER on_auth_user_created_radar
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_pending_radar();

-- ============================================================================
-- Conferência depois de rodar:
--
--   -- os dois triggers existem, nesta ordem?
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal
--    ORDER BY tgname;
--
--   -- fila do Radar (processed = true significa acesso já liberado no cadastro)
--   SELECT email, radar_days, processed, created_at
--     FROM pending_radar_purchases ORDER BY created_at DESC;
--
--   -- PAGOU E NÃO RECEBEU: pendência ainda aberta de alguém que JÁ tem conta.
--   -- Deveria vir sempre vazio. Se vier linha, conceder na mão:
--   --   SELECT grant_radar_access('<email>', 32);
--   SELECT p.email, p.radar_days, p.created_at
--     FROM pending_radar_purchases p
--     JOIN profiles pr ON LOWER(pr.email) = LOWER(p.email)
--    WHERE p.processed = false;
-- ============================================================================
