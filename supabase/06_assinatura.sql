-- =====================================================================
-- Lucrei · 06 · Planos, teste grátis de 30 dias, assinatura (Asaas) e bloqueio suave
-- =====================================================================
-- Regras:
--  * Empresa nova nasce em teste por 30 dias, com tudo liberado.
--  * Assinou e pagou: liberada até o próximo vencimento (pago_ate) + 3 dias de carência.
--  * Não pagou / cancelou e passou da data: "só leitura" — vê tudo, não lança nada.
--  * Vendas do Mercado Livre continuam entrando (servidor), para o estoque não ficar errado.
--  * status, plano, datas e ids do Asaas só mudam pelo servidor, nunca pelo navegador.

-- ---------- Planos ----------
create table if not exists plano (
  codigo text primary key,
  nome text not null,
  preco numeric(10,2) not null check (preco > 0),
  limite_vendas int not null,       -- vendas por mês
  ordem int not null default 0,
  ativo boolean not null default true
);
insert into plano (codigo, nome, preco, limite_vendas, ordem) values
  ('inicial',      'Inicial',      59.90,  100, 1),
  ('crescimento',  'Crescimento',  99.00,  300, 2),
  ('profissional', 'Profissional', 159.00, 1000, 3)
on conflict (codigo) do update set nome = excluded.nome, preco = excluded.preco, limite_vendas = excluded.limite_vendas, ordem = excluded.ordem;

alter table plano enable row level security;
create policy plano_publico on plano for select using (ativo);
grant select on plano to anon, authenticated;

-- ---------- Empresa: campos da assinatura ----------
alter table empresa drop constraint if exists empresa_status_check;
alter table empresa add constraint empresa_status_check
  check (status in ('teste','ativa','atrasada','cancelada','suspensa','cortesia'));
alter table empresa alter column status set default 'teste';
alter table empresa alter column plano set default 'teste';
alter table empresa alter column teste_ate set default now() + interval '30 days';
alter table empresa add column if not exists pago_ate date;               -- próximo vencimento já coberto
alter table empresa add column if not exists asaas_cliente_id text;
alter table empresa add column if not exists asaas_assinatura_id text unique;
alter table empresa add column if not exists cobranca_url text;           -- fatura em aberto (link do Asaas)
alter table empresa add column if not exists cobranca_vencimento date;

-- Eventos do Asaas já processados (o Asaas pode reenviar)
create table if not exists asaas_evento (
  id text primary key,
  evento text not null,
  empresa_id uuid references empresa(id) on delete set null,
  recebido_em timestamptz not null default now()
);
alter table asaas_evento enable row level security;   -- sem políticas: só o servidor

-- Navegador não mexe nos campos de cobrança da empresa (só servidor / funções do sistema)
create or replace function tg_empresa_protege_cobranca() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.status is distinct from old.status or new.plano is distinct from old.plano or
       new.teste_ate is distinct from old.teste_ate or new.pago_ate is distinct from old.pago_ate or
       new.asaas_cliente_id is distinct from old.asaas_cliente_id or new.asaas_assinatura_id is distinct from old.asaas_assinatura_id or
       new.cobranca_url is distinct from old.cobranca_url or new.cobranca_vencimento is distinct from old.cobranca_vencimento) then
    raise exception 'Os dados da assinatura não podem ser alterados por aqui.';
  end if;
  return new;
end $$;
create trigger empresa_protege_cobranca before update on empresa for each row execute function tg_empresa_protege_cobranca();

-- ---------- Liberada para lançar? ----------
create or replace function empresa_liberada(p_empresa uuid default null) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select e.status = 'cortesia'
        or coalesce(e.teste_ate > now(), false)
        or coalesce(current_date <= e.pago_ate + 3, false)
    from empresa e where e.id = coalesce(p_empresa, empresa_atual())), false)
$$;

-- Dono, sem olhar o bloqueio (para LER finanças, auditoria e convites)
create or replace function is_dono() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(meu_papel() = 'dono', false) $$;

-- Lançar/alterar: dono ou operador E empresa liberada. O servidor (service_role) passa sempre.
create or replace function is_membro() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.role(), '') = 'service_role' or (coalesce(meu_papel() in ('dono','operador'), false) and empresa_liberada())
$$;
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.role(), '') = 'service_role' or (coalesce(meu_papel() = 'dono', false) and empresa_liberada())
$$;

-- Leituras que usavam is_admin() passam a usar is_dono(); escrita continua exigindo is_admin().
alter policy auditoria_sel on auditoria using (empresa_id = (select empresa_atual()) and (select is_dono()));
alter policy convite_all on convite using (empresa_id = (select empresa_atual()) and (select is_dono()))
  with check (empresa_id = (select empresa_atual()) and (select is_admin()));
create policy convite_del_liberada on convite as restrictive for delete using ((select is_admin()));

do $$
declare t text;
begin
  foreach t in array array['conta_financeira','movimento_financeiro','despesa','ml_recebivel'] loop
    execute format('alter policy %I on %I using (empresa_id = (select empresa_atual()) and (select is_dono())) with check (empresa_id = (select empresa_atual()) and (select is_admin()))', t || '_dono', t);
    execute format('create policy %I on %I as restrictive for delete using ((select is_admin()))', t || '_del_liberada', t);
  end loop;
end $$;

