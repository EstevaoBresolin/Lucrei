import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase, erroMsg } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { dataBR, dataHoraBR, hoje, money, parseNum, percent, qty } from '../lib/fmt'
import { STATUS_VENDA, type Venda } from '../lib/types'
import { Badge, Button, ErrorBox, Field, Input, Loading, Modal, NumInput, PageHeader, Panel, Select, Table, Textarea, useToast } from '../components/ui'
import Composicao from '../components/Composicao'

type Det = Venda & {
  canal: { nome: string } | null; cliente: { nome: string; whatsapp: string | null } | null
  venda_item: { id: string; quantidade: number; preco_unit: number; custo_unit_congelado: number; produto: { nome: string; sku: string | null } | null }[]
}
const br = (n: number) => String(n).replace('.', ',')
const PAGTOS = ['Pix', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Transferência']

export default function VendaDetalhe() {
  const { id } = useParams()
  const toast = useToast()
  const { data: v, erro, recarregar } = useLoad<Det>(() => supabase.from('venda').select('*, canal(nome), cliente(nome,whatsapp), venda_item(*, produto(nome,sku))').eq('id', id!).single(), [id])
  const [modal, setModal] = useState<null | 'cancelar' | 'devolver' | 'custos'>(null)
  const [motivo, setMotivo] = useState('')
  const [destino, setDestino] = useState<'estoque' | 'perda'>('estoque')
  const [c, setC] = useState({ perc_taxa: '', tarifa_fixa: '', frete: '', perc_imposto: '', desconto: '', outros_custos: '' })
  const [d, setD] = useState({ data: '', pedido_externo: '', cliente_id: '', forma_pagamento: '', observacoes: '' })
  const clientes = useLoad<{ id: string; nome: string }[]>(() => supabase.from('cliente').select('id,nome').order('nome'), [])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (erro) return <ErrorBox msg={erro} />
  if (!v) return <Loading />
  const ativa = v.status !== 'cancelada' && v.status !== 'devolvida'

  async function run(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setBusy(true); setErr(null)
    const { error } = await fn()
    setBusy(false)
    if (error) return setErr(erroMsg(error))
    setModal(null); setMotivo(''); toast(ok); recarregar()
  }
  const abrirCustos = () => {
    setC({ perc_taxa: br(v.perc_taxa), tarifa_fixa: br(v.tarifa_fixa), frete: br(v.frete), perc_imposto: br(v.perc_imposto), desconto: br(v.desconto), outros_custos: br(v.outros_custos) })
    setD({ data: v.data, pedido_externo: v.pedido_externo ?? '', cliente_id: v.cliente_id ?? '', forma_pagamento: v.forma_pagamento ?? '', observacoes: v.observacoes ?? '' })
    setErr(null); setModal('custos')
  }

  return (
    <div>
      <Link to="/vendas" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Vendas</Link>
      <PageHeader title={`Venda #${v.numero}`}
        sub={<span className="inline-flex flex-wrap items-center gap-2">{dataBR(v.data)} · {v.canal?.nome}{v.pedido_externo && ` · pedido ${v.pedido_externo}`} <Badge tone={STATUS_VENDA[v.status].tone}>{STATUS_VENDA[v.status].label}</Badge></span>}
        actions={ativa && (
          <>
            {v.status === 'aberta' && <Button size="sm" onClick={() => run(() => supabase.rpc('mudar_status_venda', { p_id: v.id, p_status: 'enviada' }), 'Venda marcada como enviada.')}>Marcar como enviada</Button>}
            {v.status !== 'entregue' && <Button size="sm" onClick={() => run(() => supabase.rpc('mudar_status_venda', { p_id: v.id, p_status: 'entregue' }), 'Venda marcada como entregue.')}>Marcar como entregue</Button>}
            <Button size="sm" onClick={abrirCustos}>Editar venda</Button>
            <Button size="sm" onClick={() => { setErr(null); setModal('devolver') }}>Registrar devolução</Button>
            <Button size="sm" variant="ghost" className="text-bad" onClick={() => { setErr(null); setModal('cancelar') }}>Cancelar venda</Button>
          </>
        )} />
      {!ativa && v.motivo_cancelamento && <p className="-mt-3 mb-5 text-sm text-muted">Motivo: {v.motivo_cancelamento}</p>}
      <ErrorBox msg={modal ? null : err} />

      <div className="grid min-w-0 gap-5 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Itens">
            <Table head={<tr><th>Produto</th><th className="text-right">Qtd.</th><th className="text-right">Preço</th><th className="text-right">Custo unit.</th><th className="text-right">Subtotal</th></tr>}>
              {v.venda_item.map((i) => (
                <tr key={i.id}>
                  <td className="font-medium">{i.produto?.nome}</td>
                  <td className="num text-right">{qty(i.quantidade)}</td>
                  <td className="num text-right">{money(i.preco_unit)}</td>
                  <td className="num text-right text-muted">{money(i.custo_unit_congelado)}</td>
                  <td className="num text-right">{money(Number(i.quantidade) * Number(i.preco_unit))}</td>
                </tr>
              ))}
            </Table>
            <p className="border-t border-line px-4 py-2.5 text-xs text-muted">O custo de cada item ficou registrado no dia da venda e não muda se o custo dos produtos mudar depois.</p>
          </Panel>
          <Panel title="Detalhes">
            <dl className="grid gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2 [&_dt]:text-muted">
              <div><dt>Cliente</dt><dd>{v.cliente?.nome ?? 'Não informado'}</dd></div>
              <div><dt>Pagamento</dt><dd>{v.forma_pagamento ?? 'Pelo canal'}</dd></div>
              <div><dt>Lançada em</dt><dd>{dataHoraBR(v.created_at)}</dd></div>
              {v.observacoes && <div className="sm:col-span-2"><dt>Observações</dt><dd className="whitespace-pre-wrap">{v.observacoes}</dd></div>}
            </dl>
          </Panel>
        </div>
        <Panel>
          <div className="p-4">
            <p className="text-sm text-muted">Lucro</p>
            <p className={`wide num mt-1 text-[32px] font-bold leading-none ${Number(v.lucro) < 0 ? 'text-bad' : ''}`}>{money(v.lucro)}</p>
            <p className="num mt-1.5 text-sm text-muted">Margem de {percent(v.margem)}</p>
            <div className="mt-5"><Composicao receita={Number(v.receita)} custo={Number(v.custo_produtos)} taxas={Number(v.valor_taxa) + Number(v.tarifa_fixa)} frete={Number(v.frete)} imposto={Number(v.valor_imposto)} outros={Number(v.outros_custos)} /></div>
          </div>
          <dl className="num border-t border-line px-4 py-3 text-sm [&>div]:flex [&>div]:justify-between [&>div]:py-1 [&_dt]:text-muted">
            <div><dt>Valor dos produtos</dt><dd>{money(v.receita_bruta)}</dd></div>
            {Number(v.desconto) > 0 && <div><dt>Desconto</dt><dd>− {money(v.desconto)}</dd></div>}
            <div className="font-medium"><dt className="!text-ink">Receita</dt><dd>{money(v.receita)}</dd></div>
            <div><dt>Custo dos produtos</dt><dd>− {money(v.custo_produtos)}</dd></div>
            <div><dt>Taxa do canal ({qty(v.perc_taxa)}%)</dt><dd>− {money(v.valor_taxa)}</dd></div>
            {Number(v.tarifa_fixa) > 0 && <div><dt>Tarifa fixa</dt><dd>− {money(v.tarifa_fixa)}</dd></div>}
            <div><dt>Frete</dt><dd>− {money(v.frete)}</dd></div>
            {Number(v.valor_imposto) > 0 && <div><dt>Imposto ({qty(v.perc_imposto)}%)</dt><dd>− {money(v.valor_imposto)}</dd></div>}
            {Number(v.outros_custos) > 0 && <div><dt>Outros</dt><dd>− {money(v.outros_custos)}</dd></div>}
          </dl>
        </Panel>
      </div>

      <Modal open={modal === 'cancelar'} onClose={() => setModal(null)} title={`Cancelar venda #${v.numero}`}
        footer={<><Button onClick={() => setModal(null)}>Voltar</Button><Button variant="danger" disabled={busy || !motivo.trim()} onClick={() => run(() => supabase.rpc('cancelar_venda', { p_id: v.id, p_motivo: motivo }), 'Venda cancelada. Os produtos voltaram ao estoque.')}>Cancelar venda</Button></>}>
        <p className="mb-4 text-sm text-muted">Os produtos voltam ao estoque e a venda sai dos relatórios. O registro fica no histórico.</p>
        <Field label="Motivo"><Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: comprador desistiu antes do envio" /></Field>
        <div className="mt-3"><ErrorBox msg={err} /></div>
      </Modal>

      <Modal open={modal === 'devolver'} onClose={() => setModal(null)} title={`Devolução da venda #${v.numero}`}
        footer={<><Button onClick={() => setModal(null)}>Voltar</Button><Button variant="primary" disabled={busy || !motivo.trim()} onClick={() => run(() => supabase.rpc('devolver_venda', { p_id: v.id, p_destino: destino, p_motivo: motivo }), 'Devolução registrada.')}>Registrar devolução</Button></>}>
        <div className="flex flex-col gap-4">
          <Field label="O que aconteceu com o produto devolvido?">
            <Select value={destino} onChange={(e) => setDestino(e.target.value as 'estoque' | 'perda')}>
              <option value="estoque">Está em bom estado: volta ao estoque</option>
              <option value="perda">Chegou danificado: vira perda</option>
            </Select>
          </Field>
          <Field label="Motivo"><Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: produto com defeito" /></Field>
          <ErrorBox msg={err} />
        </div>
      </Modal>

      <Modal open={modal === 'custos'} onClose={() => setModal(null)} title={`Editar venda #${v.numero}`} wide
        footer={<><Button onClick={() => setModal(null)}>Voltar</Button><Button variant="primary" disabled={busy} onClick={() => { if (!d.data || d.data > hoje()) return setErr('A data da venda não pode ficar vazia nem no futuro.'); if (parseNum(c.perc_taxa) > 100 || parseNum(c.perc_imposto) > 100) return setErr('Taxa e imposto precisam ficar entre 0 e 100%.'); run(() => supabase.rpc('atualizar_custos_venda', { p_id: v.id, p: { ...Object.fromEntries(Object.entries(c).map(([k, x]) => [k, parseNum(x)])), ...d } }), 'Venda atualizada e lucro recalculado.') }}>Salvar e recalcular</Button></>}>
        <p className="mb-4 text-sm text-muted">Produtos e quantidades não mudam aqui, porque já baixaram o estoque. Se o item estiver errado, cancele a venda e lance de novo.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Data"><Input type="date" max={hoje()} value={d.data} onChange={(e) => setD({ ...d, data: e.target.value })} /></Field>
          <Field label="Nº do pedido no canal"><Input value={d.pedido_externo} onChange={(e) => setD({ ...d, pedido_externo: e.target.value })} /></Field>
          <Field label="Cliente">
            <Select value={d.cliente_id} onChange={(e) => setD({ ...d, cliente_id: e.target.value })}>
              <option value="">Sem cliente</option>
              {(clientes.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </Select>
          </Field>
          <Field label="Forma de pagamento">
            <Select value={d.forma_pagamento} onChange={(e) => setD({ ...d, forma_pagamento: e.target.value })}>
              <option value="">Pelo canal</option>
              {PAGTOS.map((x) => <option key={x}>{x}</option>)}
              {d.forma_pagamento && !PAGTOS.includes(d.forma_pagamento) && <option>{d.forma_pagamento}</option>}
            </Select>
          </Field>
          <Field label="Observações" className="sm:col-span-2"><Textarea value={d.observacoes} onChange={(e) => setD({ ...d, observacoes: e.target.value })} rows={2} /></Field>
        </div>
        <p className="mb-3 mt-5 text-sm font-medium">Custos</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Taxa do canal (%)"><NumInput value={c.perc_taxa} onChange={(x) => setC({ ...c, perc_taxa: x })} /></Field>
          <Field label="Frete (R$)"><NumInput value={c.frete} onChange={(x) => setC({ ...c, frete: x })} /></Field>
          <Field label="Tarifa fixa (R$)"><NumInput value={c.tarifa_fixa} onChange={(x) => setC({ ...c, tarifa_fixa: x })} /></Field>
          <Field label="Imposto (%)"><NumInput value={c.perc_imposto} onChange={(x) => setC({ ...c, perc_imposto: x })} /></Field>
          <Field label="Desconto (R$)"><NumInput value={c.desconto} onChange={(x) => setC({ ...c, desconto: x })} /></Field>
          <Field label="Outros custos (R$)"><NumInput value={c.outros_custos} onChange={(x) => setC({ ...c, outros_custos: x })} /></Field>
        </div>
        <div className="mt-3"><ErrorBox msg={err} /></div>
      </Modal>
    </div>
  )
}
