-- Videos do fundador (editaveis pelo Painel Admin, exibidos na /precos e na /videos)
--
-- NOME: `founder_videos`, nao `videos`. Ja existe uma tabela `videos` orfa no
-- banco (so id/video_url/created_at, zero linhas, nao referenciada por nenhum
-- codigo nem por nenhum .sql deste repo). Um CREATE TABLE IF NOT EXISTS videos
-- NAO criaria as colunas novas e o app quebraria contra o schema antigo.
CREATE TABLE IF NOT EXISTS founder_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT NOT NULL,               -- ex: "Monto o mes de um cliente em 4 minutos"
  frase TEXT,                         -- frase de destaque exibida abaixo do video
  video_url TEXT NOT NULL,            -- URL publica no bucket 'founder-videos'
  video_path TEXT NOT NULL,           -- caminho dentro do bucket (pra apagar o arquivo junto)
  poster_url TEXT,                    -- thumbnail (1o frame) — evita caixa preta antes do play
  poster_path TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE founder_videos ENABLE ROW LEVEL SECURITY;

-- Qualquer visitante (anon, sem login) pode LER apenas videos ativos —
-- a /precos e a /videos sao paginas publicas.
DROP POLICY IF EXISTS "founder_videos_public_read" ON founder_videos;
CREATE POLICY "founder_videos_public_read" ON founder_videos
  FOR SELECT USING (active = true);

-- Somente o admin pode ler tudo (inclusive inativos) e escrever
DROP POLICY IF EXISTS "founder_videos_admin_all" ON founder_videos;
CREATE POLICY "founder_videos_admin_all" ON founder_videos
  FOR ALL
  USING ((auth.jwt() ->> 'email') = 'novaaudiopank@gmail.com')
  WITH CHECK ((auth.jwt() ->> 'email') = 'novaaudiopank@gmail.com');

-- ---------------------------------------------------------------------------
-- Storage: bucket publico 'founder-videos' (primeiro uso de Storage no projeto).
-- Publico = a URL do arquivo abre sem token, necessario pra visitante deslogado.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('founder-videos', 'founder-videos', true)
ON CONFLICT (id) DO NOTHING;

-- Leitura publica dos arquivos do bucket
DROP POLICY IF EXISTS "founder_videos_storage_public_read" ON storage.objects;
CREATE POLICY "founder_videos_storage_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'founder-videos');

-- Somente o admin sobe/apaga arquivo nesse bucket
DROP POLICY IF EXISTS "founder_videos_storage_admin_write" ON storage.objects;
CREATE POLICY "founder_videos_storage_admin_write" ON storage.objects
  FOR ALL
  USING (bucket_id = 'founder-videos' AND (auth.jwt() ->> 'email') = 'novaaudiopank@gmail.com')
  WITH CHECK (bucket_id = 'founder-videos' AND (auth.jwt() ->> 'email') = 'novaaudiopank@gmail.com');
