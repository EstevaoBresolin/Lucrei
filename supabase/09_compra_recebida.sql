-- =====================================================================
-- Lucrei · 09 · Compra recebida desconta do saldo a partir do recebimento
-- =====================================================================
-- Antes: a compra era comparada com o saldo informado pela data/hora em que foi CRIADA.
-- Uma compra pedida antes de informar o saldo e recebida depois nunca saía do saldo.

alter table compra add column if not exists recebida_em timestamptz;
update compra c set recebida_em = (select min(m.data) from movimento_estoque m where m.origem_tipo = 'compra' and m.origem_id = c.id)
 where c.status in ('recebida','parcial') and c.recebida_em is null;

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
         'Compra #' || c.numero || coalesce(' · ' || f.nome, ''), 'compra', c.id, coalesce(c.recebida_em, c.created_at)
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
 where (select is_dono())
   and (mov.data > c.saldo_em or (mov.data = c.saldo_em and mov.criado > c.saldo_registrado_em)
        -- compra recebida depois de informar o saldo ainda não tinha saído do saldo informado
        or (mov.origem = 'compra' and mov.criado > c.saldo_registrado_em));


-- receber marca a hora do recebimento
CREATE OR REPLACE FUNCTION public.receber_compra(p_compra uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c compra; r record; v_emp uuid := exigir_empresa();
        v_total_valor numeric; v_total_qtd numeric; v_extra numeric; v_rateio numeric; v_custo numeric; v_fator numeric;
begin
  if not is_membro() then raise exception 'Sem permissão'; end if;
  select * into c from compra where id = p_compra and empresa_id = v_emp for update;
  if c.id is null then raise exception 'Compra não encontrada'; end if;
  if c.status in ('recebida','cancelada') then raise exception 'Compra já recebida ou cancelada'; end if;
  if not exists (select 1 from compra_item where compra_id = p_compra) then raise exception 'A compra não tem itens'; end if;

  select sum(qtd_compra*preco_unit_compra), sum(qtd_compra) into v_total_valor, v_total_qtd from compra_item where compra_id = p_compra;
  v_extra := c.frete + c.outras_despesas - c.desconto;

  for r in select * from compra_item where compra_id = p_compra loop
    v_rateio := case when c.criterio_rateio = 'quantidade' then v_extra * r.qtd_compra / nullif(v_total_qtd,0)
                     else v_extra * (r.qtd_compra*r.preco_unit_compra) / nullif(v_total_valor,0) end;
    if r.item_tipo = 'material' then
      select fator_conversao into v_fator from material where id = r.material_id;
    else
      v_fator := 1;
      if (select tipo from produto where id = r.produto_id) = 'kit' then raise exception 'Kit não é comprado: compre os produtos que o compõem'; end if;
    end if;
    v_custo := ((r.qtd_compra*r.preco_unit_compra) + coalesce(v_rateio,0)) / (r.qtd_compra * v_fator);
    update compra_item set qtd_recebida = qtd_compra, custo_unit_final = round(v_custo,4) where id = r.id;
    insert into movimento_estoque (empresa_id, tipo, item_tipo, material_id, produto_id, quantidade, custo_unit, origem_tipo, origem_id)
    values (v_emp, 'compra', r.item_tipo, r.material_id, r.produto_id, r.qtd_compra * v_fator, round(v_custo,4), 'compra', p_compra);
  end loop;
  update compra set status = 'recebida', recebida_em = now() where id = p_compra;
end $function$

;
