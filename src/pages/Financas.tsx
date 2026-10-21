import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftRight, Plus, Scale, Settings2 } from 'lucide-react'
import { supabase, erroMsg } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { dataBR, hoje, money, parseNum } from '../lib/fmt'
import { Badge, BotaoExcluir, Button, Empty, ErrorBox, Field, Input, Loading, Modal, NumInput, PageHeader, Panel, Select, Stat, Table, useConfirm, useToast } from '../components/ui'
import { falta, PagarCompra, type CompraFin } from '../components/PagamentoCompra'

type Conta = { id: string; nome: string; saldo_inicial: number; saldo_em: string; padrao: boolean; recebe_ml: boolean; ativo: boolean; saldo: number }
type Linha = { conta_id: string; conta_nome: string; data: string; valor: number; descricao: string; origem: 'manual' | 'transferencia' | 'despesa' | 'compra' | 'venda'; ref_id: string }
type Mov = { id?: string; conta_id: string; tipo: 'entrada' | 'saida'; valor: string; data: string; descricao: string; transferencia?: string | null }

const ORIGEM: Record<Linha['origem'], string> = { manual: 'Lançamento', transferencia: 'Transferência', despesa: 'Despesa', compra: 'Compra', venda: 'Venda' }

export default function Financas() {
  const contasQ = useLoad<Conta[]>(() => supabase.from('vw_conta_saldo').select('*').order('nome'), [])
  const extratoQ = useLoad<Linha[]>(() => supabase.from('vw_extrato').select('*').order('data').order('descricao'), [])
  const pagarQ = useLoad<CompraFin[]>(() => supabase.from('vw_compra_financeiro').select('*').neq('status', 'cancelada').order('data'), [])
  const [pagar, setPagar] = useState<CompraFin | null>(null)
  const [mes, setMes] = useState(hoje().slice(0, 7))
  const [filtroConta, setFiltroConta] = useState('')
  const [mov, setMov] = useState<Mov | null>(null)
  const [transf, setTransf] = useState(false)
  const [ajuste, setAjuste] = useState<Conta | null>(null)
  const [gerir, setGerir] = useState(false)

  const recarregar = () => { contasQ.recarregar(); extratoQ.recarregar(); pagarQ.recarregar() }
  const contas = (contasQ.data ?? []).filter((c) => c.ativo)
  const varias = contas.length > 1
  const emConta = contas.reduce((s, c) => s + Number(c.saldo), 0)
  const aPagar = (pagarQ.data ?? []).filter((c) => falta(c) > 0)
  const totalAPagar = aPagar.reduce((s, c) => s + falta(c), 0)

  // Extrato com saldo linha a linha (por conta), mostrando só o mês escolhido.
  const linhas = useMemo(() => {
    const saldoPor = new Map(contas.map((c) => [c.id, Number(c.saldo_inicial)]))
    const todas = (extratoQ.data ?? []).filter((l) => !filtroConta || l.conta_id === filtroConta).map((l) => {
      const s = (saldoPor.get(l.conta_id) ?? 0) + Number(l.valor)
      saldoPor.set(l.conta_id, s)
      return { ...l, saldoApos: s }
    })
    return todas.filter((l) => l.data.slice(0, 7) === mes).reverse()
  }, [extratoQ.data, contas, filtroConta, mes])
  const entradasMes = linhas.filter((l) => l.valor > 0 && l.origem !== 'transferencia').reduce((s, l) => s + Number(l.valor), 0)
  const saidasMes = linhas.filter((l) => l.valor < 0 && l.origem !== 'transferencia').reduce((s, l) => s - Number(l.valor), 0)

  async function editarLinha(l: Linha) {
    if (l.origem !== 'manual' && l.origem !== 'transferencia') return
    const { data } = await supabase.from('movimento_financeiro').select('*').eq('id', l.ref_id).single()
    if (!data) return
    setMov({ id: data.id, conta_id: data.conta_id, tipo: Number(data.valor) > 0 ? 'entrada' : 'saida', valor: String(Math.abs(Number(data.valor))).replace('.', ','), data: data.data, descricao: data.descricao, transferencia: data.transferencia })
  }
  const link = (l: Linha) => (l.origem === 'venda' ? `/vendas/${l.ref_id}` : l.origem === 'despesa' ? '/financeiro' : l.origem === 'compra' ? '/compras' : null)

  if (contasQ.carregando && !contasQ.data) return <Loading />
  if (contasQ.erro) return <ErrorBox msg={contasQ.erro} />
  if (!contas.length) return <Comecar onPronto={recarregar} />

  return (
    <div>
      <PageHeader title="Finanças" sub="Saldo das contas, o que entrou e saiu, e o que falta pagar de compras."
        actions={<>
          <Button size="sm" onClick={() => setAjuste(contas.find((c) => c.padrao) ?? contas[0])}><Scale size={15} /> Conferir saldo</Button>
          {varias && <Button size="sm" onClick={() => setTransf(true)}><ArrowLeftRight size={15} /> Transferir</Button>}
          <Button size="sm" onClick={() => setGerir(true)}><Settings2 size={15} /> Contas</Button>
          <Button size="sm" variant="primary" onClick={() => setMov({ conta_id: (contas.find((c) => c.padrao) ?? contas[0]).id, tipo: 'saida', valor: '', data: hoje(), descricao: '' })}><Plus size={15} /> Entrada ou saída</Button>
        </>} />
      <ErrorBox msg={extratoQ.erro ?? pagarQ.erro} />

      <Panel className="mb-5">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-box bg-line sm:grid-cols-3 [&>*]:bg-panel">
          <Stat label={varias ? 'Em conta agora' : `Em conta agora · ${contas[0].nome}`} value={money(emConta)} tone={emConta < 0 ? 'bad' : undefined} />
          <Stat label={`A pagar de compras · ${aPagar.length} compra(s)`} value={money(totalAPagar)} />
          <div className="led-strip"><Stat label="Depois de pagar tudo" value={money(emConta - totalAPagar)} tone={emConta - totalAPagar < 0 ? 'bad' : undefined} /></div>
        </div>
      </Panel>

      {varias && (
        <Panel title="Contas" className="mb-5">
          <ul className="divide-y divide-line">
            {contas.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="font-medium">{c.nome} {c.padrao && <Badge>Padrão</Badge>}</span>
                <span className="flex items-center gap-3"><span className={`num font-semibold ${c.saldo < 0 ? 'text-bad' : ''}`}>{money(c.saldo)}</span><Button size="sm" variant="ghost" onClick={() => setAjuste(c)}>Conferir</Button></span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid min-w-0 gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Panel title="A pagar de compras">
          {aPagar.length === 0 ? <Empty title="Nada a pagar">Compras com pagamento em aberto (adiantamento pago e resto pendente, por exemplo) aparecem aqui.</Empty> : (
            <Table head={<tr><th>Compra</th><th className="text-right">Pago</th><th className="text-right">Falta</th><th /></tr>}>
              {aPagar.map((c) => (
                <tr key={c.id}>
                  <td><Link to="/compras" className="font-medium hover:underline">#{c.numero} · {c.fornecedor ?? 'sem fornecedor'}</Link><span className="block text-xs text-muted">{dataBR(c.data)}{c.status === 'pedida' ? ' · ainda não chegou' : ''}</span></td>
                  <td className="num whitespace-nowrap text-right text-muted">{money(c.pago)}</td>
                  <td className="num whitespace-nowrap text-right font-semibold">{money(falta(c))}</td>
                  <td className="w-0 text-right"><Button size="sm" onClick={() => setPagar(c)}>Pagar</Button></td>
                </tr>
              ))}
              <tr className="font-semibold"><td>Total</td><td /><td className="num text-right">{money(totalAPagar)}</td><td /></tr>
            </Table>
          )}
          <p className="border-t border-line px-4 py-2 text-xs text-muted">O dinheiro sai da conta quando você lança o pagamento, mesmo que a compra ainda não tenha chegado. Receber a compra só dá entrada no estoque.</p>
        </Panel>

        <Panel title="Extrato" actions={<div className="flex flex-wrap justify-end gap-2">
          {varias && <Select value={filtroConta} onChange={(e) => setFiltroConta(e.target.value)} className="h-8 w-auto text-sm"><option value="">Todas as contas</option>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select>}
          <Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="h-8 w-auto text-sm" />
        </div>}>
          <div className="num flex flex-wrap gap-x-6 gap-y-1 border-b border-line px-4 py-2 text-sm">
            <span>Entrou <b className="text-good">{money(entradasMes)}</b></span>
            <span>Saiu <b className="text-bad">{money(saidasMes)}</b></span>
          </div>
          {extratoQ.carregando && !extratoQ.data ? <Loading /> : linhas.length === 0 ? <Empty title="Nenhuma movimentação neste mês" /> : (
            <Table head={<tr><th>Data</th><th>Descrição</th><th className="text-right">Valor</th>{(!varias || filtroConta) && <th className="text-right">Saldo</th>}</tr>}>
              {linhas.map((l, k) => {
                const to = link(l)
                const editavel = l.origem === 'manual' || l.origem === 'transferencia'
                return (
                  <tr key={k} onClick={editavel ? () => editarLinha(l) : undefined} className={editavel ? 'cursor-pointer hover:bg-line/30' : ''}>
                    <td className="num whitespace-nowrap">{dataBR(l.data)}</td>
                    <td>
                      {to ? <Link to={to} className="font-medium hover:underline">{l.descricao}</Link> : <span className="font-medium">{l.descricao}</span>}
                      <span className="ml-2 text-xs text-muted">{ORIGEM[l.origem]}{varias && !filtroConta ? ` · ${l.conta_nome}` : ''}</span>
                    </td>
                    <td className={`num whitespace-nowrap text-right ${l.valor < 0 ? 'text-bad' : 'text-good'}`}>{l.valor > 0 ? '+ ' : '− '}{money(Math.abs(l.valor))}</td>
                    {(!varias || filtroConta) && <td className="num whitespace-nowrap text-right text-muted">{money(l.saldoApos)}</td>}
                  </tr>
                )
              })}
            </Table>
          )}
          <p className="border-t border-line px-4 py-2 text-xs text-muted">Entram aqui: vendas fora do ML, despesas, pagamentos de compras, transferências e lançamentos manuais. O dinheiro do Mercado Livre não entra sozinho: use Conferir saldo com o valor do app do Mercado Pago. Contado a partir do saldo informado em {contas.map((c) => `${c.nome}: ${dataBR(c.saldo_em)}`).join(', ')}.</p>
        </Panel>
      </div>

      {mov && <MovModal key={mov.id ?? 'novo'} mov={mov} contas={contas} onClose={() => setMov(null)} onSalvo={() => { setMov(null); recarregar() }} />}
      {transf && <TransfModal contas={contas} onClose={() => setTransf(false)} onSalvo={() => { setTransf(false); recarregar() }} />}
      <PagarCompra compra={pagar} onClose={() => setPagar(null)} onSalvo={() => { setPagar(null); recarregar() }} />
      <AjusteModal conta={ajuste} contas={contas} onClose={() => setAjuste(null)} onSalvo={() => { setAjuste(null); recarregar() }} />
      {gerir && <ContasModal todas={contasQ.data ?? []} onClose={() => { setGerir(false); recarregar() }} />}
    </div>
  )
}

/** Primeira vez: cria a conta onde o dinheiro fica (Mercado Pago) com o saldo de hoje. */
function Comecar({ onPronto }: { onPronto: () => void }) {
  const [nome, setNome] = useState('Mercado Pago')
  const [saldo, setSaldo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  async function criar() {
    if (!nome.trim()) return setErro('Dê um nome à conta.')
    const { error } = await supabase.from('conta_financeira').insert({ nome: nome.trim(), saldo_inicial: parseNum(saldo), saldo_em: hoje(), padrao: true })
    if (error) return setErro(erroMsg(error))
    onPronto()
  }
  return (
    <div>
      <PageHeader title="Finanças" sub="Saldo das contas, o que entrou e saiu, e o que falta pagar de compras." />
      <Panel title="Para começar" className="max-w-xl">
        <div className="flex flex-col gap-4 p-4 text-sm">
          <p className="text-muted">Informe quanto tem <b>hoje</b> disponível na conta. Daqui para frente o sistema soma as vendas fora do ML e os lançamentos, e desconta despesas e pagamentos de compras. O dinheiro do Mercado Livre você atualiza em Conferir saldo.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome da conta"><Input value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
            <Field label="Saldo disponível hoje (R$)" hint="No app do Mercado Pago: saldo disponível."><NumInput negativo value={saldo} onChange={setSaldo} /></Field>
          </div>
          <ErrorBox msg={erro} />
          <div><Button variant="primary" onClick={criar}>Começar</Button></div>
        </div>
      </Panel>
    </div>
  )
}

function MovModal({ mov, contas, onClose, onSalvo }: { mov: Mov; contas: Conta[]; onClose: () => void; onSalvo: () => void }) {
  const toast = useToast()
  const confirmar = useConfirm()
  const [f, setF] = useState<Mov>(mov)
  const [erro, setErro] = useState<string | null>(null)
  const set = (p: Partial<Mov>) => setF({ ...f, ...p })
  const transf = !!f.transferencia

  async function salvar() {
    const valor = parseNum(f.valor)
    if (!(valor > 0)) return setErro('Informe o valor.')
    if (!f.descricao.trim()) return setErro('Descreva o lançamento (ex.: retirada de lucro, aporte, tarifa do banco).')
    if (!f.data) return setErro('Informe a data.')
    if (transf) {
      // Transferência: muda valor, data e descrição nas duas pontas, mantendo o sinal de cada uma.
      const { data: pontas, error } = await supabase.from('movimento_financeiro').select('id,valor').eq('transferencia', f.transferencia!)
      if (error) return setErro(erroMsg(error))
      for (const p of pontas ?? []) {
        const r = await supabase.from('movimento_financeiro').update({ data: f.data, descricao: f.descricao.trim(), valor: Number(p.valor) > 0 ? valor : -valor }).eq('id', p.id)
        if (r.error) return setErro(erroMsg(r.error))
      }
    } else {
      const row = { conta_id: f.conta_id, data: f.data, descricao: f.descricao.trim(), valor: f.tipo === 'entrada' ? valor : -valor }
      const { error } = f.id ? await supabase.from('movimento_financeiro').update(row).eq('id', f.id) : await supabase.from('movimento_financeiro').insert(row)
      if (error) return setErro(erroMsg(error))
    }
    toast('Lançamento salvo.'); onSalvo()
  }
  async function excluir() {
    if (!f.id) return
    if (!(await confirmar({ titulo: transf ? 'Excluir a transferência?' : 'Excluir o lançamento?', mensagem: transf ? 'As duas pontas (saída e entrada) são apagadas.' : undefined }))) return
    const q = supabase.from('movimento_financeiro').delete()
    const { error } = transf ? await q.eq('transferencia', f.transferencia!) : await q.eq('id', f.id)
    if (error) return setErro(erroMsg(error))
    toast('Lançamento excluído.'); onSalvo()
  }

  return (
    <Modal open onClose={onClose} title={transf ? 'Editar transferência' : f.id ? 'Editar lançamento' : 'Entrada ou saída'}
      footer={<>{f.id && <BotaoExcluir onClick={excluir} />}<Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={salvar}>Salvar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {!transf && (
          <Field label="Tipo" className="sm:col-span-2">
            <div className="flex flex-wrap gap-2">
              {(['saida', 'entrada'] as const).map((t) => (
                <Button key={t} size="sm" variant={f.tipo === t ? 'primary' : 'plain'} onClick={() => set({ tipo: t })}>{t === 'saida' ? 'Saída (dinheiro saiu)' : 'Entrada (dinheiro entrou)'}</Button>
              ))}
            </div>
          </Field>
        )}
        <Field label="Descrição" className="sm:col-span-2"><Input value={f.descricao} onChange={(e) => set({ descricao: e.target.value })} placeholder={f.tipo === 'saida' ? 'Retirada de lucro, tarifa do banco…' : 'Aporte dos sócios, venda de sobra…'} /></Field>
        <Field label="Valor (R$)"><NumInput value={f.valor} onChange={(v) => set({ valor: v })} /></Field>
        <Field label="Data"><Input type="date" value={f.data} onChange={(e) => set({ data: e.target.value })} /></Field>
        {contas.length > 1 && !transf && (
          <Field label="Conta"><Select value={f.conta_id} onChange={(e) => set({ conta_id: e.target.value })}>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field>
        )}
        <p className="text-xs text-muted sm:col-span-2">Gastos da operação (anúncios, contador…) lance em <Link to="/financeiro" className="underline" onClick={onClose}>Despesas</Link>, para entrarem no resultado do mês. Aqui é para o resto: retiradas, aportes, tarifas, acertos.</p>
      </div>
      <div className="mt-3"><ErrorBox msg={erro} /></div>
    </Modal>
  )
}

function TransfModal({ contas, onClose, onSalvo }: { contas: Conta[]; onClose: () => void; onSalvo: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ de: contas.find((c) => c.padrao)?.id ?? contas[0].id, para: contas.find((c) => !c.padrao)?.id ?? contas[1]?.id ?? '', valor: '', data: hoje(), descricao: '' })
  const [erro, setErro] = useState<string | null>(null)
  async function salvar() {
    const valor = parseNum(f.valor)
    if (!(valor > 0)) return setErro('Informe o valor.')
    if (!f.para || f.de === f.para) return setErro('Escolha duas contas diferentes.')
    if (!f.data) return setErro('Informe a data.')
    const nome = (id: string) => contas.find((c) => c.id === id)?.nome ?? ''
    const descricao = f.descricao.trim() || `Transferência ${nome(f.de)} → ${nome(f.para)}`
    const transferencia = crypto.randomUUID()
    const { error } = await supabase.from('movimento_financeiro').insert([
      { conta_id: f.de, data: f.data, valor: -valor, descricao, transferencia },
      { conta_id: f.para, data: f.data, valor, descricao, transferencia },
    ])
    if (error) return setErro(erroMsg(error))
    toast('Transferência lançada.'); onSalvo()
  }
  return (
    <Modal open onClose={onClose} title="Transferir entre contas" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={salvar}>Transferir</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="De"><Select value={f.de} onChange={(e) => setF({ ...f, de: e.target.value })}>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field>
        <Field label="Para"><Select value={f.para} onChange={(e) => setF({ ...f, para: e.target.value })}>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field>
        <Field label="Valor (R$)"><NumInput value={f.valor} onChange={(v) => setF({ ...f, valor: v })} /></Field>
        <Field label="Data"><Input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></Field>
        <Field label="Descrição (opcional)" className="sm:col-span-2"><Input value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="Saque do Mercado Pago" /></Field>
      </div>
      <div className="mt-3"><ErrorBox msg={erro} /></div>
    </Modal>
  )
}

/** Compara o saldo do sistema com o saldo real e lança a diferença como ajuste. */
function AjusteModal({ conta, contas, onClose, onSalvo }: { conta: Conta | null; contas: Conta[]; onClose: () => void; onSalvo: () => void }) {
  const toast = useToast()
  const [contaId, setContaId] = useState<string | null>(null)
  const [real, setReal] = useState('')
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const c = contas.find((x) => x.id === (contaId ?? conta?.id)) ?? conta
  const dif = real.trim() ? Math.round((parseNum(real) - Number(c?.saldo ?? 0)) * 100) / 100 : 0
  const fechar = () => { setContaId(null); setReal(''); setMotivo(''); setErro(null); onClose() }
  async function salvar() {
    if (!c) return
    if (!real.trim()) return setErro('Informe o saldo que aparece no banco / Mercado Pago.')
    if (dif === 0) { toast('Saldo confere. Nada a ajustar.'); return fechar() }
    const { error } = await supabase.from('movimento_financeiro').insert({ conta_id: c.id, data: hoje(), valor: dif, descricao: motivo.trim() || 'Ajuste de saldo (conferência)' })
    if (error) return setErro(erroMsg(error))
    toast('Saldo ajustado.'); setContaId(null); setReal(''); setMotivo(''); onSalvo()
  }
  return (
    <Modal open={!!conta} onClose={fechar} title="Conferir saldo" footer={<><Button onClick={fechar}>Cancelar</Button><Button variant="primary" onClick={salvar}>{dif === 0 ? 'Conferir' : 'Lançar ajuste'}</Button></>}>
      {c && (
        <div className="flex flex-col gap-4 text-sm">
          {contas.length > 1 && <Field label="Conta"><Select value={c.id} onChange={(e) => setContaId(e.target.value)}>{contas.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>}
          <p>O sistema calcula <b className="num">{money(c.saldo)}</b> em {c.nome}.</p>
          <Field label="Saldo disponível de verdade agora (R$)" hint="O saldo disponível que aparece agora no app do banco ou do Mercado Pago."><NumInput negativo value={real} onChange={setReal} /></Field>
          {real.trim() !== '' && (dif === 0 ? <p className="text-good">Confere certinho.</p>
            : <p className="rounded-box bg-warn/10 px-3 py-2 text-warn">Diferença de <b className="num">{dif > 0 ? '+' : '−'} {money(Math.abs(dif))}</b>. Será lançado um ajuste com esse valor. Se a diferença for um gasto esquecido, prefira lançá-lo em Despesas.</p>)}
          {real.trim() !== '' && dif !== 0 && <Field label="Motivo (opcional)"><Input value={motivo} maxLength={120} onChange={(e) => setMotivo(e.target.value)} placeholder={dif > 0 ? 'Liberado pelo Mercado Livre' : 'Devolução no Mercado Livre'} /></Field>}
        </div>
      )}
      <div className="mt-3"><ErrorBox msg={erro} /></div>
    </Modal>
  )
}

function ContasModal({ todas, onClose }: { todas: Conta[]; onClose: () => void }) {
  const toast = useToast()
  const [ed, setEd] = useState<{ id?: string; nome: string; saldo_inicial: string; saldo_em: string; padrao: boolean; ativo: boolean } | null>(null)
  const [lista, setLista] = useState(todas)
  const [erro, setErro] = useState<string | null>(null)
  const recarregar = async () => { const { data } = await supabase.from('vw_conta_saldo').select('*').order('nome'); setLista((data ?? []) as Conta[]) }

  async function salvar() {
    if (!ed) return
    if (!ed.nome.trim()) return setErro('Dê um nome à conta.')
    if (!ed.saldo_em) return setErro('Informe a data do saldo inicial.')
    if (lista.some((c) => c.id !== ed.id && c.nome.trim().toLowerCase() === ed.nome.trim().toLowerCase())) return setErro('Já existe uma conta com esse nome.')
    setErro(null)
    // Só uma conta pode ser a padrão.
    if (ed.padrao) await supabase.from('conta_financeira').update({ padrao: false }).neq('id', ed.id ?? '00000000-0000-0000-0000-000000000000').eq('padrao', true)
    const row = { nome: ed.nome.trim(), saldo_inicial: parseNum(ed.saldo_inicial), saldo_em: ed.saldo_em, padrao: ed.padrao, ativo: ed.ativo }
    const { error } = ed.id ? await supabase.from('conta_financeira').update(row).eq('id', ed.id) : await supabase.from('conta_financeira').insert(row)
    if (error) return setErro(erroMsg(error))
    toast('Conta salva.'); setEd(null); recarregar()
  }
  return (
    <Modal open onClose={onClose} title={ed ? (ed.id ? `Editar ${ed.nome}` : 'Nova conta') : 'Contas'} wide
      footer={ed ? <><Button onClick={() => { setEd(null); setErro(null) }}>Voltar</Button><Button variant="primary" onClick={salvar}>Salvar</Button></> : <><Button onClick={() => setEd({ nome: '', saldo_inicial: '', saldo_em: hoje(), padrao: false, ativo: true })}><Plus size={15} /> Nova conta</Button><Button variant="primary" onClick={onClose}>Fechar</Button></>}>
      {!ed ? (
        <ul className="divide-y divide-line rounded-box border border-line text-sm">
          {lista.map((c) => (
            <li key={c.id} onClick={() => setEd({ id: c.id, nome: c.nome, saldo_inicial: String(Number(c.saldo_inicial)).replace('.', ','), saldo_em: c.saldo_em, padrao: c.padrao, ativo: c.ativo })}
              className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2.5 hover:bg-line/30">
              <span className={c.ativo ? 'font-medium' : 'text-muted'}>{c.nome} {c.padrao && <Badge>Padrão</Badge>} {!c.ativo && <Badge>Inativa</Badge>}</span>
              <span className="num">{money(c.saldo)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" className="sm:col-span-2"><Input value={ed.nome} onChange={(e) => setEd({ ...ed, nome: e.target.value })} placeholder="Banco, Caixa…" /></Field>
          <Field label="Saldo inicial (R$)" hint="Quanto tinha na conta no fim do dia ao lado."><NumInput negativo value={ed.saldo_inicial} onChange={(v) => setEd({ ...ed, saldo_inicial: v })} /></Field>
          <Field label="Saldo em" hint="Só o que acontecer depois desta data mexe no saldo."><Input type="date" value={ed.saldo_em} onChange={(e) => setEd({ ...ed, saldo_em: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={ed.padrao} onChange={(e) => setEd({ ...ed, padrao: e.target.checked })} /> Conta padrão (despesas, pagamentos de compra e vendas sem conta escolhida)</label>
          {ed.id && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={ed.ativo} onChange={(e) => setEd({ ...ed, ativo: e.target.checked })} /> Conta ativa</label>}
        </div>
      )}
      <div className="mt-3"><ErrorBox msg={erro} /></div>
    </Modal>
  )
}
