-- Teste de isolamento entre empresas (rodar em banco de TESTE, nunca em produção).
-- Cria 3 usuários e 2 empresas; as linhas com erro esperado estão entre "ON_ERROR_STOP 0".
\set ON_ERROR_STOP 1
insert into auth.users (id, email, raw_user_meta_data) values
 ('aaaaaaaa-0000-0000-0000-000000000001','ana@a.com','{"nome":"Ana"}'),
 ('bbbbbbbb-0000-0000-0000-000000000002','beto@b.com','{"nome":"Beto"}'),
 ('cccccccc-0000-0000-0000-000000000003','caio@a.com','{"nome":"Caio"}');

-- ===== Ana cria a Loja A (revenda) =====
set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
select criar_empresa('Loja A','revenda') is not null as criou_a;
select modulos->>'producao' producao_revenda from empresa;
insert into produto (nome, tipo, custo_padrao) values ('Celular X','revenda',1000), ('Capinha','revenda',10);
insert into produto (nome, tipo) values ('Kit Celular+Capinha','kit');
insert into kit_item (kit_id, produto_id, quantidade)
  select k.id, p.id, 1 from produto k, produto p where k.nome like 'Kit%' and p.tipo='revenda';
-- compra de produto pronto
insert into compra (frete) values (20);
insert into compra_item (compra_id, item_tipo, produto_id, qtd_compra, preco_unit_compra)
  select c.id, 'produto', p.id, case when p.nome='Celular X' then 2 else 10 end, case when p.nome='Celular X' then 900 else 8 end
  from compra c, produto p where p.tipo='revenda';
select receber_compra(id) from compra;
select nome, saldo, custo_medio from produto order by nome;
select numero from compra;
-- venda do kit
select registrar_venda(jsonb_build_object('canal_id',(select id from canal where nome='Mercado Livre'),
  'itens', jsonb_build_array(jsonb_build_object('produto_id',(select id from produto where tipo='kit'),'quantidade',1,'preco_unit',1500)))) is not null vendeu;
select numero, receita, custo_produtos, lucro from venda;
select nome, saldo from vw_produto_estoque order by nome;
select saldo_disponivel from vw_produto_estoque where tipo='kit';
select cancelar_venda(id, 'teste') from venda;
select nome, saldo from produto order by nome;
-- convite para Caio (operador)
select criar_convite('operador') as token \gset

-- ===== Beto cria a Loja B e tenta enxergar a A =====
select set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002',false);
select criar_empresa('Loja B','fabricacao') is not null as criou_b;
select count(*) as produtos_visiveis_b from produto;
select count(*) as vendas_visiveis_b from venda;
select count(*) as empresas_visiveis_b from empresa;
select count(*) as convites_visiveis_b from convite;
reset role;
select id as prod_a from produto where nome='Celular X' \gset
select id as emp_a from empresa where nome='Loja A' \gset
set role authenticated;
-- tenta ligar ao produto da A
\set ON_ERROR_STOP 0
insert into preco_canal (produto_id, canal_id, preco_venda) select :'prod_a', id, 1 from canal limit 1;
update usuario set empresa_atual = :'emp_a' where id = auth.uid();
select trocar_empresa(:'emp_a');
insert into produto (empresa_id, nome) values (:'emp_a', 'invasor');
select registrar_venda(jsonb_build_object('canal_id',(select id from canal limit 1),'itens', jsonb_build_array(jsonb_build_object('produto_id',:'prod_a','quantidade',1,'preco_unit',1))));
update produto set nome = 'hack' where id = :'prod_a';
select count(*) as afetados from produto where id = :'prod_a';
\set ON_ERROR_STOP 1

-- ===== Caio aceita o convite da Loja A =====
select set_config('request.jwt.claim.sub','cccccccc-0000-0000-0000-000000000003',false);
select ver_convite(:'token');
select aceitar_convite(:'token') = :'emp_a' as entrou_na_a;
select meu_papel(), count(*) produtos_caio from produto;
\set ON_ERROR_STOP 0
select excluir_produto(:'prod_a');   -- operador não exclui
select count(*) as contas_caio from conta_financeira;
insert into despesa (descricao, valor) values ('x', 1);  -- operador sem finanças
\set ON_ERROR_STOP 1

-- ===== Servidor (ML) lança venda na Loja A =====
reset role;
set role service_role;
select set_config('request.jwt.claim.role','service_role',false);
select set_config('request.jwt.claim.sub','',false);
select importar_venda_ml(:'emp_a', jsonb_build_object('canal_id',(select id from canal where empresa_id=:'emp_a' and nome='Mercado Livre'),
  'itens', jsonb_build_array(jsonb_build_object('produto_id',:'prod_a','quantidade',1,'preco_unit',1300))), 123, 456) is not null ml_ok;
select e.nome, v.numero, v.ml_order_id from venda v join empresa e on e.id=v.empresa_id order by 1,2;
