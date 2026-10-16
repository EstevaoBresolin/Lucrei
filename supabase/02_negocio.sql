-- =====================================================================
-- Lucrei · 02 · Tabelas do negócio
-- =====================================================================
-- Toda tabela tem empresa_id (preenchido sozinho com a empresa atual) e as
-- ligações entre tabelas usam (empresa_id, id): o banco recusa ligar um
-- registro a outro de outra empresa.

-- ---------- Cadastros ----------
create table categoria (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  nome text not null,
  tipo text not null check (tipo in ('material','produto','despesa')),
  created_at timestamptz not null default now(),
  unique (empresa_id, id), unique (empresa_id, nome, tipo)
);

create table fornecedor (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  nome text not null,
  documento text, telefone text, whatsapp text, email text,
  prazo_entrega_dias int,
  observacoes text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, id)
);

create table cliente (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  nome text not null,
  telefone text, whatsapp text, cidade text, origem text, observacoes text,
  created_at timestamptz not null default now(),
  unique (empresa_id, id)
);

-- ---------- Insumos (material) ----------
create table material (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  sku text,
  nome text not null,
  categoria_id uuid,
  unidade_uso text not null default 'un',
  unidade_compra text not null default 'un',
  fator_conversao numeric(12,3) not null default 1 check (fator_conversao > 0),
  fornecedor_padrao_id uuid,
  estoque_minimo numeric(12,3) not null default 0,
  ponto_reposicao numeric(12,3) not null default 0,
  saldo numeric(12,3) not null default 0,
  custo_medio numeric(12,4) not null default 0,
  ultimo_custo numeric(12,4),
  localizacao text, foto_url text, observacoes text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, id), unique (empresa_id, sku),
  foreign key (empresa_id, categoria_id) references categoria(empresa_id, id),
  foreign key (empresa_id, fornecedor_padrao_id) references fornecedor(empresa_id, id)
);

-- ---------- Produtos ----------
-- tipo: revenda (comprado pronto) · fabricado (custo pela ficha de insumos) · kit (composto por outros produtos)
create table produto (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  sku text,
  nome text not null,
  tipo text not null default 'revenda' check (tipo in ('revenda','fabricado','kit')),
  categoria_id uuid,
  fornecedor_padrao_id uuid,
  atributos jsonb not null default '{}'::jsonb,
  custo_padrao numeric(12,4) not null default 0,
  custo_medio numeric(12,4) not null default 0,
  custos_fixos_unit numeric(12,4) not null default 0,
  estoque_minimo numeric(12,3) not null default 0,
  saldo numeric(12,3) not null default 0,
  foto_url text, observacoes text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, id), unique (empresa_id, sku),
  foreign key (empresa_id, categoria_id) references categoria(empresa_id, id),
  foreign key (empresa_id, fornecedor_padrao_id) references fornecedor(empresa_id, id)
);

-- Ficha técnica (produto fabricado → insumos)
create table ficha_tecnica_item (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  produto_id uuid not null,
  material_id uuid not null,
  quantidade numeric(12,3) not null check (quantidade > 0),
  perc_perda numeric(5,2) not null default 0,
  foreign key (empresa_id, produto_id) references produto(empresa_id, id) on delete cascade,
  foreign key (empresa_id, material_id) references material(empresa_id, id)
);
create index ficha_produto on ficha_tecnica_item(produto_id);

-- Composição do kit (kit → produtos)
create table kit_item (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  kit_id uuid not null,
  produto_id uuid not null,
  quantidade numeric(12,3) not null check (quantidade > 0),
  check (kit_id <> produto_id),
  unique (kit_id, produto_id),
  foreign key (empresa_id, kit_id) references produto(empresa_id, id) on delete cascade,
  foreign key (empresa_id, produto_id) references produto(empresa_id, id)
);

-- ---------- Canais de venda ----------
create table canal (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  nome text not null,
  tipo text not null default 'marketplace' check (tipo in ('marketplace','direto')),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, id), unique (empresa_id, nome)
);

