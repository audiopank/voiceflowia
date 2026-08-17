-- Vínculo entre a conta do VoiceFlow IA e a conta do cliente na NewPost-IA
-- (rede social própria, projeto Supabase hzmtdfojctctvgqjdbex).
--
-- Por que existe: pra publicar no feed como o PRÓPRIO cliente (e não por um perfil
-- genérico "VoiceFlow"), precisamos de uma sessão dele na NewPost-IA. Guardamos aqui
-- o refresh_token dessa sessão pra ele não ter que logar de novo a cada publicação.
--
-- SEGURANÇA: RLS ligado e NENHUMA policy de propósito. Isso torna a tabela invisível
-- pro navegador (anon/authenticated) — só a service_role, usada pelas rotas /api,
-- consegue ler. O refresh_token nunca pode chegar ao cliente: com ele, qualquer um
-- assumiria a conta do usuário na rede.

create table if not exists public.newpost_contas (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  newpost_user_id uuid not null,
  newpost_email   text not null,
  refresh_token   text,
  -- Só pra quando a conta foi criada por nós: o cliente pode querer entrar
  -- direto na NewPost-IA um dia, e sem isso ele não teria como.
  senha_gerada    text,
  criada_por_nos  boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.newpost_contas enable row level security;

-- Índice pra achar o vínculo pelo lado da rede (ex.: auditoria de quem publicou o quê).
create index if not exists newpost_contas_newpost_user_id_idx
  on public.newpost_contas (newpost_user_id);

comment on table public.newpost_contas is
  'Vínculo VoiceFlow -> NewPost-IA. Sem policies de RLS: acesso apenas via service_role nas rotas /api.';
