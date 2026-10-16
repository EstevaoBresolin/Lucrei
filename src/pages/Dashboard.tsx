import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { dataBR, hoje, money, percent, qty, somaDias } from '../lib/fmt'
import { Badge, Empty, ErrorBox, Input, Loading, PageHeader, Panel, Select, Stat, Table } from '../components/ui'
import Composicao from '../components/Composicao'

type Dash = {
  periodo: { vendas: number; faturamento: number; lucro: number; custo: number; taxas: number; frete: number; impostos: number; outros: number; vendas_prejuizo: number; unidades: number }
  anterior: { vendas: number; faturamento: number; lucro: number }
  por_dia: { dia: string; faturamento: number; lucro: number; vendas: number }[]
  por_produto: { id: string; nome: string; unidades: number; faturamento: number; lucro: number; margem: number; lucro_unit: number }[]
  por_canal: { nome: string; vendas: number; faturamento: number; lucro: number; margem: number }[]
  despesas: number
  alertas: { produtos_baixo: { id: string; nome: string; saldo: number; minimo: number }[]; materiais_baixo: { id: string; nome: string; saldo: number; minimo: number; unidade: string }[]; vendas_abertas_antigas: number }
  estoque_valor: { produtos: number; materiais: number }
}

const PERIODOS = { '7': 'Últimos 7 dias', '30': 'Últimos 30 dias', mes: 'Este mês', mesant: 'Mês passado', '90': 'Últimos 90 dias', custom: 'Personalizado' } as const
type P = keyof typeof PERIODOS

function intervalo(p: P, ini: string, fim: string): [string, string] {
  const h = hoje()
  if (p === '7') return [somaDias(h, -6), h]
  if (p === '30') return [somaDias(h, -29), h]
  if (p === '90') return [somaDias(h, -89), h]
  if (p === 'mes') return [h.slice(0, 8) + '01', h]
  if (p === 'mesant') {
    const d = new Date(h.slice(0, 8) + '01T12:00:00'); d.setDate(0)
    const f = d.toISOString().slice(0, 10)
    return [f.slice(0, 8) + '01', f]
  }
  return [ini, fim]
}
const delta = (a: number, b: number) => (b ? (a - b) / Math.abs(b) : null)

