-- =====================================================================
-- Apura · 12 · Painel do administrador da plataforma
-- =====================================================================
-- Quem administra o Apura (não o dono de uma loja) vê todas as empresas e pode
-- estender teste, dar cortesia e bloquear. Ninguém lê a tabela diretamente:
-- tudo passa por funções que conferem se quem chama está em plataforma_admin.
-- Para dar acesso a alguém (só pelo painel SQL do Supabase):
--   insert into plataforma_admin (user_id) select id from auth.users where email = '<e-mail>';

create table if not exists plataforma_admin (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table plataforma_admin enable row level security;   -- sem políticas: invisível para o navegador
revoke all on plataforma_admin from anon, authenticated;

-- Histórico do que o administrador fez
create table if not exists plataforma_admin_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null,
  empresa_id uuid references empresa(id) on delete set null,
  acao text not null,
  detalhe jsonb,
  feito_em timestamptz not null default now()
);
alter table plataforma_admin_log enable row level security;
revoke all on plataforma_admin_log from anon, authenticated;

-- Bloqueio manual, separado da cobrança (um pagamento não desfaz o bloqueio)
alter table empresa add column if not exists bloqueio_admin text;

create or replace function sou_admin_plataforma() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from plataforma_admin where user_id = auth.uid())
$$;

-- Empresa bloqueada pelo administrador não lança nada (fica só leitura, como teste vencido)
create or replace function empresa_liberada(p_empresa uuid default null) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select e.bloqueio_admin is null and (
           e.status = 'cortesia'
        or coalesce(e.teste_ate > now(), false)
        or coalesce(current_date <= e.pago_ate + 3, false))
    from empresa e
    where e.id = coalesce(p_empresa, empresa_atual())
      and (coalesce(auth.role(), '') = 'service_role' or auth.uid() is null
           or exists (select 1 from membro m where m.empresa_id = e.id and m.user_id = auth.uid()))), false)
$$;

-- O navegador também não mexe no bloqueio
create or replace function tg_empresa_protege_cobranca() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.status is distinct from old.status or new.plano is distinct from old.plano or
       new.teste_ate is distinct from old.teste_ate or new.pago_ate is distinct from old.pago_ate or
       new.asaas_cliente_id is distinct from old.asaas_cliente_id or new.asaas_assinatura_id is distinct from old.asaas_assinatura_id or
       new.cobranca_url is distinct from old.cobranca_url or new.cobranca_vencimento is distinct from old.cobranca_vencimento or
       new.documento is distinct from old.documento or new.created_by is distinct from old.created_by or new.id is distinct from old.id or
       new.bloqueio_admin is distinct from old.bloqueio_admin) then
    raise exception 'Os dados da assinatura não podem ser alterados por aqui.';
  end if;
  return new;
end $$;

-- ---------- Lista de todas as empresas ----------
create or replace function admin_empresas() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not sou_admin_plataforma() then raise exception 'Sem permissão'; end if;
  return coalesce((
    select jsonb_agg(x order by x.criada_em desc) from (
      select e.id, e.nome, e.tipo_negocio, e.status, e.plano, p.nome as plano_nome, p.preco,
        e.created_at as criada_em, e.teste_ate, e.pago_ate, e.bloqueio_admin, e.documento,
        e.asaas_assinatura_id is not null as assinada, e.cobranca_vencimento,
        (e.bloqueio_admin is null and (e.status = 'cortesia' or coalesce(e.teste_ate > now(), false)
          or coalesce(current_date <= e.pago_ate + 3, false))) as liberada,
        case
          when e.bloqueio_admin is not null then 'bloqueada'
          when e.status = 'cortesia' then 'cortesia'
          when e.status = 'cancelada' then 'cancelada'
          when e.pago_ate is not null and current_date <= e.pago_ate + 3 and e.status in ('ativa','atrasada') then
            case when e.status = 'atrasada' then 'atrasada' else 'pagante' end
          when e.pago_ate is not null and e.status in ('ativa','atrasada') then 'vencida'
          when coalesce(e.teste_ate > now(), false) then 'teste'
          else 'teste_vencido' end as situacao,
        u.nome as dono_nome, u.email as dono_email,
        (select count(*) from membro m where m.empresa_id = e.id) as usuarios,
        (select count(*) from venda v where v.empresa_id = e.id) as vendas,
        (select count(*) from venda v where v.empresa_id = e.id and v.data >= current_date - 30) as vendas_30d,
        (select max(v.data) from venda v where v.empresa_id = e.id) as ultima_venda,
        (select count(*) from produto pr where pr.empresa_id = e.id) as produtos,
        exists (select 1 from ml_conta c where c.empresa_id = e.id and c.refresh_token is not null) as ml_conectado,
        (select max(greatest(au.last_sign_in_at, (select max(s.updated_at) from auth.sessions s where s.user_id = au.id)))
           from membro m join auth.users au on au.id = m.user_id where m.empresa_id = e.id) as ultimo_acesso
      from empresa e
      left join plano p on p.codigo = e.plano
      left join usuario u on u.id = e.created_by
    ) x), '[]'::jsonb);
