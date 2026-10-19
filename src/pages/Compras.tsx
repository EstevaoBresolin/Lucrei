import { Fragment, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, MessageCircle, Pencil } from 'lucide-react'
import { supabase, erroMsg } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { useAuth } from '../lib/auth'
import { dataBR, hoje, money, parseNum, qty } from '../lib/fmt'
import type { Fornecedor, Material, Produto } from '../lib/types'
import { Badge, Button, Empty, ErrorBox, Field, Input, Loading, Modal, NumInput, PageHeader, Panel, Select, Table, useConfirm, useToast } from '../components/ui'
import { CampoConta } from '../components/Contas'

type ItemCompra = {
  item_tipo: 'material' | 'produto'; material_id: string | null; produto_id: string | null
  qtd_compra: number; preco_unit_compra: number; custo_unit_final: number | null
  material: { nome: string; unidade_compra: string; unidade_uso: string } | null; produto: { nome: string } | null
}
type Compra = {
  id: string; numero: number; data: string; status: 'pedida' | 'recebida' | 'parcial' | 'cancelada'; fornecedor_id: string | null
  criterio_rateio: string; forma_pagamento: string | null; conta_id: string | null; frete: number; outras_despesas: number; desconto: number
  nf_numero: string | null; fornecedor: { nome: string } | null; compra_item: ItemCompra[]
}
/** item = "p:<id do produto>" ou "m:<id do insumo>" */
type ItemIni = { item: string; qtd: string; preco: string }
/** Dados para abrir o formulário: compra nova (sem id, opcionalmente com itens sugeridos) ou edição de uma compra pedida. */
type Ini = { id?: string; numero?: number; fornecedor_id: string; itens: ItemIni[]; data?: string; frete?: string; outras?: string; desconto?: string; rateio?: string; nf?: string; pagamento?: string; conta?: string }
type Sugerido = { chave: string; nome: string; unidade: string; saldo: number; minimo: number; qtd: number; preco: string; fornecedor_id: string | null }

const brs = (n: number) => String(Number(n)).replace('.', ',')
const ST = { pedida: { l: 'Pedida', t: 'led' }, recebida: { l: 'Recebida', t: 'good' }, parcial: { l: 'Parcial', t: 'warn' }, cancelada: { l: 'Cancelada', t: 'bad' } } as const
const totalCompra = (c: Compra) => c.compra_item.reduce((s, i) => s + Number(i.qtd_compra) * Number(i.preco_unit_compra), 0) + Number(c.frete) + Number(c.outras_despesas) - Number(c.desconto)
const nomeItem = (i: ItemCompra) => i.material?.nome ?? i.produto?.nome ?? '?'
const unidadeCompra = (i: ItemCompra) => i.material?.unidade_compra ?? 'un'

