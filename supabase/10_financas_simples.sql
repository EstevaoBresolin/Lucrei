-- =====================================================================
-- Lucrei · 10 · Finanças só com saldo das contas
-- =====================================================================
-- 1) Compra paga em partes: o dinheiro sai quando você lança o pagamento
--    (adiantamento, parcela, restante), não quando a compra é recebida.
--    Receber a compra agora só mexe no estoque.
-- 2) Mercado Livre fora do saldo: o dinheiro liberado pelo ML não entra mais
--    sozinho (antecipação, devolução e cancelamento deixavam o saldo errado).
--    O saldo do Mercado Pago passa a ser conferido à mão ("Conferir saldo").

create table if not exists compra_pagamento (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  compra_id uuid not null,
  conta_id uuid not null,
  data date not null default current_date,
  valor numeric(14,2) not null check (valor > 0),
  observacao text check (length(observacao) <= 200),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (empresa_id, id),
  foreign key (empresa_id, compra_id) references compra(empresa_id, id) on delete cascade,
  foreign key (empresa_id, conta_id) references conta_financeira(empresa_id, id)
);
create index if not exists compra_pagamento_compra on compra_pagamento (compra_id);

alter table compra_pagamento enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'compra_pagamento' and policyname = 'compra_pagamento_dono') then
    create policy compra_pagamento_dono on compra_pagamento for all
      using (empresa_id = (select empresa_atual()) and (select is_dono()))
      with check (empresa_id = (select empresa_atual()) and (select is_admin()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'compra_pagamento' and policyname = 'compra_pagamento_del_liberada') then
    create policy compra_pagamento_del_liberada on compra_pagamento as restrictive for delete using ((select is_admin()));
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit_compra_pagamento') then
    create trigger audit_compra_pagamento after insert or delete or update on compra_pagamento for each row execute function tg_auditoria();
  end if;
end $$;
revoke all on compra_pagamento from anon;
grant select, insert, update, delete on compra_pagamento to authenticated;

-- Pagamento não passa do total da compra
create or replace function tg_compra_pagamento_valida() returns trigger
language plpgsql set search_path = public as $$
declare v_total numeric; v_pago numeric;
begin
  select coalesce((select sum(i.qtd_compra * i.preco_unit_compra) from compra_item i where i.compra_id = c.id), 0) + c.frete + c.outras_despesas - c.desconto
    into v_total from compra c where c.id = new.compra_id;
  select coalesce(sum(valor), 0) into v_pago from compra_pagamento where compra_id = new.compra_id and id <> new.id;
  if v_pago + new.valor > round(v_total, 2) + 0.01 then
    raise exception 'O pagamento passa do total da compra. Falta pagar %.', 'R$ ' || replace(to_char(greatest(round(v_total, 2) - v_pago, 0), 'FM999999990.00'), '.', ',');
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'valida_compra_pagamento') then
    create trigger valida_compra_pagamento before insert or update on compra_pagamento for each row execute function tg_compra_pagamento_valida();
  end if;
end $$;
revoke execute on function tg_compra_pagamento_valida() from public, anon, authenticated;

-- Compras que já descontavam do saldo viram um pagamento do valor todo, com a mesma data e hora de antes:
-- o saldo de hoje continua igual.
insert into compra_pagamento (empresa_id, compra_id, conta_id, data, valor, observacao, created_by, created_at)
select c.empresa_id, c.id, coalesce(c.conta_id, (select id from conta_financeira cf where cf.padrao and cf.empresa_id = c.empresa_id limit 1)),
       c.data,
       round(coalesce((select sum(i.qtd_compra * i.preco_unit_compra) from compra_item i where i.compra_id = c.id), 0) + c.frete + c.outras_despesas - c.desconto, 2),
       'Pagamento da compra toda (lançado antes dos pagamentos em partes)', c.created_by, coalesce(c.recebida_em, c.created_at)
  from compra c
 where c.status in ('recebida','parcial')
   and coalesce(c.conta_id, (select id from conta_financeira cf where cf.padrao and cf.empresa_id = c.empresa_id limit 1)) is not null
   and round(coalesce((select sum(i.qtd_compra * i.preco_unit_compra) from compra_item i where i.compra_id = c.id), 0) + c.frete + c.outras_despesas - c.desconto, 2) > 0
   and not exists (select 1 from compra_pagamento p where p.compra_id = c.id);

