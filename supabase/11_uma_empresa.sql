-- =====================================================================
-- Apura · 11 · Uma empresa por conta
-- =====================================================================
-- Cada conta cria uma empresa só. Quem é convidado para outras empresas continua podendo participar delas.

create or replace function criar_empresa(p_nome text, p_tipo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_canal uuid; v_ml uuid; v_ja_teve boolean;
begin
  if auth.uid() is null then raise exception 'Faça login'; end if;
  if coalesce(trim(p_nome),'') = '' then raise exception 'Dê um nome à empresa'; end if;
  if length(trim(p_nome)) > 120 then raise exception 'Nome muito longo'; end if;
  if p_tipo not in ('revenda','fabricacao','misto') then raise exception 'Tipo de negócio inválido'; end if;
  if exists (select 1 from empresa where created_by = auth.uid()) then
    raise exception 'Sua conta já tem uma empresa cadastrada. Cada conta pode ter uma empresa.';
  end if;
  v_ja_teve := exists (select 1 from empresa where created_by = auth.uid());
  insert into empresa (nome, tipo_negocio, modulos, email_avisos, status, plano, teste_ate, created_by)
  values (trim(p_nome), p_tipo,
          jsonb_build_object('compras', true, 'financas', true, 'mercado_livre', true, 'clientes', true,
                             'fornecedores', true, 'kits', true, 'producao', p_tipo <> 'revenda'),
          (select email from usuario where id = auth.uid()),
          'teste', 'teste', case when v_ja_teve then now() else now() + interval '30 days' end, auth.uid())
  returning id into v_id;
  insert into membro (empresa_id, user_id, papel) values (v_id, auth.uid(), 'dono');
  update usuario set empresa_atual = v_id where id = auth.uid();
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
