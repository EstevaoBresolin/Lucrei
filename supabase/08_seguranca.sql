-- =====================================================================
-- Lucrei · 08 · Correções da auditoria de segurança
-- =====================================================================

-- ---------- 1) Finanças só para o dono ----------
-- As telas de Finanças já eram só do dono, mas as views podiam ser lidas pela API por operador/leitura
-- (saldo das contas, extrato com valores líquidos e o que falta receber do ML).
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
 where (select is_dono())
   and (mov.data > c.saldo_em or (mov.data = c.saldo_em and mov.criado > c.saldo_registrado_em));

create or replace view vw_conta_saldo with (security_invoker = true) as
select c.id, c.empresa_id, c.nome, c.saldo_inicial, c.saldo_em, c.padrao, c.recebe_ml, c.ativo, c.created_at,
       c.saldo_inicial + coalesce((select sum(e.valor) from vw_extrato e
                                         where e.conta_id = c.id and e.data <= (now() at time zone 'America/Sao_Paulo')::date), 0) saldo
  from conta_financeira c
 where (select is_dono());

create or replace view vw_ml_a_receber with (security_invoker = true) as
select v.id, v.numero, v.data, v.pedido_externo, v.receita, venda_liquido(v.*) as liquido, (v.ml_liquido is null) as estimado,
       v.ml_liberacao_em, v.status, false as avulso, v.ml_order_id, null::text as descricao
  from venda v
 where (select is_dono())
   and v.ml_order_id is not null and v.status not in ('cancelada','devolvida') and not v.ml_liberado
   and (v.ml_liberacao_em is null or v.ml_liberacao_em > now())
union all
select r.id, null::integer, r.data, r.ml_order_id::text, r.valor, r.valor::numeric, false, r.liberacao_em, 'antiga'::text, true, r.ml_order_id, r.descricao
  from ml_recebivel r
 where (select is_dono())
   and not r.liberado and (r.liberacao_em is null or r.liberacao_em > now())
   and not exists (select 1 from venda v where v.ml_order_id = r.ml_order_id and v.empresa_id = r.empresa_id);

-- ---------- 2) Dados do dono que funcionários não precisam ver ----------
-- CPF/CNPJ de quem paga e os códigos do Asaas ficavam visíveis para operador/leitura pela API.
revoke select on empresa from authenticated, anon;
grant select (id, nome, tipo_negocio, modulos, imposto_perc, permite_estoque_negativo, dias_alerta_venda_aberta,
              email_avisos, ntfy_topico, plano, status, teste_ate, pago_ate, cobranca_vencimento, created_by, created_at)
  on empresa to authenticated;

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
      'cobranca_url', case when is_dono() then e.cobranca_url end,
      'cobranca_vencimento', e.cobranca_vencimento,
      'documento', case when is_dono() then e.documento end,
      'vendas_mes', (select count(*) from venda v where v.empresa_id = e.id and v.status not in ('cancelada','devolvida')
                      and v.data >= date_trunc('month', current_date)::date))
    from empresa e left join plano p on p.codigo = e.plano
    where e.id = empresa_atual())
  end
$$;

-- empresa_liberada(id) só responde sobre a própria empresa (antes dava para consultar qualquer uma pelo id)
create or replace function empresa_liberada(p_empresa uuid default null) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select e.status = 'cortesia'
        or coalesce(e.teste_ate > now(), false)
        or coalesce(current_date <= e.pago_ate + 3, false)
    from empresa e
    where e.id = coalesce(p_empresa, empresa_atual())
      and (coalesce(auth.role(), '') = 'service_role' or auth.uid() is null
           or exists (select 1 from membro m where m.empresa_id = e.id and m.user_id = auth.uid()))), false)
$$;

-- ---------- 3) Colunas que o navegador pode alterar ----------
-- membro: o dono só muda o papel (antes dava para trocar o user_id da linha e "puxar" outra pessoa para a empresa)
revoke update on membro from authenticated;
grant update (papel) on membro to authenticated;
-- usuario: só o nome e a empresa em uso (e-mail e aceite dos termos não mudam pelo navegador)
revoke update on usuario from authenticated;
grant update (nome, empresa_atual) on usuario to authenticated;
-- Tabelas internas: nada de acesso direto pelo navegador
revoke all on ml_conta, ml_oauth_state, ml_evento, ml_pergunta_avisada, asaas_evento, auditoria from anon;
revoke insert, update, delete on ml_conta, ml_oauth_state, ml_evento, ml_pergunta_avisada, asaas_evento, auditoria from authenticated;
revoke insert, update, delete on plano from authenticated, anon;

