-- Videos do fundador: marcar se o video foi gravado na vertical.
--
-- POR QUE: o card assumia 16:9 (horizontal) pra todo video do YouTube. Video
-- gravado no celular na vertical aparecia espremido no meio, com tarja preta
-- dos dois lados — ocupando metade do espaco que poderia. Com a marcacao o
-- card usa 9:16 e o video preenche o quadro inteiro.
--
-- Default false (horizontal) porque e o formato de video de tela/demo, e nao
-- muda nada nos videos que ja estao gravados como horizontais.
--
-- Rodar DEPOIS do CREATE_FOUNDER_VIDEOS_TABLE.sql.

ALTER TABLE founder_videos ADD COLUMN IF NOT EXISTS vertical BOOLEAN NOT NULL DEFAULT false;
