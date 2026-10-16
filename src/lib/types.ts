export type Categoria = { id: string; nome: string; tipo: 'material' | 'produto' | 'despesa' }
export type Fornecedor = { id: string; nome: string; documento: string | null; telefone: string | null; whatsapp: string | null; email: string | null; prazo_entrega_dias: number | null; observacoes: string | null; ativo: boolean }
export type Cliente = { id: string; nome: string; telefone: string | null; whatsapp: string | null; cidade: string | null; origem: string | null; observacoes: string | null }
export type Material = {
  id: string; sku: string | null; nome: string; categoria_id: string | null; unidade_uso: string; unidade_compra: string
  fator_conversao: number; fornecedor_padrao_id: string | null; estoque_minimo: number; ponto_reposicao: number
  saldo: number; custo_medio: number; ultimo_custo: number | null; localizacao: string | null; observacoes: string | null; ativo: boolean
  valor_estoque?: number; consumo_diario?: number; situacao?: 'ok' | 'baixo' | 'zerado'
}
export type TipoProduto = 'revenda' | 'fabricado' | 'kit'
export type Produto = {
  id: string; sku: string | null; nome: string; categoria_id: string | null; fornecedor_padrao_id: string | null
  atributos: Record<string, string>; tipo: TipoProduto; custo_padrao: number; custo_medio: number; custos_fixos_unit: number
  estoque_minimo: number; saldo: number; foto_url: string | null; observacoes: string | null; ativo: boolean
  valor_estoque?: number; vendidos_30d?: number; situacao?: 'ok' | 'baixo' | 'zerado'
  /** Da view vw_produto_estoque: kit = quantos kits dá para montar; demais = saldo */
  saldo_disponivel?: number
  /** Da view vw_produto_estoque: custo unitário usado na venda (kit = soma dos componentes) */
  custo_atual?: number
}
export const TIPO_PRODUTO: Record<TipoProduto, { nome: string; texto: string }> = {
  revenda: { nome: 'Comprado pronto', texto: 'O custo vem das compras do produto (custo médio).' },
  fabricado: { nome: 'Fabricado', texto: 'O custo vem da ficha técnica (insumos) e da produção.' },
  kit: { nome: 'Kit', texto: 'Formado por outros produtos; vender o kit baixa cada um deles.' },
}
export type TaxaVigente = {
  id: string; canal_id: string; perfil: string; perc_taxa: number; tarifa_fixa: number; tarifa_ate_preco: number | null
  frete_padrao: number; vigente_desde: string; canal_nome: string; canal_tipo: 'marketplace' | 'direto'
}
export type Venda = {
  id: string; numero: number; data: string; canal_id: string; canal_taxa_id: string | null; pedido_externo: string | null
  cliente_id: string | null; status: 'aberta' | 'enviada' | 'entregue' | 'cancelada' | 'devolvida'
  receita_bruta: number; desconto: number; receita: number; perc_taxa: number; valor_taxa: number; tarifa_fixa: number
  frete: number; perc_imposto: number; valor_imposto: number; outros_custos: number; custo_produtos: number
  lucro: number; margem: number; forma_pagamento: string | null; observacoes: string | null; motivo_cancelamento: string | null; created_at: string
}

export const custoProduto = (p: Pick<Produto, 'custo_medio' | 'custo_padrao'> & { custo_atual?: number }) =>
  p.custo_atual != null ? Number(p.custo_atual) : Number(p.custo_medio) > 0 ? Number(p.custo_medio) : Number(p.custo_padrao)
/** Saldo vendável (kit: quantos dá para montar com os componentes) */
export const saldoProduto = (p: Pick<Produto, 'saldo'> & { saldo_disponivel?: number }) => Number(p.saldo_disponivel ?? p.saldo)

export const STATUS_VENDA: Record<Venda['status'], { label: string; tone: 'neutral' | 'good' | 'bad' | 'warn' | 'led' }> = {
  aberta: { label: 'Aberta', tone: 'led' },
  enviada: { label: 'Enviada', tone: 'neutral' },
  entregue: { label: 'Entregue', tone: 'good' },
  cancelada: { label: 'Cancelada', tone: 'bad' },
  devolvida: { label: 'Devolvida', tone: 'warn' },
}

export const TIPO_MOV: Record<string, string> = {
  compra: 'Compra', consumo_producao: 'Consumo na produção', entrada_producao: 'Entrada de produção',
  venda: 'Venda', estorno_venda: 'Estorno de venda', devolucao: 'Devolução', perda: 'Perda / quebra',
  ajuste: 'Ajuste', uso_interno: 'Uso interno / amostra', entrada_manual: 'Entrada manual',
}

export const UNIDADES = ['un', 'pç', 'cm', 'm', 'ml', 'l', 'g', 'kg', 'rolo', 'barra', 'caixa', 'pacote', 'chapa']
