-- =====================================================================
-- Lucrei · 04 · Mercado Livre por empresa, importação de anúncios e RLS
-- =====================================================================

create or replace function ml_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not is_leitor() then null else
    jsonb_build_object(
      'conectado', exists (select 1 from ml_conta where empresa_id = empresa_atual() and refresh_token is not null),
      'nickname', (select nickname from ml_conta where empresa_id = empresa_atual()),
      'atualizado_em', (select updated_at from ml_conta where empresa_id = empresa_atual()),
      'ultimo_evento', (select max(recebido_em) from ml_evento where empresa_id = empresa_atual()),
      'pendentes', (select count(*) from ml_pendente where empresa_id = empresa_atual() and not resolvido))
  end
$$;

-- Chamado pelo servidor (webhook/sincronização) já sabendo a empresa dona da conta do ML
create or replace function importar_venda_ml(p_empresa uuid, p jsonb, p_order bigint, p_shipment bigint) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Sem permissão'; end if;
  perform set_config('app.empresa', p_empresa::text, true);
  perform pg_advisory_xact_lock(p_order);
  select id into v_id from venda where empresa_id = p_empresa and ml_order_id = p_order;
  if v_id is not null then return v_id; end if;
  v_id := registrar_venda(p);
  update venda set ml_order_id = p_order, ml_shipment_id = p_shipment where id = v_id;
  update ml_pendente set resolvido = true where empresa_id = p_empresa and ml_order_id = p_order;
  return v_id;
end $$;

