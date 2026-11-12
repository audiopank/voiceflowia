-- "Minha marca" na conta (12/11/2026) — Fatia 1 do Pacote 3.
--
-- Uma linha por conta do VoiceFlow: a descrição da marca (escrita uma vez no Dashboard,
-- "Em que você está trabalhando?") e as 2 cores dos cards. Todas as telas leem daqui:
-- Super Agente (Comece rápido), Catálogo e Kit de WhatsApp (Fatos da marca), cards (cores).
--
-- SEGURANÇA: diferente de newpost_contas, aqui não há segredo — é texto do próprio cliente.
-- RLS ligado com policies SÓ da própria linha (auth.uid() = user_id). Sem DELETE (apagar a
-- conta apaga a linha pelo cascade). Os CHECKs são a trava no banco: o navegador pode ser
-- adulterado, o banco não.

create table if not exists public.marca_perfil (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  descricao    text not null default '' check (char_length(descricao) <= 4000),
  cor_fundo    text check (cor_fundo is null or cor_fundo ~ '^#[0-9A-Fa-f]{6}$'),
  cor_destaque text check (cor_destaque is null or cor_destaque ~ '^#[0-9A-Fa-f]{6}$'),
  updated_at   timestamptz not null default now()
);

alter table public.marca_perfil enable row level security;

create policy "marca_perfil: le a propria" on public.marca_perfil
  for select to authenticated using (auth.uid() = user_id);
create policy "marca_perfil: cria a propria" on public.marca_perfil
  for insert to authenticated with check (auth.uid() = user_id);
create policy "marca_perfil: edita a propria" on public.marca_perfil
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.marca_perfil is
  'Minha marca (descrição + cores dos cards), 1 linha por conta. RLS: cada usuário só a própria linha.';

-- Conferência depois de rodar (deve voltar: rls = true, policies = 3):
-- select relrowsecurity as rls,
--        (select count(*) from pg_policies where tablename = 'marca_perfil') as policies
-- from pg_class where relname = 'marca_perfil';
