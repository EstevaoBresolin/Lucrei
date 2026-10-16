-- =====================================================================
-- Migração única: Patevão Gestão -> Lucrei (empresa "Patevão Store")
-- Lê o JSON exportado do Patevão guardado em public._migracao (id = 1).
-- Idempotente: rodar de novo só acrescenta o que é novo e atualiza status.
-- =====================================================================
create or replace function public._migrar_patevao(p_dry boolean) returns text
language plpgsql set search_path = public as $mig$
declare
  E uuid := '2eefa944-189f-4ac0-881f-e8db548c8f5f';   -- Patevão Store
  U uuid := '966b0c62-f3ba-404f-8aee-376fce754e0a';   -- Estevão
  d jsonb;
  t text;
  g record;
  v_kit uuid;
  v_cat uuid;
  tabelas text[] := array['categoria','fornecedor','cliente','material','produto','ficha_tecnica_item','kit_item','canal','canal_taxa',
    'preco_canal','conta_financeira','movimento_financeiro','despesa','compra','compra_item','ordem_producao','ordem_producao_consumo',
    'venda','venda_item','movimento_estoque','inventario','inventario_item','ml_anuncio','ml_pendente','ml_recebivel'];
begin
  select dados into strict d from _migracao where id = 1;

  foreach t in array tabelas loop
    execute format('alter table %I disable trigger user', t);
  end loop;

  create temp table _mapa (antigo uuid primary key, novo uuid not null) on commit drop;

  -- ---------- Categorias (reaproveita as que já existem com mesmo nome/tipo) ----------
  insert into _mapa
  select p.id, c.id from jsonb_populate_recordset(null::categoria, d->'categoria') p
  join categoria c on c.empresa_id = E and lower(c.nome) = lower(p.nome) and c.tipo = p.tipo and c.id <> p.id;
  insert into categoria (id, empresa_id, nome, tipo, created_at)
  select p.id, E, p.nome, p.tipo, p.created_at from jsonb_populate_recordset(null::categoria, d->'categoria') p
  where not exists (select 1 from _mapa m where m.antigo = p.id)
  on conflict (id) do nothing;

  -- ---------- Canais e taxas (reaproveita os criados junto com a empresa) ----------
  insert into _mapa
  select p.id, c.id from jsonb_populate_recordset(null::canal, d->'canal') p
  join canal c on c.empresa_id = E and lower(c.nome) = lower(p.nome) and c.id <> p.id;
  insert into canal (id, empresa_id, nome, tipo, ativo, created_at)
  select p.id, E, p.nome, p.tipo, p.ativo, p.created_at from jsonb_populate_recordset(null::canal, d->'canal') p
  where not exists (select 1 from _mapa m where m.antigo = p.id)
  on conflict (id) do nothing;

  insert into _mapa
  select p.id, c.id from jsonb_populate_recordset(null::canal_taxa, d->'canal_taxa') p
  join canal_taxa c on c.empresa_id = E and c.canal_id = coalesce((select novo from _mapa where antigo = p.canal_id), p.canal_id)
                   and lower(c.perfil) = lower(p.perfil) and c.id <> p.id;
  update canal_taxa c set perc_taxa = p.perc_taxa, tarifa_fixa = p.tarifa_fixa, tarifa_ate_preco = p.tarifa_ate_preco,
         frete_padrao = p.frete_padrao, vigente_desde = p.vigente_desde, ativo = p.ativo
  from jsonb_populate_recordset(null::canal_taxa, d->'canal_taxa') p join _mapa m on m.antigo = p.id
  where c.id = m.novo;
  insert into canal_taxa (id, empresa_id, canal_id, perfil, perc_taxa, tarifa_fixa, tarifa_ate_preco, frete_padrao, vigente_desde, ativo, created_at)
  select p.id, E, coalesce((select novo from _mapa where antigo = p.canal_id), p.canal_id), p.perfil, p.perc_taxa, p.tarifa_fixa,
         p.tarifa_ate_preco, p.frete_padrao, p.vigente_desde, p.ativo, p.created_at
  from jsonb_populate_recordset(null::canal_taxa, d->'canal_taxa') p
  where not exists (select 1 from _mapa m where m.antigo = p.id)
  on conflict (id) do nothing;

  -- ---------- Cadastros ----------
  insert into fornecedor (id, empresa_id, nome, documento, telefone, whatsapp, email, prazo_entrega_dias, observacoes, ativo, created_at, updated_at)
  select p.id, E, p.nome, p.documento, p.telefone, p.whatsapp, p.email, p.prazo_entrega_dias, p.observacoes, p.ativo, p.created_at, p.updated_at
  from jsonb_populate_recordset(null::fornecedor, d->'fornecedor') p on conflict (id) do nothing;

  insert into cliente (id, empresa_id, nome, telefone, whatsapp, cidade, origem, observacoes, created_at)
  select p.id, E, p.nome, p.telefone, p.whatsapp, p.cidade, p.origem, p.observacoes, p.created_at
  from jsonb_populate_recordset(null::cliente, d->'cliente') p on conflict (id) do nothing;

  insert into material (id, empresa_id, sku, nome, categoria_id, unidade_uso, unidade_compra, fator_conversao, fornecedor_padrao_id,
                        estoque_minimo, ponto_reposicao, saldo, custo_medio, ultimo_custo, localizacao, foto_url, observacoes, ativo, created_at, updated_at)
  select p.id, E, p.sku, p.nome, coalesce((select novo from _mapa where antigo = p.categoria_id), p.categoria_id), p.unidade_uso, p.unidade_compra,
         p.fator_conversao, p.fornecedor_padrao_id, p.estoque_minimo, p.ponto_reposicao, p.saldo, p.custo_medio, p.ultimo_custo,
         p.localizacao, p.foto_url, p.observacoes, p.ativo, p.created_at, p.updated_at
  from jsonb_populate_recordset(null::material, d->'material') p
  on conflict (id) do update set saldo = excluded.saldo, custo_medio = excluded.custo_medio, ultimo_custo = excluded.ultimo_custo;

  -- Produto: no Patevão todos eram "simples"; quem tem ficha técnica vira "fabricado", o resto "revenda"
  insert into produto (id, empresa_id, sku, nome, tipo, categoria_id, atributos, custo_padrao, custo_medio, custos_fixos_unit,
                       estoque_minimo, saldo, foto_url, observacoes, ativo, created_at, updated_at)
  select p.id, E, p.sku, p.nome,
         case when p.tipo = 'kit' then 'kit'
              when exists (select 1 from jsonb_array_elements(d->'ficha_tecnica_item') f where (f->>'produto_id')::uuid = p.id) then 'fabricado'
              else 'revenda' end,
         coalesce((select novo from _mapa where antigo = p.categoria_id), p.categoria_id), coalesce(p.atributos, '{}'),
         p.custo_padrao, p.custo_medio, p.custos_fixos_unit, p.estoque_minimo, p.saldo, p.foto_url, p.observacoes, p.ativo, p.created_at, p.updated_at
  from jsonb_populate_recordset(null::produto, d->'produto') p
  on conflict (id) do update set saldo = excluded.saldo, custo_medio = excluded.custo_medio;

  insert into ficha_tecnica_item (id, empresa_id, produto_id, material_id, quantidade, perc_perda)
  select (f->>'id')::uuid, E, (f->>'produto_id')::uuid, (f->>'material_id')::uuid, (f->>'quantidade')::numeric, coalesce((f->>'perc_perda')::numeric, 0)
  from jsonb_array_elements(d->'ficha_tecnica_item') f where f->>'material_id' is not null
  on conflict (id) do nothing;

  insert into preco_canal (empresa_id, produto_id, canal_id, preco_venda)
  select E, p.produto_id, coalesce((select novo from _mapa where antigo = p.canal_id), p.canal_id), p.preco_venda
  from jsonb_populate_recordset(null::preco_canal, d->'preco_canal') p
  on conflict (produto_id, canal_id) do update set preco_venda = excluded.preco_venda;

  -- ---------- Anúncios do ML ----------
  -- 1) campo anuncio_ml do produto
  insert into ml_anuncio (empresa_id, anuncio, produto_id, quantidade)
  select E, 'MLB' || regexp_replace(p->>'anuncio_ml', '\D', '', 'g'), (p->>'id')::uuid, 1
  from jsonb_array_elements(d->'produto') p where coalesce(regexp_replace(p->>'anuncio_ml', '\D', '', 'g'), '') <> ''
  on conflict (empresa_id, anuncio, (coalesce(variacao, 0))) do nothing;

  -- 2) anúncios ligados a vários produtos no Patevão: 1 produto -> liga direto; vários -> vira um produto tipo kit
  select c.id into v_cat from categoria c where c.empresa_id = E and c.tipo = 'produto'
   and c.id in (select coalesce((select novo from _mapa where antigo = (p->>'categoria_id')::uuid), (p->>'categoria_id')::uuid) from jsonb_array_elements(d->'produto') p)
   limit 1;
  for g in
    select upper(a->>'anuncio') anuncio, nullif(a->>'variacao','')::bigint variacao, max(a->>'titulo') titulo,
           jsonb_agg(jsonb_build_object('produto_id', a->>'produto_id', 'quantidade', a->>'quantidade')) itens
    from jsonb_array_elements(d->'ml_anuncio_item') a group by 1, 2
  loop
    if exists (select 1 from ml_anuncio where empresa_id = E and anuncio = g.anuncio and coalesce(variacao,0) = coalesce(g.variacao,0)) then
      continue;
    end if;
    if jsonb_array_length(g.itens) = 1 then
      insert into ml_anuncio (empresa_id, anuncio, variacao, titulo, produto_id, quantidade)
      values (E, g.anuncio, g.variacao, g.titulo, (g.itens->0->>'produto_id')::uuid, (g.itens->0->>'quantidade')::numeric);
    else
      insert into produto (empresa_id, nome, tipo, categoria_id, custo_padrao, custos_fixos_unit)
      values (E, left(coalesce(g.titulo, 'Kit ' || g.anuncio), 200), 'kit', v_cat, 0, 0) returning id into v_kit;
      insert into kit_item (empresa_id, kit_id, produto_id, quantidade)
      select E, v_kit, (i->>'produto_id')::uuid, (i->>'quantidade')::numeric from jsonb_array_elements(g.itens) i;
      insert into ml_anuncio (empresa_id, anuncio, variacao, titulo, produto_id, quantidade)
      values (E, g.anuncio, g.variacao, g.titulo, v_kit, 1);
    end if;
  end loop;

  -- ---------- Finanças ----------
  insert into conta_financeira (id, empresa_id, nome, saldo_inicial, saldo_em, padrao, recebe_ml, ativo, created_at)
  select p.id, E, p.nome, p.saldo_inicial, p.saldo_em, p.padrao, p.recebe_ml, p.ativo, p.created_at
  from jsonb_populate_recordset(null::conta_financeira, d->'conta_financeira') p
  on conflict (id) do update set saldo_inicial = excluded.saldo_inicial, saldo_em = excluded.saldo_em;

  insert into movimento_financeiro (id, empresa_id, conta_id, data, valor, descricao, transferencia, created_by, created_at)
  select p.id, E, p.conta_id, p.data, p.valor, p.descricao, p.transferencia, U, p.created_at
  from jsonb_populate_recordset(null::movimento_financeiro, d->'movimento_financeiro') p on conflict (id) do nothing;

  insert into despesa (id, empresa_id, data, categoria_id, descricao, valor, recorrente, forma_pagamento, conta_id, anexo_url, created_by, created_at)
  select p.id, E, p.data, coalesce((select novo from _mapa where antigo = p.categoria_id), p.categoria_id), p.descricao, p.valor, p.recorrente,
         p.forma_pagamento, p.conta_id, p.anexo_url, U, p.created_at
  from jsonb_populate_recordset(null::despesa, d->'despesa') p on conflict (id) do nothing;

  insert into ml_recebivel (id, empresa_id, ml_order_id, data, descricao, valor, liberacao_em, liberado, criado_em)
  select p.id, E, p.ml_order_id, p.data, p.descricao, p.valor, p.liberacao_em, p.liberado, p.criado_em
  from jsonb_populate_recordset(null::ml_recebivel, d->'ml_recebivel') p
  on conflict (id) do update set liberado = excluded.liberado, liberacao_em = excluded.liberacao_em;

  -- ---------- Compras e produção ----------
  insert into compra (id, empresa_id, numero, fornecedor_id, data, status, frete, outras_despesas, desconto, criterio_rateio, forma_pagamento,
                      conta_id, nf_numero, nf_anexo_url, observacoes, created_by, created_at)
  select p.id, E, p.numero, p.fornecedor_id, p.data, p.status, p.frete, p.outras_despesas, p.desconto, p.criterio_rateio, p.forma_pagamento,
         p.conta_id, p.nf_numero, p.nf_anexo_url, p.observacoes, U, p.created_at
  from jsonb_populate_recordset(null::compra, d->'compra') p on conflict (id) do update set status = excluded.status;

  insert into compra_item (id, empresa_id, compra_id, item_tipo, material_id, qtd_compra, preco_unit_compra, qtd_recebida, custo_unit_final)
  select (c->>'id')::uuid, E, (c->>'compra_id')::uuid, 'material', (c->>'material_id')::uuid, (c->>'qtd_compra')::numeric,
         (c->>'preco_unit_compra')::numeric, (c->>'qtd_recebida')::numeric, (c->>'custo_unit_final')::numeric
  from jsonb_array_elements(d->'compra_item') c on conflict (id) do nothing;

  insert into ordem_producao (id, empresa_id, numero, produto_id, quantidade, status, data_planejada, data_conclusao, custo_total_real, observacoes, created_by, created_at)
  select p.id, E, p.numero, p.produto_id, p.quantidade, p.status, p.data_planejada, p.data_conclusao, p.custo_total_real, p.observacoes, U, p.created_at
  from jsonb_populate_recordset(null::ordem_producao, d->'ordem_producao') p
  on conflict (id) do update set status = excluded.status, data_conclusao = excluded.data_conclusao, custo_total_real = excluded.custo_total_real;

  insert into ordem_producao_consumo (id, empresa_id, ordem_id, material_id, qtd_prevista, qtd_real, custo_unit)
  select p.id, E, p.ordem_id, p.material_id, p.qtd_prevista, p.qtd_real, p.custo_unit
  from jsonb_populate_recordset(null::ordem_producao_consumo, d->'ordem_producao_consumo') p
  on conflict (id) do update set qtd_real = excluded.qtd_real, custo_unit = excluded.custo_unit;

  -- ---------- Vendas ----------
  insert into venda (id, empresa_id, numero, data, canal_id, canal_taxa_id, pedido_externo, cliente_id, status, receita_bruta, desconto, receita,
                     perc_taxa, valor_taxa, tarifa_fixa, frete, perc_imposto, valor_imposto, outros_custos, custo_produtos, lucro, margem,
                     forma_pagamento, conta_id, observacoes, motivo_cancelamento, ml_order_id, ml_shipment_id, ml_liquido, ml_liberacao_em,
                     ml_liberado, created_by, created_at, updated_at)
  select p.id, E, p.numero, p.data, coalesce((select novo from _mapa where antigo = p.canal_id), p.canal_id),
         coalesce((select novo from _mapa where antigo = p.canal_taxa_id), p.canal_taxa_id), p.pedido_externo, p.cliente_id, p.status,
         p.receita_bruta, p.desconto, p.receita, p.perc_taxa, p.valor_taxa, p.tarifa_fixa, p.frete, p.perc_imposto, p.valor_imposto,
         p.outros_custos, p.custo_produtos, p.lucro, p.margem, p.forma_pagamento, p.conta_id, p.observacoes, p.motivo_cancelamento,
         p.ml_order_id, p.ml_shipment_id, p.ml_liquido, p.ml_liberacao_em, p.ml_liberado, U, p.created_at, p.updated_at
  from jsonb_populate_recordset(null::venda, d->'venda') p
  on conflict (id) do update set status = excluded.status, motivo_cancelamento = excluded.motivo_cancelamento, ml_liquido = excluded.ml_liquido,
     ml_liberacao_em = excluded.ml_liberacao_em, ml_liberado = excluded.ml_liberado, custo_produtos = excluded.custo_produtos,
     lucro = excluded.lucro, margem = excluded.margem, updated_at = excluded.updated_at;

  insert into venda_item (id, empresa_id, venda_id, produto_id, quantidade, preco_unit, custo_unit_congelado)
  select p.id, E, p.venda_id, p.produto_id, p.quantidade, p.preco_unit, p.custo_unit_congelado
  from jsonb_populate_recordset(null::venda_item, d->'venda_item') p
  on conflict (id) do update set custo_unit_congelado = excluded.custo_unit_congelado;

  -- ---------- Estoque (histórico; saldos já vieram prontos nos produtos/insumos) ----------
  insert into movimento_estoque (id, empresa_id, data, tipo, item_tipo, material_id, produto_id, quantidade, custo_unit, saldo_apos,
                                 origem_tipo, origem_id, motivo, usuario_id)
  select p.id, E, p.data, p.tipo, p.item_tipo, p.material_id, p.produto_id, p.quantidade, p.custo_unit, p.saldo_apos,
         p.origem_tipo, p.origem_id, p.motivo, U
  from jsonb_populate_recordset(null::movimento_estoque, d->'movimento_estoque') p on conflict (id) do nothing;

  insert into inventario (id, empresa_id, data, item_tipo, status, observacoes, created_by)
  select p.id, E, p.data, p.item_tipo, p.status, p.observacoes, U
  from jsonb_populate_recordset(null::inventario, d->'inventario') p on conflict (id) do update set status = excluded.status;

  insert into inventario_item (id, empresa_id, inventario_id, material_id, produto_id, saldo_sistema, saldo_contado)
  select (i->>'id')::uuid, E, (i->>'inventario_id')::uuid, (i->>'material_id')::uuid, (i->>'produto_id')::uuid,
         (i->>'saldo_sistema')::numeric, (i->>'saldo_contado')::numeric
  from jsonb_array_elements(d->'inventario_item') i on conflict (id) do nothing;

  -- ---------- Mercado Livre: vendas que não deram para importar ----------
  insert into ml_pendente (empresa_id, ml_order_id, motivo, resumo, resolvido, criado_em)
  select E, p.ml_order_id, p.motivo, p.resumo, p.resolvido, p.criado_em
  from jsonb_populate_recordset(null::ml_pendente, d->'ml_pendente') p
  on conflict do nothing;

  -- ---------- Parâmetros -> configurações da empresa ----------
  update empresa set
    imposto_perc = coalesce((select (x->>'valor')::numeric from jsonb_array_elements(d->'parametro') x where x->>'chave' = 'imposto_perc'), imposto_perc),
    permite_estoque_negativo = coalesce((select (x->>'valor')::boolean from jsonb_array_elements(d->'parametro') x where x->>'chave' = 'permite_estoque_negativo'), permite_estoque_negativo),
    dias_alerta_venda_aberta = coalesce((select (x->>'valor')::int from jsonb_array_elements(d->'parametro') x where x->>'chave' = 'dias_alerta_venda_aberta'), dias_alerta_venda_aberta)
  where id = E;

  foreach t in array tabelas loop
    execute format('alter table %I enable trigger user', t);
  end loop;
  if p_dry then
    raise exception 'DRY prod=% mat=% venda=% mov=% anuncio=% kit=% cat=% taxa=%',
      (select count(*) from produto where empresa_id=E),(select count(*) from material where empresa_id=E),(select count(*) from venda where empresa_id=E),
      (select count(*) from movimento_estoque where empresa_id=E),(select string_agg(anuncio||'>'||quantidade,',') from ml_anuncio where empresa_id=E),
      (select count(*) from kit_item where empresa_id=E),(select count(*) from categoria where empresa_id=E),
      (select string_agg(perfil||':'||perc_taxa||':'||vigente_desde,',') from canal_taxa where empresa_id=E);
  end if;
  return 'ok';
end $mig$;
revoke execute on function public._migrar_patevao(boolean) from public, anon, authenticated;
