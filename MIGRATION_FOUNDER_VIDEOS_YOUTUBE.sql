-- Videos do fundador: aceitar link do YouTube alem de upload de arquivo.
--
-- POR QUE: o plano Free da Supabase tem teto RIGIDO de 50MB por arquivo
-- ("For Free projects, the limit can't exceed 50 MB") — nao da pra configurar
-- pra mais. Um video de 4 minutos direto do celular passa de 150MB. E mesmo
-- que coubesse, servir video pela Storage numa landing queima a cota de banda
-- rapido. Link do YouTube resolve os dois: duracao livre e banda por conta do
-- YouTube. Upload direto continua valendo pros clipes curtos.
--
-- Rodar DEPOIS do CREATE_FOUNDER_VIDEOS_TABLE.sql.

ALTER TABLE founder_videos ADD COLUMN IF NOT EXISTS youtube_id TEXT;

-- Video do YouTube nao tem arquivo na Storage, entao esses dois deixam de ser
-- obrigatorios (a checagem de "tem um ou tem outro" vira o CHECK abaixo).
ALTER TABLE founder_videos ALTER COLUMN video_url DROP NOT NULL;
ALTER TABLE founder_videos ALTER COLUMN video_path DROP NOT NULL;

-- Toda linha precisa ser OU um video do YouTube OU um arquivo na Storage.
-- Sem isso daria pra gravar uma linha sem video nenhum e a pagina publica
-- renderizaria um card vazio.
--
-- O youtube_id e checado por formato (11 chars do alfabeto do YouTube) e nao
-- so por NOT NULL: string vazia passaria no NOT NULL e viraria card morto no ar.
-- Mesma regra que o extrairYoutubeId aplica no front, agora garantida no banco.
ALTER TABLE founder_videos DROP CONSTRAINT IF EXISTS founder_videos_fonte_check;
ALTER TABLE founder_videos ADD CONSTRAINT founder_videos_fonte_check CHECK (
  youtube_id ~ '^[A-Za-z0-9_-]{11}$'
  OR (video_url IS NOT NULL AND video_path IS NOT NULL)
);
