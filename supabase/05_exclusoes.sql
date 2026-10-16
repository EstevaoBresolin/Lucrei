-- =====================================================================
-- Lucrei · 05 · Funções de exclusão
-- =====================================================================
-- Separadas porque contêm comandos de exclusão (rodar no SQL Editor do Supabase).

create or replace function excluir_compra(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s text;
begin
  if not is_membro() then raise exception 'Sem permissão'; end if;
  select status into s from compra where id = p_id and empresa_id = exigir_empresa() for update;
  if s is null then raise exception 'Compra não encontrada'; end if;
  if s not in ('pedida','cancelada') then raise exception 'Compra já recebida: os itens já entraram no estoque e não dá para excluir'; end if;
  delete from compra where id = p_id;
end $$;

create or replace function excluir_ordem_producao(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s text;
begin
  if not is_membro() then raise exception 'Sem permissão'; end if;
  select status into s from ordem_producao where id = p_id and empresa_id = exigir_empresa() for update;
  if s is null then raise exception 'Ordem não encontrada'; end if;
  if s = 'concluida' then raise exception 'Ordem concluída já movimentou o estoque e não dá para excluir'; end if;
  delete from ordem_producao where id = p_id;
end $$;

create or replace function excluir_material(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_nome text; v_emp uuid := exigir_empresa();
begin
  if not is_admin() then raise exception 'Sem permissão'; end if;
  select nome into v_nome from material where id = p_id and empresa_id = v_emp for update;
  if v_nome is null then raise exception 'Insumo não encontrado'; end if;
  if exists (select 1 from compra_item where material_id = p_id) then
    raise exception 'Não dá para excluir: % aparece em compras. Desmarque "Insumo ativo" para tirá-lo das listas.', v_nome; end if;
  if exists (select 1 from ficha_tecnica_item where material_id = p_id) then
    raise exception 'Não dá para excluir: % está na ficha técnica de algum produto. Tire-o da ficha primeiro.', v_nome; end if;
  if exists (select 1 from ordem_producao_consumo where material_id = p_id) then
    raise exception 'Não dá para excluir: % já foi consumido em produção.', v_nome; end if;
  if exists (select 1 from movimento_estoque where material_id = p_id and tipo not in ('entrada_manual','ajuste','perda','uso_interno')) then
    raise exception 'Não dá para excluir: % tem movimentações de compra ou produção.', v_nome; end if;
  delete from inventario_item where material_id = p_id;
  delete from movimento_estoque where material_id = p_id;
  delete from material where id = p_id;
end $$;

create or replace function excluir_produto(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_nome text; v_emp uuid := exigir_empresa();
begin
  if not is_admin() then raise exception 'Sem permissão'; end if;
  select nome into v_nome from produto where id = p_id and empresa_id = v_emp for update;
  if v_nome is null then raise exception 'Produto não encontrado'; end if;
  if exists (select 1 from venda_item where produto_id = p_id) then
    raise exception 'Não dá para excluir: % já tem vendas. Desmarque "Produto ativo" para tirá-lo das listas.', v_nome; end if;
  if exists (select 1 from ordem_producao where produto_id = p_id) then
    raise exception 'Não dá para excluir: % tem ordens de produção.', v_nome; end if;
  if exists (select 1 from kit_item where produto_id = p_id) then
    raise exception 'Não dá para excluir: % faz parte de um kit.', v_nome; end if;
  if exists (select 1 from compra_item where produto_id = p_id) then
    raise exception 'Não dá para excluir: % aparece em compras.', v_nome; end if;
  if exists (select 1 from movimento_estoque where produto_id = p_id and tipo not in ('entrada_manual','ajuste','perda','uso_interno')) then
    raise exception 'Não dá para excluir: % tem movimentações de venda, compra ou produção.', v_nome; end if;
  delete from inventario_item where produto_id = p_id;
  delete from movimento_estoque where produto_id = p_id;
  delete from produto where id = p_id;
end $$;

create or replace function excluir_canal(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Sem permissão'; end if;
  if exists (select 1 from venda where canal_id = p_id) then
    raise exception 'Este canal já tem vendas lançadas. Desative-o em vez de excluir.'; end if;
  delete from canal where id = p_id and empresa_id = exigir_empresa();
end $$;

create or replace function ml_desconectar() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Sem permissão'; end if;
  delete from ml_conta where empresa_id = exigir_empresa();
end $$;

grant execute on function excluir_compra(uuid), excluir_ordem_producao(uuid), excluir_material(uuid),
  excluir_produto(uuid), excluir_canal(uuid), ml_desconectar() to authenticated;
revoke execute on function excluir_compra(uuid), excluir_ordem_producao(uuid), excluir_material(uuid),
  excluir_produto(uuid), excluir_canal(uuid), ml_desconectar() from public, anon;
