-- ============================================================
-- Devolucao de geracao do trial quando a IA falha
-- Rode este script no SQL Editor do Supabase. Pode rodar de novo por cima de
-- uma versao anterior — e CREATE OR REPLACE, nao mexe em dado nenhum.
--
-- Por que existe: use_trial_generation() debita ANTES da chamada a IA (para
-- fechar a brecha de disparar varias geracoes em paralelo). Quando a Gemini
-- devolve 429/504, o cliente perde 1 das 10 geracoes sem receber nada — em um
-- trial de 10, dois erros de cota ja comem 20% do teste e a pessoa desiste
-- achando que o produto e que nao funciona.
--
-- ATENCAO — esta funcao e chamavel direto do console do navegador por qualquer
-- usuario logado (toda RPC com GRANT to authenticated e). Ela NAO pode confiar
-- em "o cliente so me chama quando falhou de verdade". As duas travas abaixo
-- existem por isso.
-- ============================================================

-- Teto de devolucoes por trial. Serve de freio contra um loop no console: mesmo
-- que alguem burle a primeira trava, o estrago para aqui. Folgado de proposito —
-- com a chave Gemini no free tier, falha de cota e comum e o cliente honesto nao
-- pode esbarrar nisso (ver plano de ligar o billing).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trial_refunds_used INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.refund_trial_generation()
RETURNS INTEGER AS $$
DECLARE
  me       profiles;
  entregue INTEGER;
  novo     INTEGER;
BEGIN
  SELECT * INTO me FROM profiles WHERE id = auth.uid();
  IF me.id IS NULL THEN
    RAISE EXCEPTION 'Perfil nao encontrado';
  END IF;

  -- Nao e trial: nada a devolver (assinante pago nunca chegou a consumir cota).
  -- IS DISTINCT FROM, nao <>: com subscription_plan NULL o operador comum devolve
  -- NULL, o IF nao entra, e a funcao seguiria para o UPDATE sem plano nenhum.
  IF me.subscription_plan IS DISTINCT FROM 'User_7_dias_Free' THEN
    RETURN 0;
  END IF;

  -- Trava 2: teto de devolucoes no trial inteiro.
  IF me.trial_refunds_used >= 20 THEN
    RETURN me.trial_generations_used;
  END IF;

  -- Trava 1 (a que importa): o contador nunca desce abaixo do numero de kits que
  -- o cliente REALMENTE recebeu. Toda geracao bem-sucedida grava uma linha em
  -- contents, entao esse count e a prova de entrega. Chamar a RPC em loop depois
  -- de gerar com sucesso nao devolve nada — o piso ja esta no lugar.
  SELECT COUNT(*) INTO entregue FROM contents WHERE user_id = auth.uid();

  IF me.trial_generations_used <= entregue THEN
    RETURN me.trial_generations_used;
  END IF;

  UPDATE profiles
     SET trial_generations_used = GREATEST(entregue, trial_generations_used - 1),
         trial_refunds_used     = trial_refunds_used + 1,
         updated_at             = NOW()
   WHERE id = auth.uid()
  RETURNING trial_generations_used INTO novo;

  RETURN novo;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.refund_trial_generation() TO authenticated;
