import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, RotateCcw } from 'lucide-react'
import { supabase, erroMsg } from '../lib/supabase'
import { hoje, money, parseNum, percent, qty } from '../lib/fmt'
import { custoProduto, saldoProduto, type Cliente, type Produto, type TaxaVigente } from '../lib/types'
import { Button, ErrorBox, Field, Input, NumInput, PageHeader, Panel, Select, Textarea, useToast } from '../components/ui'
import Composicao from '../components/Composicao'
import { CampoConta } from '../components/Contas'
import { useAuth } from '../lib/auth'

type Linha = { key: number; produto_id: string; quantidade: string; preco: string }
const fmtIn = (n: number) => (!Number.isFinite(n) ? '' : Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','))
let seq = 1

export default function NovaVenda() {
  const nav = useNavigate()
  const toast = useToast()
  const [taxas, setTaxas] = useState<TaxaVigente[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [precos, setPrecos] = useState<{ produto_id: string; canal_id: string; preco_venda: number }[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const { empresa } = useAuth()
  const [impostoPadrao, setImpostoPadrao] = useState(0)

  const [data, setData] = useState(hoje())
  const [taxaId, setTaxaId] = useState('')
  const [linhas, setLinhas] = useState<Linha[]>([{ key: seq++, produto_id: '', quantidade: '1', preco: '' }])
  const [percTaxa, setPercTaxa] = useState('0')
  const [tarifa, setTarifa] = useState('0')
  const [frete, setFrete] = useState('0')
  const [imposto, setImposto] = useState('0')
  const [desconto, setDesconto] = useState('0')
  const [outros, setOutros] = useState('0')
  const [pedido, setPedido] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [pagamento, setPagamento] = useState('')
  const [status, setStatus] = useState('aberta')
  const [conta, setConta] = useState('')
  const [obs, setObs] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [confirmarPrejuizo, setConfirmarPrejuizo] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('vw_canal_taxa_vigente').select('*').order('canal_nome').order('perfil'),
      supabase.from('vw_produto_estoque').select('*').eq('ativo', true).order('nome'),
      supabase.from('preco_canal').select('*'),
      supabase.from('cliente').select('*').order('nome'),
    ]).then(([t, p, pc, c]) => {
      setTaxas((t.data ?? []) as TaxaVigente[])
      setProdutos((p.data ?? []) as Produto[])
      setPrecos((pc.data ?? []) as never)
      setClientes((c.data ?? []) as Cliente[])
      const ip = Number(empresa?.imposto_perc ?? 0)
      setImpostoPadrao(ip); setImposto(fmtIn(ip))
      const primeira = (t.data ?? [])[0] as TaxaVigente | undefined
      if (primeira) aplicarCanal(primeira, ip)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const taxa = taxas.find((t) => t.id === taxaId)
  const ehDireto = taxa?.canal_tipo === 'direto'

  function aplicarCanal(t: TaxaVigente, imp = impostoPadrao) {
    setTaxaId(t.id)
    setPercTaxa(fmtIn(Number(t.perc_taxa)))
    setFrete(fmtIn(Number(t.frete_padrao)))
    setImposto(fmtIn(imp))
    setStatus(t.canal_tipo === 'direto' ? 'entregue' : 'aberta')
    // preço do canal nas linhas já escolhidas
    setLinhas((ls) => ls.map((l) => {
      const pc = precos.find((x) => x.produto_id === l.produto_id && x.canal_id === t.canal_id)
      return pc ? { ...l, preco: fmtIn(Number(pc.preco_venda)) } : l
    }))
  }

  // tarifa fixa por unidade, só quando o preço está dentro do limite configurado
  useEffect(() => {
    if (!taxa) return
    const fixo = Number(taxa.tarifa_fixa)
    if (!fixo) { setTarifa('0'); return }
    const lim = taxa.tarifa_ate_preco == null ? Infinity : Number(taxa.tarifa_ate_preco)
    const total = linhas.reduce((s, l) => (parseNum(l.preco) <= lim ? s + parseNum(l.quantidade) * fixo : s), 0)
    setTarifa(fmtIn(total))
  }, [taxa, linhas])

  function escolherProduto(key: number, produto_id: string) {
    const pc = precos.find((x) => x.produto_id === produto_id && x.canal_id === taxa?.canal_id)
    setLinhas((ls) => ls.map((l) => (l.key === key ? { ...l, produto_id, preco: pc ? fmtIn(Number(pc.preco_venda)) : l.preco } : l)))
  }
  const setLinha = (key: number, campo: 'quantidade' | 'preco', v: string) => setLinhas((ls) => ls.map((l) => (l.key === key ? { ...l, [campo]: v } : l)))

  const calc = useMemo(() => {
    const bruta = linhas.reduce((s, l) => s + parseNum(l.quantidade) * parseNum(l.preco), 0)
    const custo = linhas.reduce((s, l) => {
      const p = produtos.find((x) => x.id === l.produto_id)
      return p ? s + parseNum(l.quantidade) * custoProduto(p) : s
    }, 0)
    const receita = bruta - parseNum(desconto)
    const vTaxa = Math.round(receita * parseNum(percTaxa)) / 100
    const vImp = Math.round(receita * parseNum(imposto)) / 100
    const lucro = receita - vTaxa - parseNum(tarifa) - parseNum(frete) - vImp - parseNum(outros) - custo
    return { bruta, custo, receita, vTaxa, vImp, lucro, margem: receita > 0 ? lucro / receita : 0 }
  }, [linhas, produtos, desconto, percTaxa, imposto, tarifa, frete, outros])

  const faltaEstoque = linhas
    .map((l) => ({ l, p: produtos.find((x) => x.id === l.produto_id) }))
    .filter(({ l, p }) => p && parseNum(l.quantidade) > saldoProduto(p))

  async function salvar(outra: boolean) {
    setErro(null)
    const itens = linhas.filter((l) => l.produto_id).map((l) => ({ produto_id: l.produto_id, quantidade: parseNum(l.quantidade), preco_unit: parseNum(l.preco) }))
    if (!taxa) return setErro('Escolha o canal da venda.')
    if (itens.length === 0) return setErro('Adicione pelo menos um produto.')
    if (itens.some((i) => i.quantidade <= 0)) return setErro('A quantidade de cada item precisa ser maior que zero.')
    if (itens.some((i) => i.preco_unit <= 0)) return setErro('Informe o preço de cada item.')
    if (calc.lucro < 0 && !confirmarPrejuizo) { setConfirmarPrejuizo(true); return }
    setSalvando(true)
    const { data: id, error } = await supabase.rpc('registrar_venda', {
      p: {
        data, canal_id: taxa.canal_id, canal_taxa_id: taxa.id, pedido_externo: pedido, cliente_id: clienteId,
        status, desconto: parseNum(desconto), perc_taxa: parseNum(percTaxa), tarifa_fixa: parseNum(tarifa),
        frete: parseNum(frete), perc_imposto: parseNum(imposto), outros_custos: parseNum(outros),
        forma_pagamento: pagamento, conta_id: conta || null, observacoes: obs, itens,
      },
    })
    setSalvando(false)
    if (error) return setErro(erroMsg(error))
    const { data: v } = await supabase.from('venda').select('numero').eq('id', id as string).single()
    toast(`Venda #${v?.numero ?? ''} lançada. Lucro de ${money(calc.lucro)}.`)
    if (outra) {
      setLinhas([{ key: seq++, produto_id: '', quantidade: '1', preco: '' }])
      setPedido(''); setDesconto('0'); setOutros('0'); setObs(''); setClienteId(''); setConfirmarPrejuizo(false)
      const { data: p } = await supabase.from('vw_produto_estoque').select('*').eq('ativo', true).order('nome')
      setProdutos((p ?? []) as Produto[])
    } else nav(`/vendas/${id}`)
  }

  async function repetirUltima() {
    const { data: v } = await supabase.from('venda').select('*, venda_item(*)').neq('status', 'cancelada').order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!v) return toast('Ainda não há vendas para repetir.', 'bad')
    const t = taxas.find((x) => x.id === v.canal_taxa_id) ?? taxas.find((x) => x.canal_id === v.canal_id)
    if (t) aplicarCanal(t)
    setLinhas((v.venda_item as { produto_id: string; quantidade: number; preco_unit: number }[]).map((i) => ({ key: seq++, produto_id: i.produto_id, quantidade: fmtIn(Number(i.quantidade)), preco: fmtIn(Number(i.preco_unit)) })))
    setFrete(fmtIn(Number(v.frete)))
  }

  return (
    <div className="max-lg:pb-16">
      <PageHeader title="Nova venda" sub="A venda baixa o estoque assim que é lançada."
        actions={<Button size="sm" variant="ghost" onClick={repetirUltima}><RotateCcw size={15} /> Repetir última venda</Button>} />

      <div className="grid min-w-0 gap-5 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Canal e data">
            <div className="grid gap-4 p-4 sm:grid-cols-[1fr_170px]">
              <Field label="Onde foi vendido">
                <Select value={taxaId} onChange={(e) => { const t = taxas.find((x) => x.id === e.target.value); if (t) aplicarCanal(t) }}>
                  {taxas.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.canal_nome}{t.perfil !== 'Padrão' ? ` (${t.perfil}, ${qty(t.perc_taxa)}%)` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Data"><Input type="date" value={data} onChange={(e) => setData(e.target.value)} /></Field>
            </div>
          </Panel>

          <Panel title="Produtos">
            <div className="flex flex-col divide-y divide-line">
              {linhas.map((l) => {
                const p = produtos.find((x) => x.id === l.produto_id)
                const semSaldo = p && parseNum(l.quantidade) > saldoProduto(p)
                return (
                  <div key={l.key} className="grid grid-cols-[84px_1fr_auto] items-end gap-3 p-4 sm:grid-cols-[1fr_90px_130px_auto]">
                    <Field label="Produto" className="col-span-3 sm:col-span-1"
                      hint={p && <span className={semSaldo ? 'text-bad' : ''}>{p.tipo === 'kit' ? 'Kits disponíveis' : 'Em estoque'}: {qty(saldoProduto(p))} · custo {money(custoProduto(p))}</span>}>
                      <Select value={l.produto_id} onChange={(e) => escolherProduto(l.key, e.target.value)}>
                        <option value="">Escolha…</option>
                        {produtos.map((x) => <option key={x.id} value={x.id}>{x.nome}{x.sku ? ` (${x.sku})` : ''}</option>)}
                      </Select>
                    </Field>
                    <Field label="Qtd."><NumInput value={l.quantidade} onChange={(v) => setLinha(l.key, 'quantidade', v)} /></Field>
                    <Field label="Preço unit. (R$)"><NumInput value={l.preco} onChange={(v) => setLinha(l.key, 'preco', v)} placeholder="0,00" /></Field>
                    <Button variant="ghost" aria-label="Remover item" disabled={linhas.length === 1}
                      onClick={() => setLinhas((ls) => ls.filter((x) => x.key !== l.key))} className="self-end"><Trash2 size={16} /></Button>
                  </div>
                )
              })}
            </div>
            <div className="border-t border-line p-3">
              <Button size="sm" variant="ghost" onClick={() => setLinhas((ls) => [...ls, { key: seq++, produto_id: '', quantidade: '1', preco: '' }])}><Plus size={15} /> Adicionar produto</Button>
            </div>
          </Panel>

          <Panel title="Custos da venda">
            <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
              <Field label="Taxa do canal (%)" hint={taxa ? `Padrão: ${qty(taxa.perc_taxa)}%` : undefined}><NumInput value={percTaxa} onChange={setPercTaxa} /></Field>
              <Field label="Frete pago por você (R$)" hint={taxa ? `Padrão: ${money(taxa.frete_padrao)}` : undefined}><NumInput value={frete} onChange={setFrete} /></Field>
              <Field label="Tarifa fixa (R$)"><NumInput value={tarifa} onChange={setTarifa} /></Field>
              <Field label="Imposto (%)"><NumInput value={imposto} onChange={setImposto} /></Field>
              <Field label="Desconto dado (R$)"><NumInput value={desconto} onChange={setDesconto} /></Field>
              <Field label="Outros custos (R$)" hint="Embalagem extra, brinde…"><NumInput value={outros} onChange={setOutros} /></Field>
            </div>
          </Panel>

          <Panel title="Detalhes">
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label={ehDireto ? 'Referência (opcional)' : 'Nº do pedido no canal'}><Input value={pedido} onChange={(e) => setPedido(e.target.value)} /></Field>
              <Field label="Situação">
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="aberta">Aberta (a enviar)</option>
                  <option value="enviada">Enviada</option>
                  <option value="entregue">Entregue</option>
                </Select>
              </Field>
              <Field label="Cliente (opcional)">
                <Select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
                  <option value="">Sem cliente</option>
                  {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </Select>
              </Field>
              <Field label="Forma de pagamento">
                <Select value={pagamento} onChange={(e) => setPagamento(e.target.value)}>
                  <option value="">{ehDireto ? 'Escolha…' : 'Pelo canal'}</option>
                  <option>Pix</option><option>Dinheiro</option><option>Cartão de débito</option><option>Cartão de crédito</option><option>Transferência</option>
                </Select>
              </Field>
              <CampoConta label="Dinheiro entra na conta" value={conta} onChange={setConta} />
              <Field label="Observações" className="sm:col-span-2"><Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} /></Field>
            </div>
          </Panel>
        </div>

        {/* Barra de lucro no celular */}
        <div className="fixed inset-x-0 bottom-[calc(57px+env(safe-area-inset-bottom))] z-30 flex items-center justify-between gap-3 border-t border-line bg-panel px-4 py-2.5 lg:hidden">
          <div>
            <p className="text-xs text-muted">Lucro · margem {percent(calc.margem)}</p>
            <p className={`wide num text-xl font-bold leading-tight ${calc.lucro < 0 ? 'text-bad' : ''}`}>{money(calc.lucro)}</p>
          </div>
          <Button variant="primary" disabled={salvando} onClick={() => salvar(false)}>{salvando ? 'Lançando…' : 'Lançar venda'}</Button>
        </div>

        {/* Resumo fixo */}
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Panel>
            <div className="p-4">
              <p className="text-sm text-muted">Lucro desta venda</p>
              <p className={`wide num mt-1 text-[34px] font-bold leading-none ${calc.lucro < 0 ? 'text-bad' : ''}`}>{money(calc.lucro)}</p>
              <p className="num mt-1.5 text-sm text-muted">Margem de {percent(calc.margem)}</p>
              <div className="mt-5"><Composicao receita={calc.receita} custo={calc.custo} taxas={calc.vTaxa + parseNum(tarifa)} frete={parseNum(frete)} imposto={calc.vImp} outros={parseNum(outros)} /></div>
            </div>
            <dl className="num border-t border-line px-4 py-3 text-sm [&>div]:flex [&>div]:justify-between [&>div]:py-1 [&_dt]:text-muted">
              <div><dt>Valor dos produtos</dt><dd>{money(calc.bruta)}</dd></div>
              {parseNum(desconto) > 0 && <div><dt>Desconto</dt><dd>− {money(parseNum(desconto))}</dd></div>}
              <div className="font-medium"><dt className="!text-ink">Receita</dt><dd>{money(calc.receita)}</dd></div>
              <div><dt>Custo dos produtos</dt><dd>− {money(calc.custo)}</dd></div>
              <div><dt>Taxa do canal</dt><dd>− {money(calc.vTaxa)}</dd></div>
              {parseNum(tarifa) > 0 && <div><dt>Tarifa fixa</dt><dd>− {money(parseNum(tarifa))}</dd></div>}
              <div><dt>Frete</dt><dd>− {money(parseNum(frete))}</dd></div>
              {calc.vImp > 0 && <div><dt>Imposto</dt><dd>− {money(calc.vImp)}</dd></div>}
              {parseNum(outros) > 0 && <div><dt>Outros</dt><dd>− {money(parseNum(outros))}</dd></div>}
            </dl>
            <div className="flex flex-col gap-2 border-t border-line p-4">
              {faltaEstoque.length > 0 && (
                <p className="text-sm text-bad">Sem estoque suficiente de {faltaEstoque.map(({ p }) => p!.nome).join(', ')}. Registre a produção ou uma entrada antes.</p>
              )}
              {confirmarPrejuizo && calc.lucro < 0 && (
                <p className="text-sm text-warn">Esta venda dá prejuízo de {money(-calc.lucro)}. Toque em lançar de novo para confirmar.</p>
              )}
              <ErrorBox msg={erro} />
              <Button variant="primary" disabled={salvando} onClick={() => salvar(false)}>{salvando ? 'Lançando…' : 'Lançar venda'}</Button>
              <Button disabled={salvando} onClick={() => salvar(true)}>Lançar e começar outra</Button>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  )
}
