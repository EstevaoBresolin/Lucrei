import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Download, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { dataBR, hoje, money, percent, somaDias } from '../lib/fmt'
import { STATUS_VENDA, type Venda } from '../lib/types'
import { Badge, Button, Empty, ErrorBox, Input, Loading, PageHeader, Panel, Select, Table } from '../components/ui'
import { baixarCSV } from '../lib/csv'
import { PendentesML } from '../components/MercadoLivre'
import { useAuth } from '../lib/auth'

type Linha = Venda & { canal: { nome: string } | null; cliente: { nome: string } | null; venda_item: { quantidade: number; produto: { nome: string } | null }[] }

export default function Vendas() {
  const nav = useNavigate()
  const { modulo, podeEditar } = useAuth()
  const [sp] = useSearchParams()
  const [ini, setIni] = useState(somaDias(hoje(), -29))
  const [fim, setFim] = useState(hoje())
  const [status, setStatus] = useState(sp.get('status') ?? '')
  const [canal, setCanal] = useState('')
  const [busca, setBusca] = useState('')
  const canais = useLoad(() => supabase.from('canal').select('id,nome').order('nome'), [])

  const { data, erro, carregando, recarregar } = useLoad<Linha[]>(() => {
    let q = supabase.from('venda').select('*, canal(nome), cliente(nome), venda_item(quantidade, produto(nome))')
      .gte('data', ini).lte('data', fim).order('data', { ascending: false }).order('numero', { ascending: false })
    if (status) q = q.eq('status', status)
    if (canal) q = q.eq('canal_id', canal)
    return q
  }, [ini, fim, status, canal])

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase()
    if (!b) return data ?? []
    return (data ?? []).filter((v) =>
      String(v.numero).includes(b) || (v.pedido_externo ?? '').toLowerCase().includes(b) ||
      (v.cliente?.nome ?? '').toLowerCase().includes(b) || v.venda_item.some((i) => (i.produto?.nome ?? '').toLowerCase().includes(b)))
  }, [data, busca])

  const validas = lista.filter((v) => v.status !== 'cancelada' && v.status !== 'devolvida')
  const tot = { receita: validas.reduce((s, v) => s + Number(v.receita), 0), lucro: validas.reduce((s, v) => s + Number(v.lucro), 0) }

  function exportar() {
    baixarCSV(`vendas_${ini}_${fim}.csv`, ['Nº', 'Data', 'Canal', 'Pedido', 'Cliente', 'Produtos', 'Situação', 'Receita', 'Custo', 'Taxa', 'Tarifa', 'Frete', 'Imposto', 'Outros', 'Lucro', 'Margem'],
      lista.map((v) => [v.numero, dataBR(v.data), v.canal?.nome, v.pedido_externo, v.cliente?.nome,
        v.venda_item.map((i) => `${i.quantidade}x ${i.produto?.nome}`).join('; '), STATUS_VENDA[v.status].label,
        v.receita, v.custo_produtos, v.valor_taxa, v.tarifa_fixa, v.frete, v.valor_imposto, v.outros_custos, v.lucro, v.margem]))
  }

  return (
    <div>
      <PageHeader title="Vendas" sub={`${validas.length} vendas válidas · ${money(tot.receita)} faturados · ${money(tot.lucro)} de lucro`}
        actions={<><Button size="sm" onClick={exportar}><Download size={15} /> Exportar CSV</Button>{podeEditar && <Button size="sm" variant="primary" onClick={() => nav('/vendas/nova')}><Plus size={15} /> Nova venda</Button>}</>} />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Input type="date" value={ini} onChange={(e) => setIni(e.target.value)} aria-label="De" />
        <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} aria-label="Até" />
        <Select value={canal} onChange={(e) => setCanal(e.target.value)}><option value="">Todos os canais</option>{(canais.data ?? []).map((c: { id: string; nome: string }) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas as situações</option>{Object.entries(STATUS_VENDA).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</Select>
        <Input placeholder="Buscar nº, pedido, produto…" value={busca} onChange={(e) => setBusca(e.target.value)} className="col-span-2 sm:col-span-1" />
      </div>
      {modulo('mercado_livre') && <PendentesML onImportou={recarregar} />}
      <ErrorBox msg={erro} />
      <Panel>
        {carregando && !data ? <Loading /> : lista.length === 0 ? (
          <Empty title="Nenhuma venda neste filtro"><Link className="underline" to="/vendas/nova">Lançar uma venda</Link></Empty>
        ) : (
          <Table head={<tr><th>Nº</th><th>Data</th><th>Produtos</th><th>Canal</th><th>Situação</th><th className="text-right">Receita</th><th className="text-right">Lucro</th><th className="text-right">Margem</th></tr>}>
            {lista.map((v) => {
              const inativa = v.status === 'cancelada' || v.status === 'devolvida'
              return (
                <tr key={v.id} onClick={() => nav(`/vendas/${v.id}`)} className={`cursor-pointer hover:bg-line/30 ${inativa ? 'text-muted line-through decoration-muted/50' : ''}`}>
                  <td className="num font-medium">#{v.numero}</td>
                  <td className="num whitespace-nowrap">{dataBR(v.data)}</td>
                  <td className="max-w-72 truncate">{v.venda_item.map((i) => `${Number(i.quantidade)}× ${i.produto?.nome}`).join(', ')}</td>
                  <td className="whitespace-nowrap">{v.canal?.nome}</td>
                  <td><Badge tone={STATUS_VENDA[v.status].tone}>{STATUS_VENDA[v.status].label}</Badge></td>
                  <td className="num text-right">{money(v.receita)}</td>
                  <td className={`num text-right font-medium ${!inativa && Number(v.lucro) < 0 ? 'text-bad' : ''}`}>{money(v.lucro)}</td>
                  <td className="num text-right">{percent(v.margem)}</td>
                </tr>
              )
            })}
          </Table>
        )}
      </Panel>
    </div>
  )
}
