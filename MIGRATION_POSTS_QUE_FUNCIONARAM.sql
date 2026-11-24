-- 👍 "Esse funcionou" (24/11/2026) — Fatia 2 do Pacote 3 (memória do que funcionou).
--
-- O dono marca, em Meus Conteúdos, os posts que deram certo pra marca dele. O Super Agente
-- usa até 3 desses (do mesmo nicho) como EXEMPLO de tom e tipo de gancho nas próximas gerações.
-- É a opinião do dono, não uma métrica: a tela diz isso.
--
-- Guarda uma cópia do texto do post (gancho/roteiro/legenda) — `contents` não é editável, então
-- a cópia nunca diverge, e a geração lê uma tabela só.
--
-- SEGURANÇA: RLS com policies SÓ da própria linha. O INSERT ainda confere que o `contents`
-- marcado é do próprio usuário (não dá pra marcar post de outra conta). Sem UPDATE: desmarcar
-- = DELETE. CHECKs de tamanho: o navegador pode ser adulterado, o banco não.

create table if not exists public.posts_que_funcionaram (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  content_id  uuid not null references public.contents(id) on delete cascade,
  post_index  int  not null check (post_index between 0 and 500),
  nicho       text not null default '' check (char_length(nicho) <= 200),
  hook        text not null default '' check (char_length(hook) <= 300),
  roteiro     text not null default '' check (char_length(roteiro) <= 2000),
  legenda     text not null default '' check (char_length(legenda) <= 3000),
  created_at  timestamptz not null default now(),
  unique (content_id, post_index)
);

create index if not exists posts_que_funcionaram_user_idx on public.posts_que_funcionaram (user_id, created_at desc);

alter table public.posts_que_funcionaram enable row level security;

create policy "funcionou: le os proprios" on public.posts_que_funcionaram
  for select to authenticated using (auth.uid() = user_id);
create policy "funcionou: marca post proprio" on public.posts_que_funcionaram
  for insert to authenticated with check (
    auth.uid() = user_id
    and exists (select 1 from public.contents c where c.id = content_id and c.user_id = auth.uid())
  );
create policy "funcionou: desmarca os proprios" on public.posts_que_funcionaram
  for delete to authenticated using (auth.uid() = user_id);

comment on table public.posts_que_funcionaram is
  '👍 Esse funcionou: posts marcados pelo dono; o Super Agente usa até 3 do mesmo nicho como exemplo de estilo. RLS: só a própria linha.';

-- Conferência depois de rodar (deve voltar: rls = true, policies = 3):
-- select relrowsecurity as rls,
--        (select count(*) from pg_policies where tablename = 'posts_que_funcionaram') as policies
-- from pg_class where relname = 'posts_que_funcionaram';