export default function Compras() {
  const toast = useToast()
  const confirmar = useConfirm()
  const { modulo, podeEditar } = useAuth()
  const insumos = modulo('producao')
  const compras = useLoad<Compra[]>(() => supabase.from('compra')
    .select('*, fornecedor(nome), compra_item(item_tipo, material_id, produto_id, qtd_compra, preco_unit_compra, custo_unit_final, material(nome, unidade_compra, unidade_uso), produto(nome))')
    .order('data', { ascending: false }).order('numero', { ascending: false }).limit(100), [])
  const mats = useLoad<Material[]>(() => supabase.from('material').select('*').eq('ativo', true), [])
  const prods = useLoad<Produto[]>(() => supabase.from('produto').select('*').eq('ativo', true).eq('tipo', 'revenda'), [])
  const forns = useLoad<Fornecedor[]>(() => supabase.from('fornecedor').select('*'), [])
  const [nova, setNova] = useState<Ini | null>(null)
  const [aberta, setAberta] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  // Itens no estoque mínimo, agrupados por fornecedor principal
  const sugestao = useMemo(() => {
    const itens: Sugerido[] = []
    for (const p of prods.data ?? []) if (Number(p.estoque_minimo) > 0 && Number(p.saldo) <= Number(p.estoque_minimo))
      itens.push({ chave: `p:${p.id}`, nome: p.nome, unidade: 'un', saldo: Number(p.saldo), minimo: Number(p.estoque_minimo), qtd: Math.max(1, Math.ceil(Number(p.estoque_minimo) * 2 - Number(p.saldo))), preco: Number(p.custo_medio || p.custo_padrao) ? brs(Math.round(Number(p.custo_medio || p.custo_padrao) * 100) / 100) : '', fornecedor_id: p.fornecedor_padrao_id })
    if (insumos) for (const m of mats.data ?? []) if (Number(m.estoque_minimo) > 0 && Number(m.saldo) <= Math.max(Number(m.ponto_reposicao), Number(m.estoque_minimo)))
      itens.push({ chave: `m:${m.id}`, nome: m.nome, unidade: m.unidade_compra, saldo: Number(m.saldo), minimo: Number(m.estoque_minimo), qtd: Math.max(1, Math.ceil((Number(m.estoque_minimo) * 2 - Number(m.saldo)) / Number(m.fator_conversao))), preco: m.ultimo_custo ? brs(Math.round(Number(m.ultimo_custo) * Number(m.fator_conversao) * 100) / 100) : '', fornecedor_id: m.fornecedor_padrao_id })
    const grupos = new Map<string, { id: string; nome: string; whatsapp: string | null; itens: Sugerido[] }>()
    for (const i of itens) {
      const k = i.fornecedor_id ?? ''
      const f = (forns.data ?? []).find((x) => x.id === k)
      if (!grupos.has(k)) grupos.set(k, { id: k, nome: f?.nome ?? 'Sem fornecedor definido', whatsapp: f?.whatsapp ?? null, itens: [] })
      grupos.get(k)!.itens.push(i)
    }
    return [...grupos.values()]
  }, [mats.data, prods.data, forns.data, insumos])

  const recarregar = () => { compras.recarregar(); mats.recarregar(); prods.recarregar() }
  async function receber(c: Compra) {
    setErro(null)
    const { error } = await supabase.rpc('receber_compra', { p_compra: c.id })
    if (error) return setErro(erroMsg(error))
    toast(`Compra #${c.numero} recebida. Os itens entraram no estoque.`); recarregar()
  }
  async function excluir(c: Compra) {
    if (!(await confirmar({ titulo: `Excluir a compra #${c.numero}?`, mensagem: 'A compra e os itens dela são apagados. Nada muda no estoque, porque ela ainda não foi recebida.' }))) return
    setErro(null)
    const { error } = await supabase.rpc('excluir_compra', { p_id: c.id })
    if (error) return setErro(erroMsg(error))
    toast(`Compra #${c.numero} excluída.`); compras.recarregar()
  }
  const editar = (c: Compra) => setNova({
    id: c.id, numero: c.numero, fornecedor_id: c.fornecedor_id ?? '', data: c.data, frete: brs(c.frete), outras: brs(c.outras_despesas), desconto: brs(c.desconto),
    rateio: c.criterio_rateio, nf: c.nf_numero ?? '', pagamento: c.forma_pagamento ?? '', conta: c.conta_id ?? '',
    itens: c.compra_item.map((i) => ({ item: i.item_tipo === 'produto' ? `p:${i.produto_id}` : `m:${i.material_id}`, qtd: brs(i.qtd_compra), preco: brs(i.preco_unit_compra) })),
  })

  return (
    <div>
      <PageHeader title="Compras" sub={insumos ? 'Compras de produtos prontos e de insumos. O frete é dividido no custo de cada item.' : 'O que você compra para revender. O frete e as despesas da compra entram no custo de cada produto.'}
        actions={podeEditar && <Button variant="primary" size="sm" onClick={() => setNova({ fornecedor_id: '', itens: [] })}><Plus size={15} /> Nova compra</Button>} />
      <ErrorBox msg={erro} />
      {podeEditar && sugestao.length > 0 && (
        <Panel title="Precisa comprar" className="mb-5">
          <div className="divide-y divide-line">
            {sugestao.map((g) => {
              const msg = `Olá! Gostaria de fazer um pedido:\n${g.itens.map((i) => `- ${i.qtd} ${i.unidade} de ${i.nome}`).join('\n')}`
              return (
                <div key={g.id} className="p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{g.nome}</p>
                    <div className="flex gap-2">
                      {g.whatsapp && <a className="inline-flex h-8 items-center gap-1.5 rounded-box border border-line px-3 text-sm hover:border-muted" target="_blank" rel="noreferrer" href={`https://wa.me/55${g.whatsapp.replace(/\D/g, '').replace(/^55/, '')}?text=${encodeURIComponent(msg)}`}><MessageCircle size={15} /> Pedir no WhatsApp</a>}
                      <Button size="sm" onClick={() => setNova({ fornecedor_id: g.id, itens: g.itens.map((i) => ({ item: i.chave, qtd: String(i.qtd), preco: i.preco })) })}>Lançar compra</Button>
                    </div>
                  </div>
                  <ul className="num text-sm text-muted">
                    {g.itens.map((i) => <li key={i.chave}>{i.nome}: tem {qty(i.saldo)}, mínimo {qty(i.minimo)}. Sugestão: {i.qtd} {i.unidade}</li>)}
                  </ul>
                </div>
              )
            })}
          </div>
        </Panel>
      )}
      <Panel>
        {compras.carregando && !compras.data ? <Loading /> : (compras.data ?? []).length === 0 ? <Empty title="Nenhuma compra lançada">Lance as compras para o estoque e o custo de cada produto ficarem certos.</Empty> : (
          <Table head={<tr><th>Nº</th><th>Data</th><th>Fornecedor</th><th>Itens</th><th>Situação</th><th className="text-right">Total</th><th /></tr>}>
            {(compras.data ?? []).map((c) => (
              <Fragment key={c.id}>
                <tr onClick={() => setAberta(aberta === c.id ? null : c.id)} className="cursor-pointer hover:bg-line/30">
                  <td className="num font-medium">#{c.numero}</td>
                  <td className="num">{dataBR(c.data)}</td>
                  <td>{c.fornecedor?.nome ?? '–'}</td>
                  <td className="max-w-64 truncate">{c.compra_item.map(nomeItem).join(', ')}</td>
                  <td><Badge tone={ST[c.status].t}>{ST[c.status].l}</Badge></td>
                  <td className="num text-right">{money(totalCompra(c))}</td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    {podeEditar && (
                      <div className="flex justify-end gap-1.5">
                        {c.status === 'pedida' && <Button size="sm" variant="primary" onClick={() => receber(c)}>Receber</Button>}
                        {c.status === 'pedida' && <Button size="sm" variant="ghost" aria-label={`Editar compra ${c.numero}`} onClick={() => editar(c)}><Pencil size={15} /></Button>}
                        {(c.status === 'pedida' || c.status === 'cancelada') && <Button size="sm" variant="ghost" className="hover:text-bad" aria-label={`Excluir compra ${c.numero}`} onClick={() => excluir(c)}><Trash2 size={15} /></Button>}
                      </div>
                    )}
                  </td>
                </tr>
                {aberta === c.id && (
                  <tr><td colSpan={7} className="bg-base/50">
                    <ul className="num space-y-1 text-sm">
                      {c.compra_item.map((i, k) => (
                        <li key={k}>{qty(i.qtd_compra)} {unidadeCompra(i)} de {nomeItem(i)} a {money(i.preco_unit_compra)}{i.custo_unit_final != null && <span className="text-muted">, custo final {money(i.custo_unit_final)}/{i.material?.unidade_uso ?? 'un'} com frete</span>}</li>
                      ))}
                      {Number(c.frete) > 0 && <li className="text-muted">Frete: {money(c.frete)}</li>}
                      {c.status === 'recebida' && <li className="text-xs text-muted">Compra recebida não pode ser editada nem excluída, porque os itens já entraram no estoque. Para corrigir saldo, use Estoque → Movimentar.</li>}
                      {c.nf_numero && <li className="text-muted">NF {c.nf_numero}</li>}
                    </ul>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </Table>
        )}
      </Panel>
      <NovaCompra ini={nova} onClose={() => setNova(null)} onSaved={() => { setNova(null); recarregar() }} />
    </div>
  )
}

function NovaCompra({ ini, onClose, onSaved }: { ini: Ini | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const { modulo } = useAuth()
  const [forns, setForns] = useState<Fornecedor[]>([])
  const [mats, setMats] = useState<Material[]>([])
  const [prods, setProds] = useState<Produto[]>([])
  const [f, setF] = useState({ fornecedor_id: '', data: hoje(), frete: '0', outras: '0', desconto: '0', rateio: 'valor', nf: '', pagamento: '', conta: '' })
  const [itens, setItens] = useState<ItemIni[]>([])
  const [receberJa, setReceberJa] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!ini) return
    supabase.from('fornecedor').select('*').eq('ativo', true).order('nome').then(({ data }) => setForns((data ?? []) as Fornecedor[]))
    if (modulo('producao')) supabase.from('material').select('*').eq('ativo', true).order('nome').then(({ data }) => setMats((data ?? []) as Material[]))
    // Produto fabricado também pode ser comprado pronto (ex.: terceirizado); kit não, ele é formado por outros produtos.
    supabase.from('produto').select('*').eq('ativo', true).neq('tipo', 'kit').order('nome').then(({ data }) => setProds((data ?? []) as Produto[]))
    setF({ fornecedor_id: ini.fornecedor_id, data: ini.data ?? hoje(), frete: ini.frete ?? '0', outras: ini.outras ?? '0', desconto: ini.desconto ?? '0', rateio: ini.rateio ?? 'valor', nf: ini.nf ?? '', pagamento: ini.pagamento ?? '', conta: ini.conta ?? '' })
    setItens(ini.itens.length ? ini.itens : [{ item: '', qtd: '', preco: '' }])
    setReceberJa(!ini.id)
    setErro(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ini])
  if (!ini) return null

  const subtotal = itens.reduce((s, i) => s + parseNum(i.qtd) * parseNum(i.preco), 0)
  const total = subtotal + parseNum(f.frete) + parseNum(f.outras) - parseNum(f.desconto)
  const setItem = (k: number, campo: keyof ItemIni, v: string) => setItens(itens.map((x, j) => (j === k ? { ...x, [campo]: v } : x)))
  const insumo = (chave: string) => (chave.startsWith('m:') ? mats.find((x) => x.id === chave.slice(2)) : undefined)

  async function salvar() {
    const validos = itens.filter((i) => i.item && parseNum(i.qtd) > 0)
    if (validos.length === 0) return setErro('Adicione pelo menos um item com quantidade.')
    if (itens.some((i) => i.item && !(parseNum(i.qtd) > 0))) return setErro('Informe a quantidade de cada item (ou remova a linha).')
    if (validos.some((i) => !(parseNum(i.preco) > 0))) return setErro('Informe o preço de cada item. Sem preço o item entra com custo zero e derruba o custo médio.')
    if (!f.data) return setErro('Informe a data da compra.')
    if (total < 0) return setErro('O desconto não pode ser maior que o total da compra.')
    setBusy(true); setErro(null)
    const cab = {
      fornecedor_id: f.fornecedor_id || null, data: f.data, frete: parseNum(f.frete), outras_despesas: parseNum(f.outras),
      desconto: parseNum(f.desconto), criterio_rateio: f.rateio, nf_numero: f.nf || null, forma_pagamento: f.pagamento || null, conta_id: f.conta || null,
    }
    const c = ini?.id
      ? await supabase.from('compra').update(cab).eq('id', ini.id).eq('status', 'pedida').select('id, numero').single()
      : await supabase.from('compra').insert(cab).select('id, numero').single()
    if (c.error) { setBusy(false); return setErro(erroMsg(c.error)) }
    if (ini?.id) {
      const del = await supabase.from('compra_item').delete().eq('compra_id', ini.id)
      if (del.error) { setBusy(false); return setErro(erroMsg(del.error)) }
    }
    const it = await supabase.from('compra_item').insert(validos.map((i) => {
      const produto = i.item.startsWith('p:')
      return { compra_id: c.data.id, item_tipo: produto ? 'produto' : 'material', produto_id: produto ? i.item.slice(2) : null, material_id: produto ? null : i.item.slice(2), qtd_compra: parseNum(i.qtd), preco_unit_compra: parseNum(i.preco) }
    }))
    if (it.error) { setBusy(false); return setErro(erroMsg(it.error)) }
    if (receberJa) {
      const r = await supabase.rpc('receber_compra', { p_compra: c.data.id })
      if (r.error) { setBusy(false); return setErro(erroMsg(r.error)) }
    }
    setBusy(false)
    toast(ini?.id ? (receberJa ? `Compra #${c.data.numero} salva e recebida.` : `Compra #${c.data.numero} salva.`)
      : receberJa ? `Compra #${c.data.numero} lançada e recebida.` : `Compra #${c.data.numero} lançada como pedida.`)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={ini.id ? `Editar compra #${ini.numero}` : 'Nova compra'} wide
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={busy} onClick={salvar}>{ini.id ? 'Salvar compra' : 'Lançar compra'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Fornecedor" className="sm:col-span-2"><Select value={f.fornecedor_id} onChange={(e) => setF({ ...f, fornecedor_id: e.target.value })}><option value="">Não informado</option>{forns.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
        <Field label="Data"><Input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></Field>
      </div>
      <div className="mt-5 flex flex-col gap-3">
        {itens.map((i, k) => {
          const m = insumo(i.item)
          const un = m?.unidade_compra ?? 'unid.'
          return (
            <div key={k} className="grid grid-cols-[1fr_1fr_auto] gap-2 sm:grid-cols-[1fr_120px_140px_auto] sm:items-end">
              <Field label="Item" className="col-span-3 sm:col-span-1"
                hint={m && Number(m.fator_conversao) !== 1 && parseNum(i.qtd) > 0 ? `Entra ${qty(parseNum(i.qtd) * Number(m.fator_conversao))} ${m.unidade_uso} no estoque` : undefined}>
                <Select value={i.item} onChange={(e) => setItem(k, 'item', e.target.value)}>
                  <option value="">Escolha…</option>
                  {prods.length > 0 && <optgroup label="Produtos">{prods.map((x) => <option key={x.id} value={`p:${x.id}`}>{x.nome}</option>)}</optgroup>}
                  {mats.length > 0 && <optgroup label="Insumos">{mats.map((x) => <option key={x.id} value={`m:${x.id}`}>{x.nome}</option>)}</optgroup>}
                </Select>
              </Field>
              <Field label={`Qtd. (${un})`}><NumInput value={i.qtd} onChange={(v) => setItem(k, 'qtd', v)} /></Field>
              <Field label={`Preço por ${un}`}><NumInput value={i.preco} onChange={(v) => setItem(k, 'preco', v)} /></Field>
              <Button variant="ghost" aria-label="Remover" disabled={itens.length === 1} onClick={() => setItens(itens.filter((_, j) => j !== k))}><Trash2 size={16} /></Button>
            </div>
          )
        })}
        <Button size="sm" variant="ghost" className="self-start" onClick={() => setItens([...itens, { item: '', qtd: '', preco: '' }])}><Plus size={15} /> Adicionar item</Button>
        {prods.length === 0 && mats.length === 0 && <p className="text-sm text-muted">Cadastre os produtos{modulo('producao') ? ' ou insumos' : ''} antes de lançar a compra.</p>}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Frete (R$)"><NumInput value={f.frete} onChange={(v) => setF({ ...f, frete: v })} /></Field>
        <Field label="Outras despesas (R$)"><NumInput value={f.outras} onChange={(v) => setF({ ...f, outras: v })} /></Field>
        <Field label="Desconto (R$)"><NumInput value={f.desconto} onChange={(v) => setF({ ...f, desconto: v })} /></Field>
        <Field label="Dividir frete por"><Select value={f.rateio} onChange={(e) => setF({ ...f, rateio: e.target.value })}><option value="valor">Valor dos itens</option><option value="quantidade">Quantidade</option></Select></Field>
        <Field label="Nº da nota fiscal"><Input value={f.nf} onChange={(e) => setF({ ...f, nf: e.target.value })} /></Field>
        <Field label="Pagamento"><Select value={f.pagamento} onChange={(e) => setF({ ...f, pagamento: e.target.value })}><option value="">–</option><option>Pix</option><option>Boleto</option><option>Cartão de crédito</option><option>Dinheiro</option></Select></Field>
        <CampoConta label="Saiu da conta" value={f.conta} onChange={(v) => setF({ ...f, conta: v })} />
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={receberJa} onChange={(e) => setReceberJa(e.target.checked)} /> Já recebi: dar entrada no estoque agora</label>
        <p className="num text-sm">Total <span className="wide ml-1 text-lg font-bold">{money(total)}</span></p>
      </div>
      <div className="mt-3"><ErrorBox msg={erro} /></div>
    </Modal>
  )
}