-- ---------- Situação da assinatura (para a faixa no topo e a tela Assinar) ----------
create or replace function minha_assinatura() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not is_leitor() then null else (
    select jsonb_build_object(
      'status', e.status,
      'situacao', case
         when e.status = 'cortesia' then 'cortesia'
         when not empresa_liberada(e.id) then 'bloqueada'
         when e.asaas_assinatura_id is not null and e.status = 'atrasada' then 'atrasada'
         when e.pago_ate is not null and e.status in ('ativa','atrasada') then 'ativa'
         when e.status = 'cancelada' then 'cancelada'
         else 'teste' end,
      'liberada', empresa_liberada(e.id),
      'plano', e.plano,
      'plano_nome', p.nome,
      'preco', p.preco,
      'limite_vendas', p.limite_vendas,
      'teste_ate', e.teste_ate,
      'dias_teste', greatest(0, ceil(extract(epoch from (e.teste_ate - now())) / 86400))::int,
      'pago_ate', e.pago_ate,
      'assinada', e.asaas_assinatura_id is not null,
      'cobranca_url', e.cobranca_url,
      'cobranca_vencimento', e.cobranca_vencimento,
      'documento', e.documento,
      'vendas_mes', (select count(*) from venda v where v.empresa_id = e.id and v.status not in ('cancelada','devolvida')
                      and v.data >= date_trunc('month', current_date)::date))
    from empresa e left join plano p on p.codigo = e.plano
    where e.id = empresa_atual())
  end
$$;

-- ---------- Empresa nova: 30 dias de teste ----------
create or replace function criar_empresa(p_nome text, p_tipo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_canal uuid; v_ml uuid;
begin
  if auth.uid() is null then raise exception 'Faça login'; end if;
  if coalesce(trim(p_nome),'') = '' then raise exception 'Dê um nome à empresa'; end if;
  if p_tipo not in ('revenda','fabricacao','misto') then raise exception 'Tipo de negócio inválido'; end if;
  insert into empresa (nome, tipo_negocio, modulos, email_avisos, status, plano, teste_ate)
  values (trim(p_nome), p_tipo,
          jsonb_build_object('compras', true, 'financas', true, 'mercado_livre', true, 'clientes', true,
                             'fornecedores', true, 'kits', true, 'producao', p_tipo <> 'revenda'),
          (select email from usuario where id = auth.uid()),
          'teste', 'teste', now() + interval '30 days')
  returning id into v_id;
  insert into membro (empresa_id, user_id, papel) values (v_id, auth.uid(), 'dono');
  update usuario set empresa_atual = v_id where id = auth.uid();

  -- Ponto de partida: canais e categorias comuns (tudo editável depois)
  insert into canal (empresa_id, nome, tipo) values (v_id, 'Venda direta', 'direto') returning id into v_canal;
  insert into canal_taxa (empresa_id, canal_id, perfil) values (v_id, v_canal, 'Padrão');
  insert into canal (empresa_id, nome, tipo) values (v_id, 'Mercado Livre', 'marketplace') returning id into v_ml;
  insert into canal_taxa (empresa_id, canal_id, perfil, perc_taxa) values (v_id, v_ml, 'Clássico', 12), (v_id, v_ml, 'Premium', 17);
  insert into categoria (empresa_id, nome, tipo) values
    (v_id, 'Anúncios', 'despesa'), (v_id, 'Contador e impostos', 'despesa'), (v_id, 'Ferramentas e sistemas', 'despesa'), (v_id, 'Outras', 'despesa'),
    (v_id, 'Geral', 'produto');
  if p_tipo <> 'revenda' then
    insert into categoria (empresa_id, nome, tipo) values (v_id, 'Matéria-prima', 'material'), (v_id, 'Embalagem', 'material');
  end if;
  return v_id;
end $$;

-- ---------- Chamadas pelo servidor (função assinatura / webhook do Asaas) ----------
create or replace function assinatura_aplicar(p_empresa uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Sem permissão'; end if;
  update empresa set
    status              = coalesce(p->>'status', status),
    plano               = coalesce(p->>'plano', plano),
    documento           = coalesce(p->>'documento', documento),
    asaas_cliente_id    = coalesce(p->>'asaas_cliente_id', asaas_cliente_id),
    asaas_assinatura_id = case when p ? 'asaas_assinatura_id' then p->>'asaas_assinatura_id' else asaas_assinatura_id end,
    pago_ate            = case when p ? 'pago_ate' then greatest(pago_ate, (p->>'pago_ate')::date) else pago_ate end,
    cobranca_url        = case when p ? 'cobranca_url' then p->>'cobranca_url' else cobranca_url end,
    cobranca_vencimento = case when p ? 'cobranca_vencimento' then (p->>'cobranca_vencimento')::date else cobranca_vencimento end
  where id = p_empresa;
end $$;

revoke execute on function assinatura_aplicar(uuid, jsonb) from public, anon, authenticated;
revoke execute on function minha_assinatura(), empresa_liberada(uuid), is_dono(), criar_empresa(text, text) from public, anon;
revoke execute on function tg_empresa_protege_cobranca() from public, anon, authenticated;
grant execute on function minha_assinatura(), empresa_liberada(uuid), is_dono(), criar_empresa(text, text) to authenticated, service_role;
grant execute on function assinatura_aplicar(uuid, jsonb) to service_role;

-- A empresa do dono do sistema não paga
update empresa set status = 'cortesia', plano = 'profissional', teste_ate = null where id = '2eefa944-189f-4ac0-881f-e8db548c8f5f'; -- Patevão Store
