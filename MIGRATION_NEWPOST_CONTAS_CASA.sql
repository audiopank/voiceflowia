-- Perfis da CASA na NewPost-IA (11/11/2026) — seletor "Publicar como" SÓ do admin.
--
-- Por que existe: `newpost_contas` tem user_id como chave primária = 1 perfil da rede por
-- conta do VoiceFlow. O admin publica também como os perfis da casa (Achadinhos NewPost-IA,
-- NewPost-IA, VoiceFlow IA). Cada linha aqui é um desses perfis, ligado à conta do admin.
--
-- O que é guardado: o refresh_token da sessão do perfil na rede. A SENHA NÃO é guardada —
-- ela é usada uma vez, no cadastro, para entrar; depois só o refresh_token é renovado.
--
-- SEGURANÇA: igual a newpost_contas — RLS ligado e NENHUMA policy. O navegador não lê nem
-- escreve; só a service_role, dentro de /api/newpost/sessao (que confere o e-mail do admin).

create table if not exists public.newpost_contas_casa (
  id              uuid primary key default gen_random_uuid(),
  dono_user_id    uuid not null references auth.users(id) on delete cascade,
  nome            text not null,
  newpost_email   text not null,
  newpost_user_id uuid not null,
  refresh_token   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (dono_user_id, newpost_email)
);

alter table public.newpost_contas_casa enable row level security;

comment on table public.newpost_contas_casa is
  'Perfis da casa na NewPost-IA (seletor do admin). Sem policies de RLS: acesso apenas via service_role nas rotas /api.';

-- Conferência depois de rodar (deve voltar: rls = true, policies = 0):
-- select relrowsecurity as rls,
--        (select count(*) from pg_policies where tablename = 'newpost_contas_casa') as policies
-- from pg_class where relname = 'newpost_contas_casa';
