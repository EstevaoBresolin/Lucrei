-- =====================================================================
-- Lucrei · 01 · Base multi-empresa (empresas, usuários, papéis, convites)
-- =====================================================================
-- Cada linha de dado de negócio tem empresa_id. O RLS só deixa ver/alterar
-- linhas da "empresa atual" do usuário (usuario.empresa_atual), e só se ele
-- for membro dela. Funções chamadas pelo servidor (service_role) informam a
-- empresa com set_config('app.empresa', <uuid>, true).
-- Internamente "material" = Insumo (o nome da tela é Insumos).

create extension if not exists pgcrypto;

-- ---------- Empresa ----------
create table empresa (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  tipo_negocio text not null default 'revenda' check (tipo_negocio in ('revenda','fabricacao','misto')),
  -- Módulos opcionais ligados. O núcleo (vendas, produtos, estoque, painel) é sempre ligado.
  modulos jsonb not null default '{"compras":true,"financas":true,"mercado_livre":true,"clientes":true,"fornecedores":true,"kits":true,"producao":false}'::jsonb,
  -- Parâmetros da empresa (antes tabela "parametro")
  imposto_perc numeric(5,2) not null default 0,
  permite_estoque_negativo boolean not null default false,
  dias_alerta_venda_aberta int not null default 5,
  email_avisos text,
  ntfy_topico text,
  -- Comercial (ainda não usado pelo sistema; preparado para planos e cobrança)
  plano text not null default 'gratis',
  status text not null default 'ativa' check (status in ('teste','ativa','suspensa','cancelada')),
  teste_ate timestamptz,
  documento text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------- Usuário (perfil global) ----------
create table usuario (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  email text,
  empresa_atual uuid references empresa(id) on delete set null,
  termos_versao text,
  termos_aceitos_em timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Membros e papéis ----------
create table membro (
  empresa_id uuid not null references empresa(id) on delete cascade,
  user_id uuid not null references usuario(id) on delete cascade,
  papel text not null default 'operador' check (papel in ('dono','operador','leitura')),
  created_at timestamptz not null default now(),
  primary key (empresa_id, user_id)
);
create index membro_user on membro(user_id);

create table convite (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresa(id) on delete cascade,
  email text,
  papel text not null default 'operador' check (papel in ('dono','operador','leitura')),
  token text not null unique default encode(gen_random_bytes(18), 'hex'),
  criado_por uuid default auth.uid(),
  aceito_por uuid references usuario(id),
  aceito_em timestamptz,
  expira_em timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);

-- ---------- Funções de acesso ----------
-- Empresa em uso. Servidor: valor de app.empresa. Usuário: usuario.empresa_atual, se for membro.
create or replace function empresa_atual() returns uuid
language sql stable security definer set search_path = public as $$
  select case
    when coalesce(auth.role(),'') = 'service_role' then nullif(current_setting('app.empresa', true), '')::uuid
    else (select u.empresa_atual from usuario u
           join membro m on m.empresa_id = u.empresa_atual and m.user_id = u.id
          where u.id = auth.uid())
  end
$$;

create or replace function meu_papel() returns text
language sql stable security definer set search_path = public as $$
  select case when coalesce(auth.role(),'') = 'service_role' then 'dono'
    else (select papel from membro where empresa_id = empresa_atual() and user_id = auth.uid()) end
$$;

-- Pode ler a empresa atual (qualquer papel)
create or replace function is_leitor() returns boolean
language sql stable security definer set search_path = public as $$ select meu_papel() is not null $$;
-- Pode lançar e alterar (dono ou operador)
create or replace function is_membro() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(meu_papel() in ('dono','operador'), false) $$;
-- Dono (finanças, configurações, exclusões, usuários)
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(meu_papel() = 'dono', false) $$;

create or replace function modulo_ligado(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (modulos->>p)::boolean from empresa where id = empresa_atual()), false)
$$;

-- ---------- Triggers utilitários ----------
create or replace function tg_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

-- Novo login → perfil global
create or replace function tg_novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into usuario (id, nome, email, termos_versao, termos_aceitos_em)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)), new.email,
          new.raw_user_meta_data->>'termos_versao',
          case when new.raw_user_meta_data ? 'termos_versao' then now() end)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function tg_novo_usuario();

-- Número sequencial por empresa (vendas, compras, ordens)
create or replace function tg_numero_por_empresa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.numero is null then
    perform pg_advisory_xact_lock(hashtext(tg_table_name || new.empresa_id::text));
    execute format('select coalesce(max(numero),0) + 1 from %I where empresa_id = $1', tg_table_name)
      into new.numero using new.empresa_id;
  end if;
  return new;
end $$;

-- Auditoria
create table auditoria (
  id bigserial primary key,
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  tabela text not null,
  registro_id uuid,
  acao text not null,
  antes jsonb,
  depois jsonb,
  usuario_id uuid default auth.uid(),
  data timestamptz not null default now()
);
create index auditoria_empresa on auditoria(empresa_id, data);

create or replace function tg_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into auditoria (empresa_id, tabela, registro_id, acao, antes, depois)
  values (coalesce(case when tg_op = 'DELETE' then old.empresa_id else new.empresa_id end, empresa_atual()),
          tg_table_name,
          case when tg_op = 'DELETE' then old.id else new.id end,
          tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

-- ---------- RLS da base ----------
alter table empresa enable row level security;
alter table usuario enable row level security;
alter table membro enable row level security;
alter table convite enable row level security;
alter table auditoria enable row level security;

create policy empresa_sel on empresa for select using (exists (select 1 from membro m where m.empresa_id = empresa.id and m.user_id = auth.uid()));
create policy empresa_upd on empresa for update using (id = (select empresa_atual()) and (select is_admin())) with check (id = (select empresa_atual()));

create policy usuario_sel on usuario for select using (
  id = auth.uid() or exists (select 1 from membro m where m.user_id = usuario.id and m.empresa_id = (select empresa_atual())));
create policy usuario_upd on usuario for update using (id = auth.uid()) with check (id = auth.uid());

create policy membro_sel on membro for select using (user_id = auth.uid() or empresa_id = (select empresa_atual()));
create policy membro_upd on membro for update using (empresa_id = (select empresa_atual()) and (select is_admin())) with check (empresa_id = (select empresa_atual()));
create policy membro_del on membro for delete using (empresa_id = (select empresa_atual()) and (select is_admin()) and user_id <> auth.uid());

create policy convite_all on convite for all using (empresa_id = (select empresa_atual()) and (select is_admin()))
  with check (empresa_id = (select empresa_atual()) and (select is_admin()));

create policy auditoria_sel on auditoria for select using (empresa_id = (select empresa_atual()) and (select is_admin()));

-- Usuário não muda empresa_atual para uma empresa da qual não é membro
create or replace function tg_usuario_empresa_atual() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.empresa_atual is distinct from old.empresa_atual and new.empresa_atual is not null
     and not exists (select 1 from membro where empresa_id = new.empresa_atual and user_id = new.id) then
    raise exception 'Você não faz parte desta empresa';
  end if;
  return new;
end $$;
create trigger usuario_empresa_atual before update on usuario for each row execute function tg_usuario_empresa_atual();
