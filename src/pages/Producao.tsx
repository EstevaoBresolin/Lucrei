import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase, erroMsg } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { dataBR, hoje, money, parseNum, qty } from '../lib/fmt'
import type { Produto } from '../lib/types'
import { Badge, BotaoExcluir, Button, Empty, ErrorBox, Field, Input, Loading, Modal, NumInput, PageHeader, Panel, Select, Table, Textarea, useConfirm, useToast } from '../components/ui'

type Ordem = { id: string; numero: number; produto_id: string; quantidade: number; status: 'planejada' | 'em_montagem' | 'concluida' | 'cancelada'; data_planejada: string; data_conclusao: string | null; observacoes: string | null; custo_total_real: number | null; produto: { nome: string } | null }
type Nec = { material_id: string; nome: string; unidade: string; necessario: number; saldo: number; falta: number }
const ST = { planejada: { l: 'Planejada', t: 'neutral' }, em_montagem: { l: 'Em produção', t: 'led' }, concluida: { l: 'Concluída', t: 'good' }, cancelada: { l: 'Cancelada', t: 'bad' } } as const

export default function Producao() {
  const toast = useToast()
  const confirmar = useConfirm()
  const ordens = useLoad<Ordem[]>(() => supabase.from('ordem_producao').select('*, produto(nome)').order('created_at', { ascending: false }).limit(100), [])
  const cap = useLoad<{ produto_id: string; produto: string; unidades: number; material_limitante: string }[]>(() => supabase.rpc('capacidade_producao'), [])
  const [nova, setNova] = useState<Ordem | 'nova' | null>(null)
  const [concluir, setConcluir] = useState<Ordem | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const recarregar = () => { ordens.recarregar(); cap.recarregar() }

  async function status(o: Ordem, s: 'em_montagem' | 'cancelada') {
    const { error } = await supabase.from('ordem_producao').update({ status: s }).eq('id', o.id)
    if (error) return setErro(erroMsg(error))
    toast(s === 'cancelada' ? `Ordem #${o.numero} cancelada.` : `Ordem #${o.numero} em produção.`); recarregar()
  }

  async function excluir(o: Ordem) {
    if (!(await confirmar({ titulo: `Excluir a ordem #${o.numero}?`, mensagem: 'Nada muda no estoque, porque a ordem não foi concluída.' }))) return
    setErro(null)
    const { error } = await supabase.rpc('excluir_ordem_producao', { p_id: o.id })
    if (error) return setErro(erroMsg(error))
    toast(`Ordem #${o.numero} excluída.`); setNova(null); recarregar()
  }

  const abertas = (ordens.data ?? []).filter((o) => o.status === 'planejada' || o.status === 'em_montagem')
  const fechadas = (ordens.data ?? []).filter((o) => o.status === 'concluida' || o.status === 'cancelada')

  return (
    <div>
      <PageHeader title="Produção" sub="Ao concluir uma ordem, os insumos saem do estoque e os produtos prontos entram com o custo real."
        actions={<Button variant="primary" size="sm" onClick={() => setNova('nova')}><Plus size={15} /> Nova ordem</Button>} />
      <ErrorBox msg={erro} />
      <div className="grid min-w-0 gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Em andamento">
            {ordens.carregando && !ordens.data ? <Loading /> : abertas.length === 0 ? <Empty title="Nenhuma ordem aberta">Crie uma ordem quando for montar um lote.</Empty> : (
              <ul className="divide-y divide-line">
                {abertas.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="font-medium">{qty(o.quantidade)} × {o.produto?.nome}</p>
                      <p className="text-sm text-muted">Ordem #{o.numero} · {dataBR(o.data_planejada)} <Badge tone={ST[o.status].t}>{ST[o.status].l}</Badge></p>
                      {o.observacoes && <p className="mt-0.5 text-xs text-muted">{o.observacoes}</p>}
                    </div>
                    <div className="flex gap-2">
                      {o.status === 'planejada' && <Button size="sm" onClick={() => status(o, 'em_montagem')}>Iniciar produção</Button>}
                      <Button size="sm" variant="primary" onClick={() => setConcluir(o)}>Concluir</Button>
                      <Button size="sm" variant="ghost" aria-label={`Editar ordem ${o.numero}`} onClick={() => setNova(o)}><Pencil size={15} /></Button>
                      <Button size="sm" variant="ghost" onClick={() => status(o, 'cancelada')}>Cancelar</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Histórico">
            {fechadas.length === 0 ? <Empty title="Nenhuma ordem concluída ainda" /> : (
              <Table head={<tr><th>Ordem</th><th>Produto</th><th className="text-right">Qtd.</th><th>Concluída</th><th className="text-right">Custo total</th><th className="text-right">Custo unit.</th><th /></tr>}>
                {fechadas.map((o) => (
                  <tr key={o.id} className={o.status === 'cancelada' ? 'text-muted' : ''}>
                    <td className="num">#{o.numero}</td><td className="font-medium">{o.produto?.nome}</td><td className="num text-right">{qty(o.quantidade)}</td>
                    <td>{o.status === 'cancelada' ? <Badge tone="bad">Cancelada</Badge> : dataBR(o.data_conclusao)}</td>
                    <td className="num text-right">{o.custo_total_real != null ? money(o.custo_total_real) : '–'}</td>
                    <td className="num text-right">{o.custo_total_real != null ? money(Number(o.custo_total_real) / Number(o.quantidade)) : '–'}</td>
                    <td className="w-10">{o.status === 'cancelada' && <button aria-label={`Excluir ordem ${o.numero}`} onClick={() => excluir(o)} className="text-muted hover:text-bad"><Trash2 size={15} /></button>}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
        </div>
        <Panel title="Dá para montar agora">
          {(cap.data ?? []).length === 0 ? <Empty title="Sem fichas técnicas">Cadastre os insumos de cada produto em <Link to="/produtos" className="underline">Produtos</Link> para ver quanto dá para montar.</Empty> : (
            <ul className="divide-y divide-line">
              {(cap.data ?? []).map((c) => (
                <li key={c.produto_id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div><p className="font-medium">{c.produto}</p><p className="text-xs text-muted">Limitado por {c.material_limitante}</p></div>
                  <span className={`wide num text-xl font-bold ${Number(c.unidades) === 0 ? 'text-bad' : ''}`}>{qty(c.unidades)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <NovaOrdem open={nova !== null} ordem={nova === 'nova' ? null : nova} onClose={() => setNova(null)} onSaved={() => { setNova(null); recarregar() }} onExcluir={excluir} />
      <Concluir ordem={concluir} onClose={() => setConcluir(null)} onSaved={() => { setConcluir(null); recarregar() }} />
    </div>
  )
}

function Necessidade({ nec, real, onReal }: { nec: Nec[]; real?: Record<string, string>; onReal?: (id: string, v: string) => void }) {
  if (nec.length === 0) return <p className="text-sm text-bad">Este produto não tem ficha técnica. Cadastre os insumos dele antes de produzir.</p>
  return (
    <div className="overflow-x-auto rounded-box border border-line">
      <table className="w-full text-sm">
        <thead className="text-left text-muted"><tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium"><th>Insumo</th><th className="text-right">Precisa</th><th className="text-right">Tem</th>{onReal && <th className="w-28 text-right">Usou de fato</th>}</tr></thead>
        <tbody>
          {nec.map((n) => (
            <tr key={n.material_id} className="border-t border-line [&>td]:px-3 [&>td]:py-2">
              <td>{n.nome}</td>
              <td className="num whitespace-nowrap text-right">{qty(n.necessario)} {n.unidade}</td>
              <td className={`num whitespace-nowrap text-right ${Number(n.falta) > 0 ? 'font-semibold text-bad' : ''}`}>{qty(n.saldo)}{Number(n.falta) > 0 && ` (faltam ${qty(n.falta)})`}</td>
              {onReal && <td><NumInput value={real?.[n.material_id] ?? ''} placeholder={qty(n.necessario)} onChange={(v) => onReal(n.material_id, v)} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function NovaOrdem({ open, ordem, onClose, onSaved, onExcluir }: { open: boolean; ordem: Ordem | null; onClose: () => void; onSaved: () => void; onExcluir: (o: Ordem) => void }) {
  const toast = useToast()
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [pid, setPid] = useState('')
  const [q, setQ] = useState('1')
  const [data, setData] = useState(hoje())
  const [obs, setObs] = useState('')
  const [nec, setNec] = useState<Nec[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    supabase.from('produto').select('*').eq('ativo', true).eq('tipo', 'fabricado').order('nome').then(({ data }) => setProdutos((data ?? []) as Produto[]))
    setErro(null)
    setPid(ordem?.produto_id ?? ''); setQ(ordem ? String(Number(ordem.quantidade)).replace('.', ',') : '1')
    setData(ordem?.data_planejada ?? hoje()); setObs(ordem?.observacoes ?? '')
  }, [open, ordem])
  useEffect(() => {
    if (!pid || parseNum(q) <= 0) { setNec(null); return }
    supabase.rpc('necessidade_producao', { p_produto: pid, p_qtd: parseNum(q) }).then(({ data }) => setNec((data ?? []) as Nec[]))
  }, [pid, q])
  const falta = (nec ?? []).some((n) => Number(n.falta) > 0)

  async function salvar() {
    if (!pid || parseNum(q) <= 0) return setErro('Escolha o produto e a quantidade.')
    const row = { produto_id: pid, quantidade: parseNum(q), data_planejada: data || null, observacoes: obs.trim() || null }
    const { data: r, error } = ordem
      ? await supabase.from('ordem_producao').update(row).eq('id', ordem.id).select('numero').single()
      : await supabase.from('ordem_producao').insert(row).select('numero').single()
    if (error) return setErro(erroMsg(error))
    toast(ordem ? `Ordem #${r.numero} salva.` : `Ordem #${r.numero} criada.`); onSaved()
  }
  // Produto inativo ainda aparece na edição de uma ordem antiga dele.
  const lista = ordem && !produtos.some((p) => p.id === ordem.produto_id) ? [...produtos, { id: ordem.produto_id, nome: ordem.produto?.nome ?? 'Produto' } as Produto] : produtos
  return (
    <Modal open={open} onClose={onClose} title={ordem ? `Editar ordem #${ordem.numero}` : 'Nova ordem de produção'} wide
      footer={<>{ordem && <BotaoExcluir onClick={() => onExcluir(ordem)} />}<Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={salvar}>{ordem ? 'Salvar ordem' : 'Criar ordem'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-[1fr_120px_160px]">
        <Field label="Produto"><Select value={pid} onChange={(e) => setPid(e.target.value)}><option value="">Escolha…</option>{lista.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</Select></Field>
        <Field label="Quantidade"><NumInput value={q} onChange={setQ} /></Field>
        <Field label="Data planejada"><Input type="date" value={data} onChange={(e) => setData(e.target.value)} /></Field>
        <Field label="Observações" className="sm:col-span-3"><Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} /></Field>
      </div>
      {nec && <div className="mt-4"><Necessidade nec={nec} /></div>}
      {falta && <p className="mt-3 text-sm text-warn">Falta material. Você pode {ordem ? 'salvar' : 'criar'} a ordem agora e concluir quando a compra chegar.</p>}
      <div className="mt-3"><ErrorBox msg={erro} /></div>
    </Modal>
  )
}

function Concluir({ ordem, onClose, onSaved }: { ordem: Ordem | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [nec, setNec] = useState<Nec[]>([])
  const [real, setReal] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!ordem) return
    setReal({}); setErro(null)
    supabase.rpc('necessidade_producao', { p_produto: ordem.produto_id, p_qtd: ordem.quantidade }).then(({ data }) => setNec((data ?? []) as Nec[]))
  }, [ordem])
  if (!ordem) return null

  async function salvar() {
    if (!ordem) return
    setBusy(true); setErro(null)
    const consumo = Object.entries(real).filter(([, v]) => v.trim() !== '').map(([material_id, v]) => ({ material_id, qtd_real: parseNum(v) }))
    const { error } = await supabase.rpc('concluir_producao', { p_ordem: ordem.id, p_consumo: consumo })
    setBusy(false)
    if (error) return setErro(erroMsg(error))
    toast(`${qty(ordem.quantidade)} × ${ordem.produto?.nome} entraram no estoque.`); onSaved()
  }
  return (
    <Modal open onClose={onClose} title={`Concluir ordem #${ordem.numero}`} wide
      footer={<><Button onClick={onClose}>Voltar</Button><Button variant="primary" disabled={busy} onClick={salvar}>Concluir e dar entrada</Button></>}>
      <p className="mb-4 text-sm">{qty(ordem.quantidade)} × <span className="font-medium">{ordem.produto?.nome}</span></p>
      <Necessidade nec={nec} real={real} onReal={(id, v) => setReal({ ...real, [id]: v })} />
      <p className="mt-3 text-xs text-muted">Se gastou mais ou menos do que a ficha prevê, digite o consumo real. Em branco, vale o previsto.</p>
      <div className="mt-3"><ErrorBox msg={erro} /></div>
    </Modal>
  )
}