create table canal_taxa (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  canal_id uuid not null,
  perfil text not null default 'Padrão',
  perc_taxa numeric(5,2) not null default 0,
  tarifa_fixa numeric(12,2) not null default 0,
  tarifa_ate_preco numeric(12,2),
  frete_padrao numeric(12,2) not null default 0,
  vigente_desde date not null default current_date,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, id),
  foreign key (empresa_id, canal_id) references canal(empresa_id, id) on delete cascade
);

create table preco_canal (
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  produto_id uuid not null,
  canal_id uuid not null,
  preco_venda numeric(12,2) not null,
  primary key (produto_id, canal_id),
  foreign key (empresa_id, produto_id) references produto(empresa_id, id) on delete cascade,
  foreign key (empresa_id, canal_id) references canal(empresa_id, id) on delete cascade
);

-- ---------- Finanças: contas ----------
create table conta_financeira (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  nome text not null,
  saldo_inicial numeric(14,2) not null default 0,
  saldo_em date not null default current_date,
  padrao boolean not null default false,
  recebe_ml boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, id), unique (empresa_id, nome)
);
create unique index conta_um_padrao on conta_financeira(empresa_id) where padrao;
create unique index conta_um_ml on conta_financeira(empresa_id) where recebe_ml;

create table movimento_financeiro (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  conta_id uuid not null,
  data date not null default current_date,
  valor numeric(14,2) not null check (valor <> 0),
  descricao text not null,
  transferencia uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (empresa_id, conta_id) references conta_financeira(empresa_id, id)
);
create index movfin_conta on movimento_financeiro(conta_id, data);

create table despesa (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  data date not null default current_date,
  categoria_id uuid,
  descricao text not null,
  valor numeric(12,2) not null,
  recorrente boolean not null default false,
  forma_pagamento text,
  conta_id uuid,
  anexo_url text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (empresa_id, categoria_id) references categoria(empresa_id, id),
  foreign key (empresa_id, conta_id) references conta_financeira(empresa_id, id)
);
create index despesa_data on despesa(empresa_id, data);

-- ---------- Compras (de insumos e de produtos prontos) ----------
create table compra (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  numero int,
  fornecedor_id uuid,
  data date not null default current_date,
  status text not null default 'pedida' check (status in ('pedida','recebida','parcial','cancelada')),
  frete numeric(12,2) not null default 0,
  outras_despesas numeric(12,2) not null default 0,
  desconto numeric(12,2) not null default 0,
  criterio_rateio text not null default 'valor' check (criterio_rateio in ('valor','quantidade')),
  forma_pagamento text,
  conta_id uuid,
  nf_numero text, nf_anexo_url text, observacoes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (empresa_id, id), unique (empresa_id, numero),
  foreign key (empresa_id, fornecedor_id) references fornecedor(empresa_id, id),
  foreign key (empresa_id, conta_id) references conta_financeira(empresa_id, id)
);
create trigger compra_numero before insert on compra for each row execute function tg_numero_por_empresa();

create table compra_item (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  compra_id uuid not null,
  item_tipo text not null default 'material' check (item_tipo in ('material','produto')),
  material_id uuid,
  produto_id uuid,
  qtd_compra numeric(12,3) not null check (qtd_compra > 0),
  preco_unit_compra numeric(12,4) not null,
  qtd_recebida numeric(12,3) not null default 0,
  custo_unit_final numeric(12,4),
  check ((item_tipo = 'material' and material_id is not null and produto_id is null)
      or (item_tipo = 'produto' and produto_id is not null and material_id is null)),
  foreign key (empresa_id, compra_id) references compra(empresa_id, id) on delete cascade,
  foreign key (empresa_id, material_id) references material(empresa_id, id),
  foreign key (empresa_id, produto_id) references produto(empresa_id, id)
);

-- ---------- Produção ----------
create table ordem_producao (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  numero int,
  produto_id uuid not null,
  quantidade numeric(12,3) not null check (quantidade > 0),
  status text not null default 'planejada' check (status in ('planejada','em_montagem','concluida','cancelada')),
  data_planejada date default current_date,
  data_conclusao timestamptz,
  custo_total_real numeric(12,2),
  observacoes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (empresa_id, id), unique (empresa_id, numero),
  foreign key (empresa_id, produto_id) references produto(empresa_id, id)
);
create trigger ordem_numero before insert on ordem_producao for each row execute function tg_numero_por_empresa();

