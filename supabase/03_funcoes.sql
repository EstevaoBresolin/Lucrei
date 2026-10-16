-- =====================================================================
-- Lucrei · 03 · Regras de negócio (funções), views e cadastro de empresa
-- =====================================================================
-- Funções SECURITY DEFINER ignoram o RLS: por isso TODAS filtram pela
-- empresa atual (v_emp) e conferem que os registros pedidos são dela.

-- Empresa atual obrigatória
create or replace function exigir_empresa() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid := empresa_atual();
begin
  if v is null then raise exception 'Nenhuma empresa selecionada'; end if;
  return v;
end $$;

-- ---------- Estoque: saldo e custo médio ----------
create or replace function tg_movimento_estoque() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_saldo numeric; v_cm numeric; v_nome text; v_novo numeric; v_cm_novo numeric; v_neg boolean; v_tipo text;
begin
  if new.item_tipo = 'material' then
    select saldo, custo_medio, nome into v_saldo, v_cm, v_nome from material
     where id = new.material_id and empresa_id = new.empresa_id for update;
  else
    select saldo, custo_medio, nome, tipo into v_saldo, v_cm, v_nome, v_tipo from produto
     where id = new.produto_id and empresa_id = new.empresa_id for update;
    if v_tipo = 'kit' then raise exception 'Kit não tem estoque próprio: movimente os produtos que o compõem'; end if;
  end if;
  if v_nome is null then raise exception 'Item não encontrado'; end if;

  v_novo := v_saldo + new.quantidade;
  select permite_estoque_negativo into v_neg from empresa where id = new.empresa_id;
  if v_novo < 0 and not coalesce(v_neg, false) then
    raise exception 'Estoque insuficiente de "%": saldo %, necessário %', v_nome, v_saldo, abs(new.quantidade) using errcode = 'P0001';
  end if;

  v_cm_novo := v_cm;
  if new.quantidade > 0 and new.custo_unit is not null
     and new.tipo in ('compra','entrada_producao','entrada_manual','devolucao','estorno_venda','ajuste') then
    if v_saldo <= 0 or v_novo <= 0 then v_cm_novo := new.custo_unit;
    else v_cm_novo := round((v_saldo * v_cm + new.quantidade * new.custo_unit) / v_novo, 4); end if;
  end if;
  if new.custo_unit is null then new.custo_unit := v_cm; end if;
  new.saldo_apos := v_novo;

  if new.item_tipo = 'material' then
    update material set saldo = v_novo, custo_medio = v_cm_novo,
      ultimo_custo = case when new.tipo = 'compra' then new.custo_unit else ultimo_custo end
     where id = new.material_id;
  else
    update produto set saldo = v_novo, custo_medio = v_cm_novo where id = new.produto_id;
  end if;
  return new;
end $$;
create trigger tg_movimento before insert on movimento_estoque for each row execute function tg_movimento_estoque();

create or replace function tg_bloqueia_alteracao() returns trigger language plpgsql set search_path = public as $$
begin raise exception 'Movimentos de estoque não podem ser alterados; lance um estorno ou ajuste.'; end $$;
create trigger tg_movimento_imutavel before update on movimento_estoque for each row execute function tg_bloqueia_alteracao();

-- ---------- Custos ----------
create or replace function custo_ficha(p_produto uuid) returns numeric
language sql stable set search_path = public as $$
  select coalesce(sum(f.quantidade * (1 + f.perc_perda/100) * m.custo_medio), 0)
       + coalesce((select custos_fixos_unit from produto where id = p_produto), 0)
  from ficha_tecnica_item f join material m on m.id = f.material_id
  where f.produto_id = p_produto
$$;

