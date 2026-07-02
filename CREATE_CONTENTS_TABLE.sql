-- Criação da tabela contents (Agente de Conteúdo IA)
CREATE TABLE IF NOT EXISTS contents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nicho TEXT NOT NULL,
  posts_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contents_user_id_idx ON contents(user_id);

-- Habilita Row Level Security
ALTER TABLE contents ENABLE ROW LEVEL SECURITY;

-- Política: Usuários só veem os próprios conteúdos
DROP POLICY IF EXISTS "Users can view own contents" ON contents;
CREATE POLICY "Users can view own contents" ON contents
  FOR SELECT USING (auth.uid() = user_id);

-- Política: Usuários só criam conteúdos para si mesmos
DROP POLICY IF EXISTS "Users can insert own contents" ON contents;
CREATE POLICY "Users can insert own contents" ON contents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Política: Usuários só apagam os próprios conteúdos
DROP POLICY IF EXISTS "Users can delete own contents" ON contents;
CREATE POLICY "Users can delete own contents" ON contents
  FOR DELETE USING (auth.uid() = user_id);