create table ordem_producao_consumo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  ordem_id uuid not null,
  material_id uuid not null,
  qtd_prevista numeric(12,3) not null,
  qtd_real numeric(12,3),
  custo_unit numeric(12,4),
  foreign key (empresa_id, ordem_id) references ordem_producao(empresa_id, id) on delete cascade,
  foreign key (empresa_id, material_id) references material(empresa_id, id)
);

-- ---------- Vendas ----------
create table venda (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  numero int,
  data date not null default current_date,
  canal_id uuid not null,
  canal_taxa_id uuid,
  pedido_externo text,
  cliente_id uuid,
  status text not null default 'aberta' check (status in ('aberta','enviada','entregue','cancelada','devolvida')),
  receita_bruta numeric(12,2) not null default 0,
  desconto numeric(12,2) not null default 0,
  receita numeric(12,2) not null default 0,
  perc_taxa numeric(5,2) not null default 0,
  valor_taxa numeric(12,2) not null default 0,
  tarifa_fixa numeric(12,2) not null default 0,
  frete numeric(12,2) not null default 0,
  perc_imposto numeric(5,2) not null default 0,
  valor_imposto numeric(12,2) not null default 0,
  outros_custos numeric(12,2) not null default 0,
  custo_produtos numeric(12,2) not null default 0,
  lucro numeric(12,2) not null default 0,
  margem numeric(7,4) not null default 0,
  forma_pagamento text,
  conta_id uuid,
  observacoes text,
  motivo_cancelamento text,
  ml_order_id bigint,
  ml_shipment_id bigint,
  ml_liquido numeric(14,2),
  ml_liberacao_em timestamptz,
  ml_liberado boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, id), unique (empresa_id, numero),
  foreign key (empresa_id, canal_id) references canal(empresa_id, id),
  foreign key (empresa_id, canal_taxa_id) references canal_taxa(empresa_id, id),
  foreign key (empresa_id, cliente_id) references cliente(empresa_id, id),
  foreign key (empresa_id, conta_id) references conta_financeira(empresa_id, id)
);
create trigger venda_numero before insert on venda for each row execute function tg_numero_por_empresa();
create index venda_data on venda(empresa_id, data);
create unique index venda_ml_order on venda(empresa_id, ml_order_id) where ml_order_id is not null;

create table venda_item (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  venda_id uuid not null,
  produto_id uuid not null,
  quantidade numeric(12,3) not null check (quantidade > 0),
  preco_unit numeric(12,2) not null,
  custo_unit_congelado numeric(12,4) not null,
  foreign key (empresa_id, venda_id) references venda(empresa_id, id) on delete cascade,
  foreign key (empresa_id, produto_id) references produto(empresa_id, id)
);
create index venda_item_venda on venda_item(venda_id);
create index venda_item_produto on venda_item(produto_id);

-- ---------- Estoque ----------
create table movimento_estoque (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  data timestamptz not null default now(),
  tipo text not null check (tipo in ('compra','consumo_producao','entrada_producao','venda','estorno_venda','devolucao','perda','ajuste','uso_interno','entrada_manual')),
  item_tipo text not null check (item_tipo in ('material','produto')),
  material_id uuid,
  produto_id uuid,
  quantidade numeric(12,3) not null check (quantidade <> 0),
  custo_unit numeric(12,4),
  saldo_apos numeric(12,3),
  origem_tipo text,
  origem_id uuid,
  motivo text,
  usuario_id uuid default auth.uid(),
  check ((item_tipo = 'material' and material_id is not null and produto_id is null)
      or (item_tipo = 'produto' and produto_id is not null and material_id is null)),
  foreign key (empresa_id, material_id) references material(empresa_id, id),
  foreign key (empresa_id, produto_id) references produto(empresa_id, id)
);
create index movest_material on movimento_estoque(material_id, data);
create index movest_produto on movimento_estoque(produto_id, data);
create index movest_origem on movimento_estoque(origem_tipo, origem_id);