end $$;

-- ---------- Ações ----------
create or replace function admin_acao(p_empresa uuid, p_acao text, p_dias int default null, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare e empresa;
begin
  if not sou_admin_plataforma() then raise exception 'Sem permissão'; end if;
  select * into e from empresa where id = p_empresa for update;
  if not found then raise exception 'Empresa não encontrada'; end if;

  if p_acao = 'estender_teste' then
    if coalesce(p_dias, 0) not between 1 and 365 then raise exception 'Informe de 1 a 365 dias'; end if;
    update empresa set teste_ate = greatest(coalesce(teste_ate, now()), now()) + make_interval(days => p_dias),
                       status = case when status in ('cancelada') and pago_ate is null then 'teste' else status end
      where id = p_empresa;
  elsif p_acao = 'cortesia' then
    update empresa set status = 'cortesia' where id = p_empresa;
  elsif p_acao = 'tirar_cortesia' then
    if e.status <> 'cortesia' then raise exception 'Esta empresa não está em cortesia'; end if;
    update empresa set status = case when pago_ate is not null then 'ativa' else 'teste' end where id = p_empresa;
  elsif p_acao = 'bloquear' then
    if coalesce(trim(p_motivo), '') = '' then raise exception 'Escreva o motivo do bloqueio'; end if;
    update empresa set bloqueio_admin = left(trim(p_motivo), 300) where id = p_empresa;
  elsif p_acao = 'desbloquear' then
    update empresa set bloqueio_admin = null where id = p_empresa;
  else
    raise exception 'Ação desconhecida';
  end if;

  insert into plataforma_admin_log (admin_id, empresa_id, acao, detalhe)
  values (auth.uid(), p_empresa, p_acao, jsonb_strip_nulls(jsonb_build_object('dias', p_dias, 'motivo', p_motivo)));
end $$;

create or replace function admin_historico(p_empresa uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not sou_admin_plataforma() then raise exception 'Sem permissão'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('acao', l.acao, 'detalhe', l.detalhe, 'feito_em', l.feito_em, 'por', u.nome) order by l.feito_em desc)
    from plataforma_admin_log l left join usuario u on u.id = l.admin_id where l.empresa_id = p_empresa), '[]'::jsonb);
end $$;

revoke execute on function sou_admin_plataforma(), admin_empresas(), admin_acao(uuid, text, int, text), admin_historico(uuid) from public, anon;
grant execute on function sou_admin_plataforma(), admin_empresas(), admin_acao(uuid, text, int, text), admin_historico(uuid) to authenticated;
CREATE OR REPLACE FUNCTION public.minha_assinatura()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when not is_leitor() then null else (
    select jsonb_build_object(
      'status', e.status,
      'situacao', case
         when e.bloqueio_admin is not null then 'bloqueada'
         when e.status = 'cortesia' then 'cortesia'
         when not empresa_liberada(e.id) then 'bloqueada'
         when e.asaas_assinatura_id is not null and e.status = 'atrasada' then 'atrasada'
         when e.pago_ate is not null and e.status in ('ativa','atrasada') then 'ativa'
         when e.status = 'cancelada' then 'cancelada'
         else 'teste' end,
      'liberada', empresa_liberada(e.id),
      'bloqueio_admin', e.bloqueio_admin is not null,
      'plano', e.plano,
      'plano_nome', p.nome,
      'preco', p.preco,
      'limite_vendas', p.limite_vendas,
      'teste_ate', e.teste_ate,
      'dias_teste', greatest(0, ceil(extract(epoch from (e.teste_ate - now())) / 86400))::int,
      'pago_ate', e.pago_ate,
      'assinada', e.asaas_assinatura_id is not null,
      'cobranca_url', case when is_dono() then e.cobranca_url end,
      'cobranca_vencimento', e.cobranca_vencimento,
      'documento', case when is_dono() then e.documento end,
      'vendas_mes', (select count(*) from venda v where v.empresa_id = e.id and v.status not in ('cancelada','devolvida')
                      and v.data >= date_trunc('month', current_date)::date))
    from empresa e left join plano p on p.codigo = e.plano
    where e.id = empresa_atual())
  end
$function$

;
