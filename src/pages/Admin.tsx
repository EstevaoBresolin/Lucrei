import { useMemo, useState } from 'react'
import { Mail, Search, ShieldAlert } from 'lucide-react'
import { supabase, erroMsg } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { money } from '../lib/fmt'
import { Badge, Button, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Panel, Stat, Table, Textarea, useConfirm, useToast } from '../components/ui'

/** Uma empresa vista pelo administrador do Apura (função admin_empresas no banco). */
type Situacao = 'teste' | 'teste_vencido' | 'pagante' | 'atrasada' | 'vencida' | 'cancelada' | 'cortesia' | 'bloqueada'
type EmpresaAdm = {
  id: string; nome: string; tipo_negocio: string; status: string; plano: string; plano_nome: string | null; preco: number | null
  criada_em: string; teste_ate: string | null; pago_ate: string | null; bloqueio_admin: string | null; documento: string | null
  assinada: boolean; cobranca_vencimento: string | null; liberada: boolean; situacao: Situacao
  dono_nome: string | null; dono_email: string | null; usuarios: number; vendas: number; vendas_30d: number
  ultima_venda: string | null; produtos: number; ml_conectado: boolean; ultimo_acesso: string | null
}
type Log = { acao: string; detalhe: { dias?: number; motivo?: string } | null; feito_em: string; por: string | null }

const SIT: Record<Situacao, { nome: string; tom: 'neutral' | 'good' | 'bad' | 'warn' | 'led' }> = {
  teste: { nome: 'Em teste', tom: 'led' },
  teste_vencido: { nome: 'Teste vencido', tom: 'neutral' },
  pagante: { nome: 'Pagante', tom: 'good' },
  atrasada: { nome: 'Atrasada', tom: 'warn' },
  vencida: { nome: 'Vencida', tom: 'bad' },
  cancelada: { nome: 'Cancelada', tom: 'neutral' },
  cortesia: { nome: 'Cortesia', tom: 'led' },
  bloqueada: { nome: 'Bloqueada', tom: 'bad' },
}
const FILTROS: { id: 'todas' | Situacao | 'vencendo'; nome: string }[] = [
  { id: 'todas', nome: 'Todas' }, { id: 'teste', nome: 'Em teste' }, { id: 'vencendo', nome: 'Teste acabando' },
  { id: 'pagante', nome: 'Pagantes' }, { id: 'atrasada', nome: 'Atrasadas' }, { id: 'teste_vencido', nome: 'Teste vencido' },
  { id: 'cancelada', nome: 'Canceladas' }, { id: 'cortesia', nome: 'Cortesia' }, { id: 'bloqueada', nome: 'Bloqueadas' },
]
const ACAO: Record<string, string> = {
  estender_teste: 'Estendeu o teste', cortesia: 'Deu cortesia', tirar_cortesia: 'Tirou a cortesia', bloquear: 'Bloqueou', desbloquear: 'Desbloqueou',
}