export default function Dashboard() {
  const [p, setP] = useState<P>('30')
  const [ini, setIni] = useState(somaDias(hoje(), -29))
  const [fim, setFim] = useState(hoje())
  const [canal, setCanal] = useState('')
  const [i0, i1] = intervalo(p, ini, fim)
  const canais = useLoad(() => supabase.from('canal').select('id,nome').order('nome'), [])
  const { data, erro, carregando } = useLoad<Dash>(() => supabase.rpc('dashboard', { p_inicio: i0, p_fim: i1, p_canal: canal || null }), [i0, i1, canal])

  const serie = useMemo(() => (data?.por_dia ?? []).map((d) => ({ ...d, label: dataBR(d.dia).slice(0, 5) })), [data])
  const maxUn = Math.max(1, ...(data?.por_produto ?? []).map((x) => Number(x.unidades)))

  const per = data?.periodo
  const lucroReal = per ? Number(per.lucro) - Number(data!.despesas) : 0

  return (
    <div>
      <PageHeader title="Painel" sub={`${dataBR(i0)} a ${dataBR(i1)}`}
        actions={
          <>
            <Select value={p} onChange={(e) => setP(e.target.value as P)} className="w-auto">
              {Object.entries(PERIODOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select value={canal} onChange={(e) => setCanal(e.target.value)} className="w-auto">
              <option value="">Todos os canais</option>
              {(canais.data ?? []).map((c: { id: string; nome: string }) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </Select>
          </>
        } />
      {p === 'custom' && (
        <div className="-mt-3 mb-5 flex flex-wrap gap-2">
          <Input type="date" value={ini} onChange={(e) => setIni(e.target.value)} className="w-auto" />
          <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="w-auto" />
        </div>
      )}
      <ErrorBox msg={erro} />
      {carregando && !data ? <Loading /> : per && data && (
        <div className="flex min-w-0 flex-col gap-5">
          {/* Indicadores principais */}
          <Panel className="led-strip">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-box bg-line sm:grid-cols-3 lg:grid-cols-6 [&>*]:bg-panel">
              <Stat label="Lucro líquido" value={money(per.lucro)} delta={delta(Number(per.lucro), Number(data.anterior.lucro))} tone={Number(per.lucro) < 0 ? 'bad' : undefined} />
              <Stat label="Faturamento" value={money(per.faturamento)} delta={delta(Number(per.faturamento), Number(data.anterior.faturamento))} />
              <Stat label="Vendas" value={qty(per.vendas)} delta={delta(Number(per.vendas), Number(data.anterior.vendas))} />
              <Stat label="Unidades vendidas" value={qty(per.unidades)} />
              <Stat label="Margem média" value={percent(Number(per.faturamento) ? Number(per.lucro) / Number(per.faturamento) : 0)} />
              <Stat label="Ticket médio" value={money(Number(per.vendas) ? Number(per.faturamento) / Number(per.vendas) : 0)} />
            </div>
          </Panel>

          <div className="grid min-w-0 gap-5 lg:grid-cols-[1.6fr_1fr]">
            <Panel title="Faturamento e lucro por dia">
              <div className="h-64 px-2 pb-3 pt-4">
                {Number(per.vendas) === 0 ? <Empty title="Nenhuma venda no período"><Link className="underline" to="/vendas/nova">Lançar uma venda</Link></Empty> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={serie} margin={{ left: 0, right: 8, top: 4 }}>
                      <CartesianGrid vertical={false} stroke="rgb(var(--line))" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} tickLine={false} axisLine={false} minTickGap={16} />
                      <YAxis tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => `R$${Math.round(v)}`} />
                      <Tooltip formatter={(v, n) => [money(Number(v)), n === 'lucro' ? 'Lucro' : 'Faturamento']} labelFormatter={(l) => `Dia ${l}`}
                        contentStyle={{ background: 'rgb(var(--panel))', border: '1px solid rgb(var(--line))', borderRadius: 6, fontSize: 13 }} />
                      <Area type="monotone" dataKey="faturamento" stroke="rgb(var(--muted))" fill="rgb(var(--muted) / .15)" strokeWidth={1.5} />
                      <Line type="monotone" dataKey="lucro" stroke="rgb(var(--led))" strokeWidth={2.5} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="flex gap-4 border-t border-line px-4 py-2 text-xs text-muted">
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-muted" />Faturamento</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-led" />Lucro</span>
              </div>
            </Panel>

            <Panel title="Para onde vai o dinheiro">
              <div className="p-4">
                <Composicao receita={Number(per.faturamento)} custo={Number(per.custo)} taxas={Number(per.taxas)} frete={Number(per.frete)} imposto={Number(per.impostos)} outros={Number(per.outros)} />
                <dl className="num mt-5 space-y-1.5 border-t border-line pt-4 text-sm [&>div]:flex [&>div]:justify-between [&_dt]:text-muted">
                  <div><dt>Lucro das vendas</dt><dd>{money(per.lucro)}</dd></div>
                  <div><dt>Despesas gerais</dt><dd>− {money(data.despesas)}</dd></div>
                  <div className="font-semibold"><dt className="!text-ink">Resultado do período</dt><dd className={lucroReal < 0 ? 'text-bad' : ''}>{money(lucroReal)}</dd></div>
                </dl>
              </div>
            </Panel>
          </div>

          <Panel title="Produtos no período" actions={<span className="text-xs text-muted">ordenado por unidades</span>}>
            {data.por_produto.length === 0 ? <Empty title="Nenhum produto vendido no período" /> : (
              <Table head={<tr><th>Produto</th><th>Unidades</th><th className="text-right">Faturamento</th><th className="text-right">Lucro</th><th className="text-right">Lucro por unidade</th><th className="text-right">Margem</th></tr>}>
                {data.por_produto.map((x) => (
                  <tr key={x.id}>
                    <td className="font-medium">{x.nome}</td>
                    <td className="min-w-36">
                      <div className="flex items-center gap-2">
                        <span className="num w-8 text-right">{qty(x.unidades)}</span>
                        <span className="h-1.5 flex-1 rounded-full bg-line/60"><span className="block h-full rounded-full bg-led" style={{ width: `${(Number(x.unidades) / maxUn) * 100}%` }} /></span>
                      </div>
                    </td>
                    <td className="num text-right">{money(x.faturamento)}</td>
                    <td className={`num text-right font-medium ${Number(x.lucro) < 0 ? 'text-bad' : ''}`}>{money(x.lucro)}</td>
                    <td className="num text-right">{money(x.lucro_unit)}</td>
                    <td className="num text-right">{percent(x.margem)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>

          <div className="grid min-w-0 gap-5 lg:grid-cols-2">
            <Panel title="Por canal">
              {data.por_canal.length === 0 ? <Empty title="Sem vendas no período" /> : (
                <Table head={<tr><th>Canal</th><th className="text-right">Vendas</th><th className="text-right">Faturamento</th><th className="text-right">Lucro</th><th className="text-right">Margem</th></tr>}>
                  {data.por_canal.map((c) => (
                    <tr key={c.nome}><td className="font-medium">{c.nome}</td><td className="num text-right">{c.vendas}</td><td className="num text-right">{money(c.faturamento)}</td><td className="num text-right">{money(c.lucro)}</td><td className="num text-right">{percent(c.margem)}</td></tr>
                  ))}
                </Table>
              )}
            </Panel>

            <Panel title="Atenção">
              <ul className="divide-y divide-line text-sm">
                {data.alertas.produtos_baixo.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <Link to="/estoque" className="hover:underline">{x.nome}</Link>
                    <Badge tone={Number(x.saldo) <= 0 ? 'bad' : 'warn'}>{Number(x.saldo) <= 0 ? 'Sem estoque' : `${qty(x.saldo)} un. (mín. ${qty(x.minimo)})`}</Badge>
                  </li>
                ))}
                {data.alertas.materiais_baixo.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <Link to="/insumos" className="hover:underline">{x.nome}</Link>
                    <Badge tone={Number(x.saldo) <= 0 ? 'bad' : 'warn'}>{qty(x.saldo)} {x.unidade} (mín. {qty(x.minimo)})</Badge>
                  </li>
                ))}
                {data.alertas.vendas_abertas_antigas > 0 && (
                  <li className="flex items-center justify-between px-4 py-2.5"><Link to="/vendas?status=aberta" className="hover:underline">Vendas abertas há vários dias</Link><Badge tone="led">{data.alertas.vendas_abertas_antigas}</Badge></li>
                )}
                {Number(per.vendas_prejuizo) > 0 && (
                  <li className="flex items-center justify-between px-4 py-2.5"><Link to="/vendas" className="hover:underline">Vendas com prejuízo no período</Link><Badge tone="bad">{per.vendas_prejuizo}</Badge></li>
                )}
                {data.alertas.produtos_baixo.length + data.alertas.materiais_baixo.length + data.alertas.vendas_abertas_antigas + Number(per.vendas_prejuizo) === 0 && (
                  <li className="px-4 py-6 text-center text-muted">Tudo em ordem: estoque acima do mínimo e nenhuma venda pendente.</li>
                )}
              </ul>
              <div className="num flex justify-between border-t border-line px-4 py-3 text-sm">
                <span className="text-muted">Dinheiro parado em estoque</span>
                <span>{money(Number(data.estoque_valor.produtos) + Number(data.estoque_valor.materiais))}</span>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}