-- Funções do servidor que precisam agir "como" a empresa (cancelar/mudar status de venda do ML)
create or replace function ml_cancelar_venda(p_empresa uuid, p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Sem permissão'; end if;
  perform set_config('app.empresa', p_empresa::text, true);
  perform cancelar_venda(p_id, p_motivo);
end $$;

create or replace function ml_mudar_status(p_empresa uuid, p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Sem permissão'; end if;
  perform set_config('app.empresa', p_empresa::text, true);
  perform mudar_status_venda(p_id, p_status);
end $$;

-- Importa anúncios do ML criando produtos (ou ligando a produtos existentes).
-- p = { itens: [{ anuncio, variacao, titulo, permalink, produto_id?, nome, sku, tipo, preco, foto_url, estoque, custo }] }
create or replace function importar_anuncios(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := exigir_empresa(); v_item jsonb; v_prod uuid; v_canal uuid; v_sku text;
  v_criados int := 0; v_ligados int := 0; v_estoque numeric; v_custo numeric;
begin
  if not is_membro() then raise exception 'Sem permissão'; end if;
  select id into v_canal from canal where empresa_id = v_emp and nome ilike '%mercado%livre%' order by ativo desc limit 1;

  for v_item in select * from jsonb_array_elements(coalesce(p->'itens','[]'::jsonb)) loop
    v_prod := nullif(v_item->>'produto_id','')::uuid;
    if v_prod is not null and not exists (select 1 from produto where id = v_prod and empresa_id = v_emp) then
      raise exception 'Produto não encontrado';
    end if;

    if v_prod is null then
      v_sku := nullif(trim(v_item->>'sku'),'');
      if v_sku is not null and exists (select 1 from produto where empresa_id = v_emp and sku = v_sku) then v_sku := null; end if;
      v_custo := nullif(v_item->>'custo','')::numeric;
      insert into produto (empresa_id, nome, sku, tipo, custo_padrao, foto_url)
      values (v_emp, left(coalesce(nullif(trim(v_item->>'nome'),''), v_item->>'titulo'), 200), v_sku,
              coalesce(nullif(v_item->>'tipo',''), 'revenda'), coalesce(v_custo, 0), nullif(v_item->>'foto_url',''))
      returning id into v_prod;
      v_criados := v_criados + 1;

      if v_canal is not null and nullif(v_item->>'preco','') is not null then
        insert into preco_canal (empresa_id, produto_id, canal_id, preco_venda)
        values (v_emp, v_prod, v_canal, (v_item->>'preco')::numeric)
        on conflict (produto_id, canal_id) do update set preco_venda = excluded.preco_venda;
      end if;

      v_estoque := coalesce(nullif(v_item->>'estoque','')::numeric, 0);
      if v_estoque > 0 and coalesce(v_item->>'tipo','revenda') <> 'kit' then
        insert into movimento_estoque (empresa_id, tipo, item_tipo, produto_id, quantidade, custo_unit, origem_tipo, motivo)
        values (v_emp, 'entrada_manual', 'produto', v_prod, v_estoque, coalesce(v_custo, 0), 'manual', 'Saldo inicial (importado do Mercado Livre)');
      end if;
    end if;

    insert into ml_anuncio (empresa_id, anuncio, variacao, titulo, permalink, produto_id, quantidade)
    values (v_emp, upper(v_item->>'anuncio'), nullif(v_item->>'variacao','')::bigint, v_item->>'titulo', v_item->>'permalink', v_prod,
            coalesce(nullif(v_item->>'quantidade','')::numeric, 1))
    on conflict (empresa_id, anuncio, (coalesce(variacao, 0))) do update
      set produto_id = excluded.produto_id, titulo = excluded.titulo, permalink = excluded.permalink, quantidade = excluded.quantidade;
    v_ligados := v_ligados + 1;
  end loop;
  return jsonb_build_object('criados', v_criados, 'ligados', v_ligados);
end $$;

-- ---------- RLS das tabelas de negócio ----------
-- Padrão: todos da empresa leem; dono e operador lançam.
do $$
declare t text;
begin
  foreach t in array array['categoria','fornecedor','cliente','material','produto','ficha_tecnica_item','kit_item',
                           'canal','canal_taxa','preco_canal','compra','compra_item','ordem_producao','inventario_item',
                           'ml_anuncio','ml_pendente'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (empresa_id = (select empresa_atual()))', t || '_sel', t);
    execute format('create policy %I on %I for insert with check (empresa_id = (select empresa_atual()) and (select is_membro()))', t || '_ins', t);
    execute format('create policy %I on %I for update using (empresa_id = (select empresa_atual()) and (select is_membro())) with check (empresa_id = (select empresa_atual()))', t || '_upd', t);
    execute format('create policy %I on %I for delete using (empresa_id = (select empresa_atual()) and (select is_membro()))', t || '_del', t);
  end loop;

  -- Só leitura direta (escrita apenas pelas funções do sistema)
  foreach t in array array['venda','venda_item','movimento_estoque','ordem_producao_consumo','inventario'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (empresa_id = (select empresa_atual()))', t || '_sel', t);
  end loop;

  -- Finanças: só o dono
  foreach t in array array['conta_financeira','movimento_financeiro','despesa','ml_recebivel'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all using (empresa_id = (select empresa_atual()) and (select is_admin())) with check (empresa_id = (select empresa_atual()) and (select is_admin()))', t || '_dono', t);
  end loop;

  -- Mercado Livre interno: sem acesso direto (tokens!). O sistema lê pelo ml_status().
  foreach t in array array['ml_conta','ml_oauth_state','ml_evento','ml_pergunta_avisada'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Conta financeira: operador vê o nome das contas (para escolher na venda/compra)
create policy conta_financeira_sel_membro on conta_financeira for select using (empresa_id = (select empresa_atual()));

-- ---------- Permissões ----------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
-- Funções só do servidor
revoke execute on function importar_venda_ml(uuid, jsonb, bigint, bigint) from authenticated;
revoke execute on function ml_cancelar_venda(uuid, uuid, text) from authenticated;
revoke execute on function ml_mudar_status(uuid, uuid, text) from authenticated;

-- Funções internas: só chamadas por outras funções do sistema, nunca direto pelo navegador
revoke execute on function estornar_estoque_venda(uuid, text, text), recalcular_venda(uuid, numeric, numeric),
  tg_auditoria(), tg_membro_ultimo_dono(), tg_movimento_estoque(), tg_novo_usuario(), tg_numero_por_empresa(), tg_usuario_empresa_atual()
  from authenticated, public, anon;
alter function venda_liquido(venda) set search_path = public;