-- Custo unitário usado na venda: kit = soma dos componentes; demais = custo médio (ou o informado)
create or replace function custo_produto(p_produto uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when p.tipo = 'kit' then
           coalesce((select sum(k.quantidade * case when c.custo_medio > 0 then c.custo_medio else c.custo_padrao end)
                       from kit_item k join produto c on c.id = k.produto_id where k.kit_id = p.id), 0)
              + p.custos_fixos_unit
         else case when p.custo_medio > 0 then p.custo_medio else p.custo_padrao end end
  from produto p where p.id = p_produto and p.empresa_id = empresa_atual()
$$;

-- ---------- Movimento manual ----------
create or replace function movimentar_estoque(p_item_tipo text, p_item_id uuid, p_tipo text, p_quantidade numeric,
                                              p_custo_unit numeric default null, p_motivo text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_q numeric; v_emp uuid := exigir_empresa();
begin
  if not is_membro() then raise exception 'Sem permissão'; end if;
  if p_tipo not in ('entrada_manual','perda','ajuste','uso_interno') then raise exception 'Tipo de movimento manual inválido: %', p_tipo; end if;
  if p_quantidade is null or p_quantidade = 0 then raise exception 'Informe a quantidade'; end if;
  if p_tipo in ('perda','ajuste','uso_interno') and coalesce(p_motivo,'') = '' then raise exception 'Informe o motivo'; end if;
  v_q := case when p_tipo in ('perda','uso_interno') then -abs(p_quantidade)
              when p_tipo = 'entrada_manual' then abs(p_quantidade) else p_quantidade end;
  insert into movimento_estoque (empresa_id, tipo, item_tipo, material_id, produto_id, quantidade, custo_unit, origem_tipo, motivo)
  values (v_emp, p_tipo, p_item_tipo,
          case when p_item_tipo = 'material' then p_item_id end,
          case when p_item_tipo = 'produto' then p_item_id end,
          v_q, p_custo_unit, 'manual', nullif(p_motivo,''))
  returning id into v_id;
  return v_id;
end $$;

-- ---------- Vendas ----------
create or replace function recalcular_venda(p_id uuid, p_bruta numeric default null, p_custo numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare v venda; v_bruta numeric; v_custo numeric; v_receita numeric; v_taxa numeric; v_imp numeric; v_lucro numeric;
begin
  select * into v from venda where id = p_id and empresa_id = exigir_empresa();
  if v.id is null then raise exception 'Venda não encontrada'; end if;
  v_bruta := coalesce(p_bruta, (select coalesce(sum(quantidade*preco_unit),0) from venda_item where venda_id = p_id));
  v_custo := coalesce(p_custo, (select coalesce(sum(quantidade*custo_unit_congelado),0) from venda_item where venda_id = p_id));
  v_receita := v_bruta - v.desconto;
  v_taxa := round(v_receita * v.perc_taxa / 100, 2);
  v_imp := round(v_receita * v.perc_imposto / 100, 2);
  v_lucro := v_receita - v_taxa - v.tarifa_fixa - v.frete - v_imp - v.outros_custos - round(v_custo,2);
  update venda set receita_bruta = v_bruta, receita = v_receita, valor_taxa = v_taxa, valor_imposto = v_imp,
                   custo_produtos = round(v_custo,2), lucro = v_lucro,
                   margem = case when v_receita > 0 then round(v_lucro / v_receita, 4) else 0 end
   where id = p_id;
end $$;

create or replace function registrar_venda(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := exigir_empresa(); v_id uuid; v_item jsonb; v_prod produto; v_custo numeric; v_qtd numeric;
  v_bruta numeric := 0; v_custo_total numeric := 0; k record;
begin
  if not is_membro() then raise exception 'Sem permissão'; end if;
  if jsonb_array_length(coalesce(p->'itens','[]'::jsonb)) = 0 then raise exception 'A venda precisa de pelo menos um item'; end if;

  insert into venda (empresa_id, data, canal_id, canal_taxa_id, pedido_externo, cliente_id, status,
                     desconto, perc_taxa, tarifa_fixa, frete, perc_imposto, outros_custos, forma_pagamento, conta_id, observacoes)
  values (v_emp, coalesce((p->>'data')::date, current_date),
          (p->>'canal_id')::uuid, nullif(p->>'canal_taxa_id','')::uuid,
          nullif(p->>'pedido_externo',''), nullif(p->>'cliente_id','')::uuid,
          coalesce(nullif(p->>'status',''),'aberta'),
          coalesce((p->>'desconto')::numeric,0), coalesce((p->>'perc_taxa')::numeric,0),
          coalesce((p->>'tarifa_fixa')::numeric,0), coalesce((p->>'frete')::numeric,0),
          coalesce((p->>'perc_imposto')::numeric, (select imposto_perc from empresa where id = v_emp)),
          coalesce((p->>'outros_custos')::numeric,0),
          nullif(p->>'forma_pagamento',''), nullif(p->>'conta_id','')::uuid, nullif(p->>'observacoes',''))
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p->'itens') loop
    v_qtd := coalesce((v_item->>'quantidade')::numeric, 0);
    if v_qtd <= 0 then raise exception 'Quantidade inválida'; end if;
    select * into v_prod from produto where id = (v_item->>'produto_id')::uuid and empresa_id = v_emp;
    if v_prod.id is null then raise exception 'Produto não encontrado'; end if;
    v_custo := custo_produto(v_prod.id);

    insert into venda_item (empresa_id, venda_id, produto_id, quantidade, preco_unit, custo_unit_congelado)
    values (v_emp, v_id, v_prod.id, v_qtd, (v_item->>'preco_unit')::numeric, v_custo);

    if v_prod.tipo = 'kit' then
      -- Kit: baixa cada produto que o compõe
      if not exists (select 1 from kit_item where kit_id = v_prod.id) then
        raise exception 'O kit "%" não tem produtos cadastrados', v_prod.nome;
      end if;
      for k in select ki.produto_id, ki.quantidade, case when c.custo_medio > 0 then c.custo_medio else c.custo_padrao end custo
                 from kit_item ki join produto c on c.id = ki.produto_id where ki.kit_id = v_prod.id loop
        insert into movimento_estoque (empresa_id, tipo, item_tipo, produto_id, quantidade, custo_unit, origem_tipo, origem_id, motivo)
        values (v_emp, 'venda', 'produto', k.produto_id, -(v_qtd * k.quantidade), k.custo, 'venda', v_id, 'Kit: ' || v_prod.nome);
      end loop;
    else
      insert into movimento_estoque (empresa_id, tipo, item_tipo, produto_id, quantidade, custo_unit, origem_tipo, origem_id)
      values (v_emp, 'venda', 'produto', v_prod.id, -v_qtd, v_custo, 'venda', v_id);
    end if;

    v_bruta := v_bruta + v_qtd * (v_item->>'preco_unit')::numeric;
    v_custo_total := v_custo_total + v_qtd * v_custo;
  end loop;

  perform recalcular_venda(v_id, v_bruta, v_custo_total);
  return v_id;
end $$;

-- Desfaz as saídas de estoque da venda (funciona para kits: estorna o que saiu de cada componente)
create or replace function estornar_estoque_venda(p_id uuid, p_tipo text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare r record; v_emp uuid := exigir_empresa();
begin
  for r in select produto_id, sum(-quantidade) qtd, max(custo_unit) custo from movimento_estoque
            where empresa_id = v_emp and origem_tipo = 'venda' and origem_id = p_id and tipo = 'venda'
            group by produto_id loop
    insert into movimento_estoque (empresa_id, tipo, item_tipo, produto_id, quantidade, custo_unit, origem_tipo, origem_id, motivo)
    values (v_emp, p_tipo, 'produto', r.produto_id, r.qtd, r.custo, 'venda', p_id, p_motivo);
  end loop;
end $$;

create or replace function cancelar_venda(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := exigir_empresa(); v_status text;
begin
  if not is_membro() then raise exception 'Sem permissão'; end if;
  if coalesce(p_motivo,'') = '' then raise exception 'Informe o motivo do cancelamento'; end if;
  select status into v_status from venda where id = p_id and empresa_id = v_emp for update;
  if v_status is null then raise exception 'Venda não encontrada'; end if;
  if v_status in ('cancelada','devolvida') then raise exception 'Venda já cancelada ou devolvida'; end if;
  perform estornar_estoque_venda(p_id, 'estorno_venda', p_motivo);
  update venda set status = 'cancelada', motivo_cancelamento = p_motivo where id = p_id;
end $$;

create or replace function devolver_venda(p_id uuid, p_destino text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := exigir_empresa(); v_status text;
begin
  if not is_membro() then raise exception 'Sem permissão'; end if;
  if p_destino not in ('estoque','perda') then raise exception 'Destino inválido'; end if;
  select status into v_status from venda where id = p_id and empresa_id = v_emp for update;
  if v_status is null then raise exception 'Venda não encontrada'; end if;
  if v_status in ('cancelada','devolvida') then raise exception 'Venda já cancelada ou devolvida'; end if;
  if p_destino = 'estoque' then perform estornar_estoque_venda(p_id, 'devolucao', p_motivo); end if;
  update venda set status = 'devolvida',
    motivo_cancelamento = trim(coalesce(p_motivo,'') || case when p_destino = 'estoque' then ' (voltou ao estoque)' else ' (perda)' end)
   where id = p_id;
end $$;

create or replace function mudar_status_venda(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_membro() then raise exception 'Sem permissão'; end if;
  if p_status not in ('aberta','enviada','entregue') then raise exception 'Use cancelar ou devolver para esse status'; end if;
  update venda set status = p_status where id = p_id and empresa_id = exigir_empresa() and status not in ('cancelada','devolvida');
end $$;

create or replace function atualizar_custos_venda(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_membro() then raise exception 'Sem permissão'; end if;
  update venda set
    data = coalesce((p->>'data')::date, data),
    pedido_externo = case when p ? 'pedido_externo' then nullif(p->>'pedido_externo','') else pedido_externo end,
    cliente_id = case when p ? 'cliente_id' then nullif(p->>'cliente_id','')::uuid else cliente_id end,
    conta_id = case when p ? 'conta_id' then nullif(p->>'conta_id','')::uuid else conta_id end,
    desconto = coalesce((p->>'desconto')::numeric, desconto),
    perc_taxa = coalesce((p->>'perc_taxa')::numeric, perc_taxa),
    tarifa_fixa = coalesce((p->>'tarifa_fixa')::numeric, tarifa_fixa),
    frete = coalesce((p->>'frete')::numeric, frete),
    perc_imposto = coalesce((p->>'perc_imposto')::numeric, perc_imposto),
    outros_custos = coalesce((p->>'outros_custos')::numeric, outros_custos),
    forma_pagamento = case when p ? 'forma_pagamento' then nullif(p->>'forma_pagamento','') else forma_pagamento end,
    observacoes = case when p ? 'observacoes' then nullif(p->>'observacoes','') else observacoes end
  where id = p_id and empresa_id = exigir_empresa() and status not in ('cancelada','devolvida');
  if not found then raise exception 'Venda cancelada ou devolvida não pode ser alterada'; end if;
  perform recalcular_venda(p_id);
end $$;

-- ---------- Compras ----------
create or replace function receber_compra(p_compra uuid) returns void
language plpgsql security definer set search_path = public as $$
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
  update compra set status = 'recebida' where id = p_compra;
end $$;

-- ---------- Produção ----------
create or replace function necessidade_producao(p_produto uuid, p_qtd numeric)
returns table(material_id uuid, nome text, unidade text, necessario numeric, saldo numeric, falta numeric)
language sql stable set search_path = public as $$
  select m.id, m.nome, m.unidade_uso,
         round(f.quantidade * (1 + f.perc_perda/100) * p_qtd, 3),
         m.saldo,
         greatest(round(f.quantidade * (1 + f.perc_perda/100) * p_qtd, 3) - m.saldo, 0)
  from ficha_tecnica_item f join material m on m.id = f.material_id
  where f.produto_id = p_produto
  order by m.nome
$$;

create or replace function capacidade_producao()
returns table(produto_id uuid, produto text, unidades numeric, material_limitante text)
language sql stable set search_path = public as $$
  select distinct on (p.id) p.id, p.nome, floor(m.saldo / (f.quantidade * (1 + f.perc_perda/100))), m.nome
  from produto p
  join ficha_tecnica_item f on f.produto_id = p.id
  join material m on m.id = f.material_id
  where p.ativo
  order by p.id, floor(m.saldo / (f.quantidade * (1 + f.perc_perda/100))) asc
$$;

create or replace function concluir_producao(p_ordem uuid, p_consumo jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare o ordem_producao; r record; v_real numeric; v_custo_total numeric := 0; v_cm numeric; v_emp uuid := exigir_empresa();
begin
  if not is_membro() then raise exception 'Sem permissão'; end if;
  select * into o from ordem_producao where id = p_ordem and empresa_id = v_emp for update;
  if o.id is null then raise exception 'Ordem não encontrada'; end if;
  if o.status in ('concluida','cancelada') then raise exception 'Ordem já concluída ou cancelada'; end if;
  if not exists (select 1 from ficha_tecnica_item where produto_id = o.produto_id) then
    raise exception 'O produto não tem ficha técnica. Cadastre os insumos dele antes de produzir.';
  end if;

  for r in select * from necessidade_producao(o.produto_id, o.quantidade) loop
    v_real := coalesce((select (e->>'qtd_real')::numeric from jsonb_array_elements(coalesce(p_consumo,'[]'::jsonb)) e
                         where (e->>'material_id')::uuid = r.material_id limit 1), r.necessario);
    select custo_medio into v_cm from material where id = r.material_id;
    insert into ordem_producao_consumo (empresa_id, ordem_id, material_id, qtd_prevista, qtd_real, custo_unit)
    values (v_emp, p_ordem, r.material_id, r.necessario, v_real, v_cm);
    if v_real > 0 then
      insert into movimento_estoque (empresa_id, tipo, item_tipo, material_id, quantidade, custo_unit, origem_tipo, origem_id)
      values (v_emp, 'consumo_producao', 'material', r.material_id, -v_real, v_cm, 'ordem_producao', p_ordem);
    end if;
    v_custo_total := v_custo_total + v_real * v_cm;
  end loop;
  v_custo_total := v_custo_total + o.quantidade * (select custos_fixos_unit from produto where id = o.produto_id);

  insert into movimento_estoque (empresa_id, tipo, item_tipo, produto_id, quantidade, custo_unit, origem_tipo, origem_id)
  values (v_emp, 'entrada_producao', 'produto', o.produto_id, o.quantidade, round(v_custo_total / o.quantidade, 4), 'ordem_producao', p_ordem);
  update ordem_producao set status = 'concluida', data_conclusao = now(), custo_total_real = round(v_custo_total,2) where id = p_ordem;
  update produto set custo_padrao = round(custo_ficha(o.produto_id),4) where id = o.produto_id;
end $$;

create or replace function usar_custo_ficha(p_id uuid, p_corrigir_vendas boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_custo numeric; v_vendas int := 0; r record; v_emp uuid := exigir_empresa();
begin
  if not is_membro() then raise exception 'Sem permissão'; end if;
  if not exists (select 1 from produto where id = p_id and empresa_id = v_emp) then raise exception 'Produto não encontrado'; end if;
  if not exists (select 1 from ficha_tecnica_item where produto_id = p_id) then raise exception 'Este produto não tem ficha técnica'; end if;
  v_custo := round(custo_ficha(p_id), 4);
  if v_custo <= 0 then raise exception 'O custo da ficha está zerado: confira o custo dos insumos'; end if;
  update produto set custo_padrao = v_custo, custo_medio = v_custo where id = p_id;
  if p_corrigir_vendas then
    for r in select distinct vi.venda_id from venda_item vi join venda v on v.id = vi.venda_id
              where vi.produto_id = p_id and v.empresa_id = v_emp and v.status not in ('cancelada','devolvida') loop
      update venda_item set custo_unit_congelado = v_custo where venda_id = r.venda_id and produto_id = p_id;
      perform recalcular_venda(r.venda_id);
      v_vendas := v_vendas + 1;
    end loop;
  end if;
  return jsonb_build_object('custo', v_custo, 'vendas', v_vendas);
end $$;

-- ---------- Inventário ----------
create or replace function abrir_inventario(p_item_tipo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_emp uuid := exigir_empresa();
begin
  if not is_membro() then raise exception 'Sem permissão'; end if;
  insert into inventario (empresa_id, item_tipo) values (v_emp, p_item_tipo) returning id into v_id;
  if p_item_tipo = 'material' then
    insert into inventario_item (empresa_id, inventario_id, material_id, saldo_sistema)
    select v_emp, v_id, id, saldo from material where empresa_id = v_emp and ativo order by nome;
  else
    insert into inventario_item (empresa_id, inventario_id, produto_id, saldo_sistema)
    select v_emp, v_id, id, saldo from produto where empresa_id = v_emp and ativo and tipo <> 'kit' order by nome;
  end if;
  return v_id;
end $$;

create or replace function concluir_inventario(p_inv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i inventario; r record; v_atual numeric; v_dif numeric; v_emp uuid := exigir_empresa();
begin
  if not is_membro() then raise exception 'Sem permissão'; end if;
  select * into i from inventario where id = p_inv and empresa_id = v_emp for update;
  if i.id is null then raise exception 'Inventário não encontrado'; end if;
  if i.status <> 'aberto' then raise exception 'Inventário não está aberto'; end if;
  for r in select * from inventario_item where inventario_id = p_inv and saldo_contado is not null loop
    if i.item_tipo = 'material' then select saldo into v_atual from material where id = r.material_id;
    else select saldo into v_atual from produto where id = r.produto_id; end if;
    v_dif := r.saldo_contado - v_atual;
    if v_dif <> 0 then
      insert into movimento_estoque (empresa_id, tipo, item_tipo, material_id, produto_id, quantidade, origem_tipo, origem_id, motivo)
      values (v_emp, 'ajuste', i.item_tipo, r.material_id, r.produto_id, v_dif, 'inventario', p_inv, 'Contagem de inventário');
    end if;
  end loop;
  update inventario set status = 'concluido' where id = p_inv;
end $$;

-- ---------- Views (security_invoker: o RLS filtra pela empresa) ----------
create view vw_produto_estoque with (security_invoker = true) as
select p.*,
  case when p.tipo = 'kit' then coalesce((select min(floor(c.saldo / k.quantidade)) from kit_item k join produto c on c.id = k.produto_id where k.kit_id = p.id), 0)
       else p.saldo end as saldo_disponivel,
  round(p.saldo * p.custo_medio, 2) as valor_estoque,
  (select coalesce(sum(vi.quantidade), 0) from venda_item vi join venda v on v.id = vi.venda_id
    where vi.produto_id = p.id and v.status not in ('cancelada','devolvida') and v.data >= current_date - 30) as vendidos_30d,
  case when p.tipo = 'kit' then 'ok'
       when p.saldo <= 0 then 'zerado' when p.saldo <= p.estoque_minimo then 'baixo' else 'ok' end as situacao,
  -- Custo unitário usado na venda (kit = soma dos componentes)
  case when p.tipo = 'kit' then
         coalesce((select sum(k.quantidade * case when c.custo_medio > 0 then c.custo_medio else c.custo_padrao end)
                     from kit_item k join produto c on c.id = k.produto_id where k.kit_id = p.id), 0) + p.custos_fixos_unit
       else case when p.custo_medio > 0 then p.custo_medio else p.custo_padrao end end as custo_atual
from produto p;

create view vw_material_estoque with (security_invoker = true) as
select m.*, round(m.saldo * m.custo_medio, 2) as valor_estoque,
  (select coalesce(-sum(me.quantidade), 0) / 30.0 from movimento_estoque me
    where me.material_id = m.id and me.tipo = 'consumo_producao' and me.data >= now() - interval '30 days') as consumo_diario,
  case when m.saldo <= 0 then 'zerado' when m.saldo <= m.estoque_minimo then 'baixo' else 'ok' end as situacao
from material m;

create view vw_canal_taxa_vigente with (security_invoker = true) as
select distinct on (ct.canal_id, ct.perfil) ct.*, c.nome as canal_nome, c.tipo as canal_tipo
from canal_taxa ct join canal c on c.id = ct.canal_id
where ct.ativo and c.ativo and ct.vigente_desde <= current_date
order by ct.canal_id, ct.perfil, ct.vigente_desde desc, ct.created_at desc;

-- ---------- Painel ----------
create or replace function dashboard(p_inicio date, p_fim date, p_canal uuid default null) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_ant_ini date := p_inicio - ((p_fim - p_inicio) + 1);
  v_ant_fim date := p_inicio - 1;
  v_dias int := coalesce((select dias_alerta_venda_aberta from empresa where id = empresa_atual()), 5);
  res jsonb;
begin
  if not is_leitor() then raise exception 'Sem permissão'; end if;
  with v as (select * from venda where status not in ('cancelada','devolvida') and (p_canal is null or canal_id = p_canal)),
  periodo as (
    select count(*) vendas, coalesce(sum(receita),0) faturamento, coalesce(sum(lucro),0) lucro,
           coalesce(sum(custo_produtos),0) custo, coalesce(sum(valor_taxa + tarifa_fixa),0) taxas,
           coalesce(sum(frete),0) frete, coalesce(sum(valor_imposto),0) impostos, coalesce(sum(outros_custos),0) outros,
           count(*) filter (where lucro < 0) vendas_prejuizo,
           (select coalesce(sum(vi.quantidade),0) from venda_item vi join v v2 on v2.id = vi.venda_id where v2.data between p_inicio and p_fim) unidades
    from v where data between p_inicio and p_fim),
  anterior as (select count(*) vendas, coalesce(sum(receita),0) faturamento, coalesce(sum(lucro),0) lucro from v where data between v_ant_ini and v_ant_fim),
  por_dia as (
    select d::date dia, coalesce(sum(v.receita),0) faturamento, coalesce(sum(v.lucro),0) lucro, count(v.id) vendas
    from generate_series(p_inicio::timestamp, p_fim::timestamp, interval '1 day') d left join v on v.data = d::date
    group by d order by d),
  itens as (
    select vi.produto_id, vi.quantidade,
           v.receita * (vi.quantidade*vi.preco_unit) / nullif(v.receita_bruta,0) receita_item,
           v.lucro * (vi.quantidade*vi.preco_unit) / nullif(v.receita_bruta,0) lucro_item
    from venda_item vi join v on v.id = vi.venda_id where v.data between p_inicio and p_fim),
  por_produto as (
    select p.id, p.nome, sum(i.quantidade) unidades, round(sum(i.receita_item),2) faturamento, round(sum(i.lucro_item),2) lucro,
           case when sum(i.receita_item) > 0 then round(sum(i.lucro_item)/sum(i.receita_item),4) else 0 end margem,
           round(sum(i.lucro_item)/nullif(sum(i.quantidade),0),2) lucro_unit
    from itens i join produto p on p.id = i.produto_id group by p.id, p.nome order by sum(i.quantidade) desc, sum(i.lucro_item) desc),
  por_canal as (
    select c.nome, count(*) vendas, sum(v.receita) faturamento, sum(v.lucro) lucro,
           case when sum(v.receita) > 0 then round(sum(v.lucro)/sum(v.receita),4) else 0 end margem
    from v join canal c on c.id = v.canal_id where v.data between p_inicio and p_fim group by c.nome order by sum(v.receita) desc)
  select jsonb_build_object(
    'periodo', (select to_jsonb(periodo) from periodo),
    'anterior', (select to_jsonb(anterior) from anterior),
    'por_dia', (select coalesce(jsonb_agg(to_jsonb(por_dia)),'[]') from por_dia),
    'por_produto', (select coalesce(jsonb_agg(to_jsonb(por_produto)),'[]') from por_produto),
    'por_canal', (select coalesce(jsonb_agg(to_jsonb(por_canal)),'[]') from por_canal),
    'despesas', (select coalesce(sum(valor),0) from despesa where data between p_inicio and p_fim),
    'alertas', jsonb_build_object(
      'produtos_baixo', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'nome',nome,'saldo',saldo,'minimo',estoque_minimo) order by saldo),'[]')
                          from produto where ativo and tipo <> 'kit' and saldo <= estoque_minimo),
      'materiais_baixo', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'nome',nome,'saldo',saldo,'minimo',estoque_minimo,'unidade',unidade_uso) order by saldo),'[]')
                           from material where ativo and saldo <= estoque_minimo and estoque_minimo > 0),
      'vendas_abertas_antigas', (select count(*) from venda where status = 'aberta' and data < current_date - v_dias)),
    'estoque_valor', jsonb_build_object(
      'produtos', (select coalesce(sum(saldo*custo_medio),0) from produto where saldo > 0),
      'materiais', (select coalesce(sum(saldo*custo_medio),0) from material where saldo > 0))
  ) into res;
  return res;
end $$;

-- ---------- Finanças ----------
create or replace function venda_liquido(v venda) returns numeric language sql stable as $$
  select coalesce(case when v.ml_order_id is not null then v.ml_liquido end,
                  v.receita - v.valor_taxa - v.tarifa_fixa - v.frete - v.outros_custos)
$$;

create view vw_extrato with (security_invoker = true) as
with padrao as (select id from conta_financeira where padrao and empresa_id = empresa_atual() limit 1),
     contaml as (select coalesce((select id from conta_financeira where recebe_ml and empresa_id = empresa_atual() limit 1), (select id from padrao)) id),
     mov as (
  select m.conta_id, m.data, m.valor, m.descricao, case when m.transferencia is null then 'manual' else 'transferencia' end origem, m.id ref_id
    from movimento_financeiro m
  union all
  select coalesce(d.conta_id, (select id from padrao)), d.data, -d.valor, d.descricao, 'despesa', d.id from despesa d
  union all
  select coalesce(c.conta_id, (select id from padrao)), c.data,
         -(coalesce((select sum(i.qtd_compra * i.preco_unit_compra) from compra_item i where i.compra_id = c.id), 0) + c.frete + c.outras_despesas - c.desconto),
         'Compra #' || c.numero || coalesce(' · ' || f.nome, ''), 'compra', c.id
    from compra c left join fornecedor f on f.id = c.fornecedor_id
   where c.status in ('recebida','parcial')
  union all
  select coalesce(v.conta_id, (select id from padrao)), v.data, venda_liquido(v), 'Venda #' || v.numero || coalesce(' · ' || cn.nome, ''), 'venda', v.id
    from venda v left join canal cn on cn.id = v.canal_id
   where v.ml_order_id is null and v.status not in ('cancelada','devolvida')
  union all
  select (select id from contaml), (v.ml_liberacao_em at time zone 'America/Sao_Paulo')::date, venda_liquido(v), 'Liberado pelo ML · venda #' || v.numero, 'ml', v.id
    from venda v
   where v.ml_order_id is not null and v.status not in ('cancelada','devolvida')
     and v.ml_liberacao_em is not null and (v.ml_liberado or v.ml_liberacao_em <= now())
  union all
  select (select id from contaml), (r.liberacao_em at time zone 'America/Sao_Paulo')::date, r.valor, 'Liberado pelo ML · ' || r.descricao, 'ml_antigo', r.id
    from ml_recebivel r
   where r.liberacao_em is not null and (r.liberado or r.liberacao_em <= now())
     and not exists (select 1 from venda v where v.ml_order_id = r.ml_order_id and v.empresa_id = r.empresa_id)
)
select mov.*, c.nome conta_nome from mov join conta_financeira c on c.id = mov.conta_id where mov.data > c.saldo_em;

create view vw_conta_saldo with (security_invoker = true) as
select c.*, c.saldo_inicial + coalesce((select sum(e.valor) from vw_extrato e where e.conta_id = c.id), 0) saldo from conta_financeira c;

create view vw_ml_a_receber with (security_invoker = true) as
select v.id, v.numero, v.data, v.pedido_externo, v.receita, venda_liquido(v) liquido, v.ml_liquido is null estimado,
       v.ml_liberacao_em, v.status, false avulso, v.ml_order_id, null::text descricao
  from venda v
 where v.ml_order_id is not null and v.status not in ('cancelada','devolvida')
   and not v.ml_liberado and (v.ml_liberacao_em is null or v.ml_liberacao_em > now())
union all
select r.id, null, r.data, r.ml_order_id::text, r.valor, r.valor::numeric, false, r.liberacao_em, 'antiga', true, r.ml_order_id, r.descricao
  from ml_recebivel r
 where not r.liberado and (r.liberacao_em is null or r.liberacao_em > now())
   and not exists (select 1 from venda v where v.ml_order_id = r.ml_order_id and v.empresa_id = r.empresa_id);

-- ---------- Empresa: criar, convidar, entrar, termos ----------
create or replace function criar_empresa(p_nome text, p_tipo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_canal uuid; v_ml uuid;
begin
  if auth.uid() is null then raise exception 'Faça login'; end if;
  if coalesce(trim(p_nome),'') = '' then raise exception 'Dê um nome à empresa'; end if;
  if p_tipo not in ('revenda','fabricacao','misto') then raise exception 'Tipo de negócio inválido'; end if;
  insert into empresa (nome, tipo_negocio, modulos, email_avisos)
  values (trim(p_nome), p_tipo,
          jsonb_build_object('compras', true, 'financas', true, 'mercado_livre', true, 'clientes', true,
                             'fornecedores', true, 'kits', true, 'producao', p_tipo <> 'revenda'),
          (select email from usuario where id = auth.uid()))
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

create or replace function trocar_empresa(p_empresa uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from membro where empresa_id = p_empresa and user_id = auth.uid()) then
    raise exception 'Você não faz parte desta empresa'; end if;
  update usuario set empresa_atual = p_empresa where id = auth.uid();
end $$;

create or replace function criar_convite(p_papel text, p_email text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if not is_admin() then raise exception 'Só o dono pode convidar'; end if;
  if p_papel not in ('dono','operador','leitura') then raise exception 'Papel inválido'; end if;
  insert into convite (empresa_id, papel, email) values (exigir_empresa(), p_papel, nullif(trim(lower(p_email)),'')) returning token into v_token;
  return v_token;
end $$;

-- Mostra para quem recebeu o link de qual empresa é o convite (sem expor mais nada)
create or replace function ver_convite(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('empresa', e.nome, 'papel', c.papel, 'valido', c.aceito_em is null and c.expira_em > now())
  from convite c join empresa e on e.id = c.empresa_id where c.token = p_token
$$;

create or replace function aceitar_convite(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c convite;
begin
  if auth.uid() is null then raise exception 'Faça login'; end if;
  select * into c from convite where token = p_token for update;
  if c.id is null then raise exception 'Convite não encontrado'; end if;
  if c.aceito_em is not null then raise exception 'Este convite já foi usado'; end if;
  if c.expira_em < now() then raise exception 'Este convite venceu. Peça um novo.'; end if;
  insert into membro (empresa_id, user_id, papel) values (c.empresa_id, auth.uid(), c.papel)
    on conflict (empresa_id, user_id) do nothing;
  update convite set aceito_em = now(), aceito_por = auth.uid() where id = c.id;
  update usuario set empresa_atual = c.empresa_id where id = auth.uid();
  return c.empresa_id;
end $$;

create or replace function aceitar_termos(p_versao text) returns void
language sql security definer set search_path = public as $$
  update usuario set termos_versao = p_versao, termos_aceitos_em = now() where id = auth.uid()
$$;

-- Membros da empresa atual com e-mail (para a tela de usuários)
create or replace function membros_empresa() returns table(user_id uuid, nome text, email text, papel text, desde timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.nome, u.email, m.papel, m.created_at
  from membro m join usuario u on u.id = m.user_id
  where m.empresa_id = empresa_atual() and is_leitor()
  order by m.created_at
$$;

-- Não deixar a empresa sem dono
create or replace function tg_membro_ultimo_dono() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.papel = 'dono' and (tg_op = 'DELETE' or new.papel <> 'dono')
     and not exists (select 1 from membro where empresa_id = old.empresa_id and papel = 'dono' and user_id <> old.user_id) then
    raise exception 'A empresa precisa de pelo menos um dono';
  end if;
  return coalesce(new, old);
end $$;
create trigger membro_ultimo_dono before update or delete on membro for each row execute function tg_membro_ultimo_dono();
