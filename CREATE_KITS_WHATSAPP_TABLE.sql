-- Meus Kits F1 (25/09/2026): o Kit de Respostas de WhatsApp gerado não some mais
-- ao fechar a aba. Tabela PRÓPRIA — nunca em `contents` (10 respostas inflariam
-- "Posts Gerados" e a Memória da Marca). Aplicar no SQL Editor do Supabase do
-- VoiceFlow (mão do Mestre). Idempotente: pode rodar de novo sem estrago.
CREATE TABLE IF NOT EXISTS kits_whatsapp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nicho TEXT NOT NULL,
  fatos TEXT NOT NULL DEFAULT '',
  diferenciais TEXT NOT NULL DEFAULT '',
  cta TEXT NOT NULL DEFAULT '',
  tom TEXT NOT NULL DEFAULT 'Profissional',
  voz TEXT NOT NULL DEFAULT 'Zephyr',
  -- [{ "pergunta": "...", "resposta": "..." }, ...] — a ordem é a do kit.
  respostas JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(respostas) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kits_whatsapp_user_id_idx ON kits_whatsapp(user_id, updated_at DESC);

-- updated_at automático em toda edição (autosave das respostas, troca de voz).
CREATE OR REPLACE FUNCTION kits_whatsapp_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kits_whatsapp_touch_updated_at ON kits_whatsapp;
CREATE TRIGGER kits_whatsapp_touch_updated_at
  BEFORE UPDATE ON kits_whatsapp
  FOR EACH ROW EXECUTE FUNCTION kits_whatsapp_touch_updated_at();

-- Row Level Security: cada um só enxerga e mexe no que é seu.
ALTER TABLE kits_whatsapp ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own kits" ON kits_whatsapp;
CREATE POLICY "Users can view own kits" ON kits_whatsapp
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own kits" ON kits_whatsapp;
CREATE POLICY "Users can insert own kits" ON kits_whatsapp
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own kits" ON kits_whatsapp;
CREATE POLICY "Users can update own kits" ON kits_whatsapp
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own kits" ON kits_whatsapp;
CREATE POLICY "Users can delete own kits" ON kits_whatsapp
  FOR DELETE USING (auth.uid() = user_id);

-- Conferência (deve devolver 0 linhas logo após criar):
-- SELECT id, nicho, jsonb_array_length(respostas) AS respostas, updated_at FROM kits_whatsapp;