-- O que o ML já tinha somado no saldo de cada conta vira um lançamento único, para o saldo de hoje não mudar.
-- Daqui para frente o dinheiro do ML não entra sozinho.
insert into movimento_financeiro (empresa_id, conta_id, data, valor, descricao, created_at)
select x.empresa_id, x.conta_id, current_date, round(sum(x.valor), 2), 'Dinheiro do Mercado Livre até hoje (antes de tirar o ML das Finanças)', now()
  from (
    select v.empresa_id, coalesce((select id from conta_financeira where recebe_ml and empresa_id = v.empresa_id limit 1),
                                  (select id from conta_financeira where padrao and empresa_id = v.empresa_id limit 1)) conta_id,
           (v.ml_liberacao_em at time zone 'America/Sao_Paulo')::date data, venda_liquido(v) valor, v.ml_liberacao_em criado
      from venda v
     where v.ml_order_id is not null and v.status not in ('cancelada','devolvida')
       and v.ml_liberacao_em is not null and (v.ml_liberado or v.ml_liberacao_em <= now())
    union all
    select r.empresa_id, coalesce((select id from conta_financeira where recebe_ml and empresa_id = r.empresa_id limit 1),
                                  (select id from conta_financeira where padrao and empresa_id = r.empresa_id limit 1)),
           (r.liberacao_em at time zone 'America/Sao_Paulo')::date, r.valor, r.liberacao_em
      from ml_recebivel r
     where r.liberacao_em is not null and (r.liberado or r.liberacao_em <= now())
       and not exists (select 1 from venda v where v.ml_order_id = r.ml_order_id and v.empresa_id = r.empresa_id)
  ) x
  join conta_financeira c on c.id = x.conta_id
 where x.data <= current_date
   and (x.data > c.saldo_em or (x.data = c.saldo_em and x.criado > c.saldo_registrado_em))
   and not exists (select 1 from movimento_financeiro m where m.empresa_id = x.empresa_id and m.descricao like 'Dinheiro do Mercado Livre até hoje%')
 group by x.empresa_id, x.conta_id
having round(sum(x.valor), 2) <> 0;

-- Total, pago e a pagar de cada compra
create or replace view vw_compra_financeiro with (security_invoker = true) as
select c.id, c.empresa_id, c.numero, c.status, c.data, f.nome fornecedor,
       round(coalesce((select sum(i.qtd_compra * i.preco_unit_compra) from compra_item i where i.compra_id = c.id), 0) + c.frete + c.outras_despesas - c.desconto, 2) total,
       coalesce((select sum(p.valor) from compra_pagamento p where p.compra_id = c.id), 0) pago
  from compra c left join fornecedor f on f.id = c.fornecedor_id
 where (select is_dono());

-- Extrato: lançamentos, transferências, despesas, pagamentos de compra e vendas fora do ML
create or replace view vw_extrato with (security_invoker = true) as
with padrao as (select id from conta_financeira where padrao and empresa_id = empresa_atual() limit 1),
     mov as (
  select m.conta_id, m.data, m.valor, m.descricao, case when m.transferencia is null then 'manual' else 'transferencia' end origem, m.id ref_id, m.created_at criado
    from movimento_financeiro m
  union all
  select coalesce(d.conta_id, (select id from padrao)), d.data, -d.valor, d.descricao, 'despesa', d.id, d.created_at from despesa d
  union all
  select p.conta_id, p.data, -p.valor, 'Pagamento da compra #' || c.numero || coalesce(' · ' || f.nome, ''), 'compra', c.id, p.created_at
    from compra_pagamento p join compra c on c.id = p.compra_id left join fornecedor f on f.id = c.fornecedor_id
  union all
  select coalesce(v.conta_id, (select id from padrao)), v.data, venda_liquido(v), 'Venda #' || v.numero || coalesce(' · ' || cn.nome, ''), 'venda', v.id, v.created_at
    from venda v left join canal cn on cn.id = v.canal_id
   where v.ml_order_id is null and v.status not in ('cancelada','devolvida')
)
select mov.conta_id, mov.data, mov.valor, mov.descricao, mov.origem, mov.ref_id, c.nome conta_nome
  from mov join conta_financeira c on c.id = mov.conta_id
 where (select is_dono())
   and (mov.data > c.saldo_em or (mov.data = c.saldo_em and mov.criado > c.saldo_registrado_em));