const dia = 86400000
const data = (d: string | null) => (d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('pt-BR') : '—')
const diasAte = (d: string | null) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / dia) : null)
function haQuanto(d: string | null) {
  if (!d) return 'nunca'
  const min = Math.round((Date.now() - new Date(d).getTime()) / 60000)
  if (min < 60) return min <= 1 ? 'agora' : `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const dd = Math.round(h / 24)
  return dd === 1 ? 'ontem' : `há ${dd} dias`
}
const vencendo = (e: EmpresaAdm) => e.situacao === 'teste' && !e.assinada && (diasAte(e.teste_ate) ?? 99) <= 7

export default function Admin() {
  const { data: lista, erro, carregando, recarregar } = useLoad(() => supabase.rpc('admin_empresas'), [])
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]['id']>('todas')
  const [busca, setBusca] = useState('')
  const [aberta, setAberta] = useState<string | null>(null)

  const todas = (lista ?? []) as EmpresaAdm[]
  const conta = (f: (typeof FILTROS)[number]['id']) => (f === 'todas' ? todas.length : f === 'vencendo' ? todas.filter(vencendo).length : todas.filter((e) => e.situacao === f).length)
  const mrr = todas.filter((e) => e.situacao === 'pagante' || e.situacao === 'atrasada').reduce((s, e) => s + Number(e.preco ?? 0), 0)
  const novas7 = todas.filter((e) => Date.now() - new Date(e.criada_em).getTime() < 7 * dia).length

  const vistas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return todas.filter((e) => (filtro === 'todas' || (filtro === 'vencendo' ? vencendo(e) : e.situacao === filtro))
      && (!q || [e.nome, e.dono_nome, e.dono_email, e.documento].some((t) => t?.toLowerCase().includes(q))))
  }, [todas, filtro, busca])
  const sel = todas.find((e) => e.id === aberta) ?? null

  if (erro) return <><PageHeader title="Admin" /><ErrorBox msg={erro} /></>

  return (
    <div>
      <PageHeader title="Admin" sub="Todas as empresas do Apura. Só você vê esta tela." />

      <Panel className="mb-4 grid grid-cols-2 divide-line sm:grid-cols-5 sm:divide-x">
        <Stat label="Empresas" value={todas.length} />
        <Stat label="Em teste" value={conta('teste')} />
        <Stat label="Pagantes" value={conta('pagante') + conta('atrasada')} tone="good" />
        <Stat label="Receita mensal" value={money(mrr)} />
        <Stat label="Novas em 7 dias" value={novas7} />
      </Panel>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTROS.map((f) => {
          const n = conta(f.id)
          if (n === 0 && f.id !== 'todas' && f.id !== filtro) return null
          return (
            <button key={f.id} onClick={() => setFiltro(f.id)}
              className={`rounded-full border px-3 py-1 text-sm ${filtro === f.id ? 'border-ink bg-ink text-base' : 'border-line bg-panel text-muted hover:text-ink'}`}>
              {f.nome} <span className="num opacity-70">{n}</span>
            </button>
          )
        })}
      </div>

      <Panel>
        <div className="border-b border-line p-3">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por empresa, dono, e-mail ou CPF/CNPJ" className="pl-9" aria-label="Buscar" />
          </div>
        </div>
        {carregando && !lista ? <Loading /> : !vistas.length ? <Empty title="Nenhuma empresa aqui" /> : (
          <>
            {/* Computador */}
            <div className="hidden md:block">
              <Table head={<tr><th>Empresa</th><th>Situação</th><th>Plano</th><th>Criada</th><th>Teste / pago até</th><th className="text-right">Vendas 30d</th><th>ML</th><th>Último acesso</th></tr>}>
                {vistas.map((e) => (
                  <tr key={e.id} onClick={() => setAberta(e.id)} className="cursor-pointer hover:bg-line/30">
                    <td><div className="font-medium">{e.nome}</div><div className="text-xs text-muted">{e.dono_email ?? '—'}</div></td>
                    <td className="whitespace-nowrap"><Badge tone={SIT[e.situacao].tom}>{SIT[e.situacao].nome}</Badge></td>
                    <td className="whitespace-nowrap">{e.situacao === 'teste' || e.situacao === 'teste_vencido' ? <span className="text-muted">—</span> : <>{e.plano_nome ?? e.plano}{e.preco ? <span className="text-muted"> · {money(e.preco)}</span> : null}</>}</td>
                    <td className="num whitespace-nowrap">{data(e.criada_em)}</td>
                    <td className="num whitespace-nowrap"><Prazo e={e} /></td>
                    <td className="num text-right">{e.vendas_30d}</td>
                    <td>{e.ml_conectado ? <Badge tone="good">Conectado</Badge> : <span className="text-muted">—</span>}</td>
                    <td className="whitespace-nowrap text-muted">{haQuanto(e.ultimo_acesso)}</td>
                  </tr>
                ))}
              </Table>
            </div>
            {/* Celular */}
            <ul className="divide-y divide-line md:hidden">
              {vistas.map((e) => (
                <li key={e.id}>
                  <button onClick={() => setAberta(e.id)} className="flex w-full flex-col gap-1 px-4 py-3 text-left">
                    <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{e.nome}</span><span className="shrink-0"><Badge tone={SIT[e.situacao].tom}>{SIT[e.situacao].nome}</Badge></span></div>
                    <span className="truncate text-xs text-muted">{e.dono_email}</span>
                    <span className="text-xs text-muted"><Prazo e={e} /> · {e.vendas_30d} vendas em 30d · acesso {haQuanto(e.ultimo_acesso)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      {sel && <Detalhe e={sel} onClose={() => setAberta(null)} onMudou={recarregar} />}
    </div>
  )
}

function Prazo({ e }: { e: EmpresaAdm }) {
  if (e.situacao === 'cortesia') return <span className="text-muted">sem cobrança</span>
  if (e.pago_ate && e.situacao !== 'teste') return <>pago até {data(e.pago_ate)}</>
  const d = diasAte(e.teste_ate)
  if (d === null) return <>—</>
  if (d <= 0) return <span className="text-muted">teste acabou {data(e.teste_ate)}</span>
  return <span className={d <= 3 ? 'text-warn' : ''}>teste até {data(e.teste_ate)} ({d} {d === 1 ? 'dia' : 'dias'})</span>
}

function Detalhe({ e, onClose, onMudou }: { e: EmpresaAdm; onClose: () => void; onMudou: () => Promise<void> }) {
  const toast = useToast()
  const confirmar = useConfirm()
  const { data: hist, recarregar: recarregarHist } = useLoad(() => supabase.rpc('admin_historico', { p_empresa: e.id }), [e.id])
  const [dias, setDias] = useState('7')
  const [motivo, setMotivo] = useState('')
  const [bloqueando, setBloqueando] = useState(false)

  const agir = async (acao: string, extra: { p_dias?: number; p_motivo?: string } = {}, ok = 'Feito') => {
    const { error } = await supabase.rpc('admin_acao', { p_empresa: e.id, p_acao: acao, ...extra })
    if (error) { toast(erroMsg(error), 'bad'); return false }
    toast(ok); await Promise.all([onMudou(), recarregarHist()]); return true
  }

  const linhas: [string, React.ReactNode][] = [
    ['Dono', <>{e.dono_nome || '—'}{e.dono_email && <a href={`mailto:${e.dono_email}`} className="ml-2 inline-flex items-center gap-1 text-ledink hover:underline"><Mail size={13} />{e.dono_email}</a>}</>],
    ['CPF/CNPJ', e.documento ?? '—'],
    ['Tipo de negócio', { revenda: 'Revenda', fabricacao: 'Fabricação', misto: 'Revenda e fabricação' }[e.tipo_negocio] ?? e.tipo_negocio],
    ['Criada em', data(e.criada_em)],
    ['Teste até', data(e.teste_ate)],
    ['Plano', e.assinada ? `${e.plano_nome ?? e.plano}${e.preco ? ` · ${money(e.preco)}/mês` : ''}` : 'Ainda não assinou'],
    ['Pago até', data(e.pago_ate)],
    ['Próxima cobrança', data(e.cobranca_vencimento)],
    ['Usuários', e.usuarios],
    ['Produtos', e.produtos],
    ['Vendas', `${e.vendas} no total · ${e.vendas_30d} nos últimos 30 dias · última ${data(e.ultima_venda)}`],
    ['Mercado Livre', e.ml_conectado ? 'Conectado' : 'Não conectado'],
    ['Último acesso', e.ultimo_acesso ? `${haQuanto(e.ultimo_acesso)} (${new Date(e.ultimo_acesso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })})` : 'nunca'],
  ]

  return (
    <Modal open onClose={onClose} title={e.nome} wide>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={SIT[e.situacao].tom}>{SIT[e.situacao].nome}</Badge>
        {e.liberada ? <span className="text-sm text-muted">Pode lançar normalmente</span> : <span className="text-sm text-bad">Em modo só leitura</span>}
      </div>
      {e.bloqueio_admin && <p className="mb-4 flex items-start gap-2 rounded-box bg-bad/10 p-2.5 text-sm text-bad"><ShieldAlert size={16} className="mt-0.5 shrink-0" />Bloqueada por você: {e.bloqueio_admin}</p>}

      <dl className="mb-5 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[140px_1fr]">
        {linhas.map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="mb-1 min-w-0 break-words sm:mb-0">{v}</dd></div>))}
      </dl>

      <h3 className="mb-2 font-semibold">Ações</h3>
      <div className="mb-5 space-y-3 rounded-box border border-line p-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Estender o teste em" className="w-44"><Input inputMode="numeric" value={dias} onChange={(ev) => setDias(ev.target.value.replace(/\D/g, '').slice(0, 3))} aria-label="Dias" /></Field>
          <span className="pb-2.5 text-sm text-muted">dias</span>
          <Button onClick={() => agir('estender_teste', { p_dias: Number(dias) }, `Teste estendido em ${dias} dias`)} disabled={!Number(dias)}>Estender teste</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {e.status === 'cortesia'
            ? <Button onClick={async () => { if (await confirmar({ titulo: 'Tirar a cortesia?', mensagem: 'A empresa volta a seguir o teste ou a assinatura que tinha.', confirmar: 'Tirar cortesia', perigo: false })) await agir('tirar_cortesia', {}, 'Cortesia removida') }}>Tirar cortesia</Button>
            : <Button onClick={async () => { if (await confirmar({ titulo: 'Dar cortesia?', mensagem: <>A <b>{e.nome}</b> passa a usar o Apura sem pagar, sem prazo. {e.assinada && 'Atenção: a assinatura no Asaas continua ativa; cancele lá se não quiser mais cobrar.'}</>, confirmar: 'Dar cortesia', perigo: false })) await agir('cortesia', {}, 'Cortesia liberada') }}>Dar cortesia</Button>}
          {e.bloqueio_admin
            ? <Button onClick={() => agir('desbloquear', {}, 'Empresa desbloqueada')}>Desbloquear</Button>
            : <Button variant="ghost" className="text-bad hover:text-bad" onClick={() => setBloqueando((b) => !b)}>Bloquear…</Button>}
        </div>
        {bloqueando && !e.bloqueio_admin && (
          <div className="space-y-2 rounded-box bg-bad/5 p-3">
            <Field label="Motivo do bloqueio (fica só para você)"><Textarea value={motivo} onChange={(ev) => setMotivo(ev.target.value)} maxLength={300} placeholder="Ex.: uso indevido, chargeback, pedido do cliente" /></Field>
            <p className="text-xs text-muted">A empresa fica em só leitura: vê os dados, mas não lança nada. O cliente vê o aviso “Conta suspensa” com o e-mail de contato. Um pagamento não desfaz o bloqueio.</p>
            <Button variant="danger" disabled={!motivo.trim()} onClick={async () => { if (await agir('bloquear', { p_motivo: motivo.trim() }, 'Empresa bloqueada')) { setBloqueando(false); setMotivo('') } }}>Bloquear empresa</Button>
          </div>
        )}
      </div>

      <h3 className="mb-2 font-semibold">Histórico do admin</h3>
      {!(hist as Log[] | null)?.length ? <p className="text-sm text-muted">Nenhuma ação ainda.</p> : (
        <ul className="space-y-1.5 text-sm">
          {(hist as Log[]).map((l, i) => (
            <li key={i} className="flex flex-wrap gap-x-2"><span className="num text-muted">{new Date(l.feito_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
              <span>{ACAO[l.acao] ?? l.acao}{l.detalhe?.dias ? ` (+${l.detalhe.dias} dias)` : ''}{l.detalhe?.motivo ? `: ${l.detalhe.motivo}` : ''}</span></li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
