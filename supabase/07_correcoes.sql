-- =====================================================================
-- Lucrei · 07 · Correções encontradas na bateria de testes de ponta a ponta
-- =====================================================================

-- ---------- 1) Saldo da conta: lançamentos do mesmo dia do saldo informado ----------
-- Antes: só contava o que tinha data DEPOIS de saldo_em. Quem informava "saldo de hoje" e lançava
-- uma retirada no mesmo dia não via o saldo mudar. Agora guardamos o momento em que o saldo foi
-- informado: no mesmo dia, conta o que foi lançado depois desse momento.
alter table conta_financeira add column if not exists saldo_registrado_em timestamptz;
-- Contas existentes mantêm a regra antiga (saldo = fim do dia de saldo_em)
update conta_financeira
   set saldo_registrado_em = ((saldo_em + 1)::timestamp at time zone 'America/Sao_Paulo')
 where saldo_registrado_em is null;
alter table conta_financeira alter column saldo_registrado_em set not null;
alter table conta_financeira alter column saldo_registrado_em set default now();

-- Ao criar a conta ou mudar o saldo inicial / a data: saldo de hoje = agora; de um dia passado = fim daquele dia
create or replace function tg_conta_saldo_registrado() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.saldo_inicial is distinct from old.saldo_inicial or new.saldo_em is distinct from old.saldo_em then
    new.saldo_registrado_em := case
      when new.saldo_em >= (now() at time zone 'America/Sao_Paulo')::date then now()
      else ((new.saldo_em + 1)::timestamp at time zone 'America/Sao_Paulo') end;
  end if;
  return new;
end $$;
drop trigger if exists conta_saldo_registrado on conta_financeira;
create trigger conta_saldo_registrado before insert or update on conta_financeira
  for each row execute function tg_conta_saldo_registrado();
revoke execute on function tg_conta_saldo_registrado() from public, anon, authenticated;

create or replace view vw_extrato with (security_invoker = true) as
with padrao as (select id from conta_financeira where padrao and empresa_id = empresa_atual() limit 1),
     contaml as (select coalesce((select id from conta_financeira where recebe_ml and empresa_id = empresa_atual() limit 1), (select id from padrao)) id),
     mov as (
  select m.conta_id, m.data, m.valor, m.descricao, case when m.transferencia is null then 'manual' else 'transferencia' end origem, m.id ref_id, m.created_at criado
    from movimento_financeiro m
  union all
  select coalesce(d.conta_id, (select id from padrao)), d.data, -d.valor, d.descricao, 'despesa', d.id, d.created_at from despesa d
  union all
  select coalesce(c.conta_id, (select id from padrao)), c.data,
         -(coalesce((select sum(i.qtd_compra * i.preco_unit_compra) from compra_item i where i.compra_id = c.id), 0) + c.frete + c.outras_despesas - c.desconto),
         'Compra #' || c.numero || coalesce(' · ' || f.nome, ''), 'compra', c.id, c.created_at
    from compra c left join fornecedor f on f.id = c.fornecedor_id
   where c.status in ('recebida','parcial')
  union all
  select coalesce(v.conta_id, (select id from padrao)), v.data, venda_liquido(v), 'Venda #' || v.numero || coalesce(' · ' || cn.nome, ''), 'venda', v.id, v.created_at
    from venda v left join canal cn on cn.id = v.canal_id
   where v.ml_order_id is null and v.status not in ('cancelada','devolvida')
  union all
  select (select id from contaml), (v.ml_liberacao_em at time zone 'America/Sao_Paulo')::date, venda_liquido(v), 'Liberado pelo ML · venda #' || v.numero, 'ml', v.id, v.ml_liberacao_em
    from venda v
   where v.ml_order_id is not null and v.status not in ('cancelada','devolvida')
     and v.ml_liberacao_em is not null and (v.ml_liberado or v.ml_liberacao_em <= now())
  union all
  select (select id from contaml), (r.liberacao_em at time zone 'America/Sao_Paulo')::date, r.valor, 'Liberado pelo ML · ' || r.descricao, 'ml_antigo', r.id, r.liberacao_em
    from ml_recebivel r
   where r.liberacao_em is not null and (r.liberado or r.liberacao_em <= now())
     and not exists (select 1 from venda v where v.ml_order_id = r.ml_order_id and v.empresa_id = r.empresa_id)
)
select mov.conta_id, mov.data, mov.valor, mov.descricao, mov.origem, mov.ref_id, c.nome conta_nome
  from mov join conta_financeira c on c.id = mov.conta_id
 where mov.data > c.saldo_em or (mov.data = c.saldo_em and mov.criado > c.saldo_registrado_em);

-- "Em conta agora" não soma lançamentos com data no futuro (despesa agendada, data digitada errada…)
create or replace view vw_conta_saldo with (security_invoker = true) as
select c.id, c.empresa_id, c.nome, c.saldo_inicial, c.saldo_em, c.padrao, c.recebe_ml, c.ativo, c.created_at,
       c.saldo_inicial + coalesce((select sum(e.valor) from vw_extrato e
                                         where e.conta_id = c.id and e.data <= (now() at time zone 'America/Sao_Paulo')::date), 0) saldo
  from conta_financeira c;

-- ---------- 2) Valores que não podem ser negativos ----------
-- NOT VALID: vale para tudo que for gravado daqui para frente, sem travar dados antigos.
do $$
declare r record;
begin
  for r in select * from (values
    ('produto', 'produto_custo_padrao_pos', 'custo_padrao >= 0'),
    ('produto', 'produto_custos_fixos_pos', 'custos_fixos_unit >= 0'),
    ('produto', 'produto_estoque_minimo_pos', 'estoque_minimo >= 0'),
    ('material', 'material_estoque_minimo_pos', 'estoque_minimo >= 0'),
    ('material', 'material_ponto_reposicao_pos', 'ponto_reposicao is null or ponto_reposicao >= 0'),
    ('preco_canal', 'preco_canal_preco_pos', 'preco_venda >= 0'),
    ('compra', 'compra_valores_pos', 'frete >= 0 and outras_despesas >= 0 and desconto >= 0'),
    ('compra_item', 'compra_item_preco_pos', 'preco_unit_compra >= 0'),
    ('despesa', 'despesa_valor_pos', 'valor > 0'),
    ('canal_taxa', 'canal_taxa_valores_pos', 'perc_taxa >= 0 and tarifa_fixa >= 0 and frete_padrao >= 0 and (tarifa_ate_preco is null or tarifa_ate_preco >= 0)'),
    ('venda', 'venda_custos_pos', 'desconto >= 0 and perc_taxa >= 0 and tarifa_fixa >= 0 and frete >= 0 and perc_imposto >= 0 and outros_custos >= 0'),
    ('fornecedor', 'fornecedor_prazo_pos', 'prazo_entrega_dias is null or prazo_entrega_dias between 0 and 365'),
    ('empresa', 'empresa_imposto_faixa', 'imposto_perc between 0 and 100'),
    ('empresa', 'empresa_dias_alerta_pos', 'dias_alerta_venda_aberta >= 0')
  ) as t(tabela, nome, regra) loop
    if not exists (select 1 from pg_constraint where conname = r.nome) then
      execute format('alter table %I add constraint %I check (%s) not valid', r.tabela, r.nome, r.regra);
    end if;
  end loop;
end $$;