-- ---------- 4) Teste grátis: um por pessoa, e limite de empresas ----------
-- Antes: cada empresa nova ganhava 30 dias, então bastava criar outra empresa para nunca pagar.
create or replace function criar_empresa(p_nome text, p_tipo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_canal uuid; v_ml uuid; v_ja_teve boolean;
begin
  if auth.uid() is null then raise exception 'Faça login'; end if;
  if coalesce(trim(p_nome),'') = '' then raise exception 'Dê um nome à empresa'; end if;
  if length(trim(p_nome)) > 120 then raise exception 'Nome muito longo'; end if;
  if p_tipo not in ('revenda','fabricacao','misto') then raise exception 'Tipo de negócio inválido'; end if;
  if (select count(*) from empresa where created_by = auth.uid()) >= 10 then
    raise exception 'Limite de empresas por conta atingido. Fale com o suporte.';
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
-- created_by da empresa não pode ser trocado pelo navegador (é o que conta o teste grátis)
create or replace function tg_empresa_protege_cobranca() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.status is distinct from old.status or new.plano is distinct from old.plano or
       new.teste_ate is distinct from old.teste_ate or new.pago_ate is distinct from old.pago_ate or
       new.asaas_cliente_id is distinct from old.asaas_cliente_id or new.asaas_assinatura_id is distinct from old.asaas_assinatura_id or
       new.cobranca_url is distinct from old.cobranca_url or new.cobranca_vencimento is distinct from old.cobranca_vencimento or
       new.documento is distinct from old.documento or new.created_by is distinct from old.created_by or new.id is distinct from old.id) then
    raise exception 'Os dados da assinatura não podem ser alterados por aqui.';
  end if;
  return new;
end $$;

-- ---------- 5) Valores impossíveis enviados direto pela API ----------
create or replace function tg_valida_movimento() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.custo_unit is not null and new.custo_unit < 0 then raise exception 'Custo não pode ser negativo'; end if;
  return new;
end $$;
drop trigger if exists valida_movimento on movimento_estoque;
create trigger valida_movimento before insert on movimento_estoque for each row execute function tg_valida_movimento();
revoke execute on function tg_valida_movimento() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'venda_item_valores_pos') then
    alter table venda_item add constraint venda_item_valores_pos check (quantidade > 0 and preco_unit >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'empresa_nome_tamanho') then
    alter table empresa add constraint empresa_nome_tamanho check (length(nome) <= 120) not valid;
  end if;
end $$;

-- ---------- 6) Conexão do Mercado Livre presa a quem iniciou ----------
-- O código de autorização volta para o site e só é trocado pelo usuário logado que clicou em "Conectar".
alter table ml_oauth_state add column if not exists usado_em timestamptz;

-- ---------- 7) Excluir cadastros pela API só o dono (a tela já mostrava "Excluir" só para o dono) ----------
do $$
declare t text;
begin
  foreach t in array array['produto','material','fornecedor','cliente','canal','canal_taxa','categoria'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_del_dono') then
      execute format('create policy %I on %I as restrictive for delete using ((select is_admin()))', t || '_del_dono', t);
    end if;
  end loop;
end $$;

-- 10) Convite feito para um e-mail só pode ser aceito por quem entrou com aquele e-mail
create or replace function aceitar_convite(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c convite; v_email text;
begin
  if auth.uid() is null then raise exception 'Faça login'; end if;
  select * into c from convite where token = p_token for update;
  if c.id is null then raise exception 'Convite não encontrado'; end if;
  if c.aceito_em is not null then raise exception 'Este convite já foi usado'; end if;
  if c.expira_em < now() then raise exception 'Este convite venceu. Peça um novo.'; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  if c.email is not null and c.email <> coalesce(v_email, '') then
    raise exception 'Este convite foi feito para %. Entre com esse e-mail para aceitar.', c.email;
  end if;
  insert into membro (empresa_id, user_id, papel) values (c.empresa_id, auth.uid(), c.papel)
    on conflict (empresa_id, user_id) do nothing;
  update convite set aceito_em = now(), aceito_por = auth.uid() where id = c.id;
  update usuario set empresa_atual = c.empresa_id where id = auth.uid();
  return c.empresa_id;
end $$;