create table inventario (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  data timestamptz not null default now(),
  item_tipo text not null check (item_tipo in ('material','produto')),
  status text not null default 'aberto' check (status in ('aberto','concluido','cancelado')),
  observacoes text,
  created_by uuid default auth.uid(),
  unique (empresa_id, id)
);

create table inventario_item (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  inventario_id uuid not null,
  material_id uuid,
  produto_id uuid,
  saldo_sistema numeric(12,3) not null,
  saldo_contado numeric(12,3),
  diferenca numeric(12,3) generated always as (saldo_contado - saldo_sistema) stored,
  foreign key (empresa_id, inventario_id) references inventario(empresa_id, id) on delete cascade,
  foreign key (empresa_id, material_id) references material(empresa_id, id),
  foreign key (empresa_id, produto_id) references produto(empresa_id, id)
);

-- ---------- Mercado Livre (cada empresa com a sua conta) ----------
create table ml_conta (
  empresa_id uuid primary key references empresa(id) on delete cascade,
  ml_user_id bigint not null unique,   -- uma conta do ML só pode estar ligada a UMA empresa
  nickname text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table ml_oauth_state (
  state text primary key,
  empresa_id uuid not null references empresa(id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table ml_evento (
  id bigint generated always as identity primary key,
  empresa_id uuid references empresa(id) on delete cascade,
  ml_user_id bigint,
  topic text, resource text,
  recebido_em timestamptz not null default now(),
  processado_em timestamptz,
  erro text
);
create index ml_evento_empresa on ml_evento(empresa_id, recebido_em);

-- Ligação anúncio → produto (quantidade: anúncio "pacote com 2" baixa 2 unidades)
create table ml_anuncio (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  anuncio text not null check (anuncio ~ '^MLB[0-9]+$'),
  variacao bigint,
  titulo text,
  permalink text,
  produto_id uuid not null,
  quantidade numeric(12,3) not null default 1 check (quantidade > 0),
  criado_em timestamptz not null default now(),
  foreign key (empresa_id, produto_id) references produto(empresa_id, id) on delete cascade
);
create unique index ml_anuncio_unico on ml_anuncio(empresa_id, anuncio, coalesce(variacao, 0));

create table ml_pendente (
  empresa_id uuid not null references empresa(id) on delete cascade,
  ml_order_id bigint not null,
  motivo text not null,
  resumo jsonb,
  resolvido boolean not null default false,
  criado_em timestamptz not null default now(),
  primary key (empresa_id, ml_order_id)
);

create table ml_pergunta_avisada (
  empresa_id uuid not null references empresa(id) on delete cascade,
  question_id bigint not null,
  avisada_em timestamptz not null default now(),
  primary key (empresa_id, question_id)
);

-- Dinheiro a liberar de pedidos anteriores ao cadastro (ajuste de implantação)
create table ml_recebivel (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references empresa(id) on delete cascade,
  ml_order_id bigint not null,
  data date not null,
  descricao text not null,
  valor numeric(12,2) not null,
  liberacao_em timestamptz,
  liberado boolean not null default false,
  criado_em timestamptz not null default now(),
  unique (empresa_id, ml_order_id)
);

-- ---------- Triggers de data/auditoria ----------
create trigger upd_material before update on material for each row execute function tg_updated_at();
create trigger upd_produto before update on produto for each row execute function tg_updated_at();
create trigger upd_venda before update on venda for each row execute function tg_updated_at();
create trigger upd_fornecedor before update on fornecedor for each row execute function tg_updated_at();

create trigger audit_venda after insert or update or delete on venda for each row execute function tg_auditoria();
create trigger audit_produto after insert or update or delete on produto for each row execute function tg_auditoria();
create trigger audit_material after insert or update or delete on material for each row execute function tg_auditoria();
create trigger audit_compra after insert or update or delete on compra for each row execute function tg_auditoria();
create trigger audit_despesa after insert or update or delete on despesa for each row execute function tg_auditoria();
create trigger audit_canal_taxa after insert or update or delete on canal_taxa for each row execute function tg_auditoria();
