import { useEffect, useState } from 'react'
import { Check, ExternalLink } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLoad } from '../lib/useQuery'
import { Badge, Button, ErrorBox, Field, Input, PageHeader, Panel, useConfirm, useToast } from '../components/ui'

type Plano = { codigo: string; nome: string; preco: number; limite_vendas: number }
const brl = (n: number) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (d: string | null) => (d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('pt-BR') : '')

async function chamar(acao: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('assinatura', { body: { acao, ...extra } })
  if (error) {
    const ctx = (error as { context?: Response }).context
    const corpo = ctx ? await ctx.json().catch(() => null) : null
    throw new Error(corpo?.erro ?? error.message)
  }
  if (data?.erro) throw new Error(data.erro)
  return data as { url?: string | null; trocou?: boolean }
}

/** Máscara simples de CPF/CNPJ */
function mascaraDoc(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14)
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2')
}

export default function Assinatura() {
  const { assinatura: a, recarregarAssinatura, ehDono } = useAuth()
  const toast = useToast()
  const confirmar = useConfirm()
  const planos = useLoad<Plano[]>(() => supabase.from('plano').select('codigo, nome, preco, limite_vendas').eq('ativo', true).order('ordem'), [])
  const [escolhido, setEscolhido] = useState<string>('')
  const [doc, setDoc] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { recarregarAssinatura() }, [recarregarAssinatura])
  useEffect(() => {
    if (a && !escolhido) setEscolhido(planos.data?.some((p) => p.codigo === a.plano) ? a.plano : 'crescimento')
    if (a?.documento && !doc) setDoc(mascaraDoc(a.documento))
  }, [a, planos.data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!a) return null
  const lista = planos.data ?? []
  const atual = lista.find((p) => p.codigo === a.plano)
  const plano = lista.find((p) => p.codigo === escolhido)
  const limite = a.limite_vendas ?? null

  async function assinar() {
    setErro(null)
    if (!plano) return setErro('Escolha um plano.')
    const digitos = doc.replace(/\D/g, '')
    if (!a!.assinada && digitos.length !== 11 && digitos.length !== 14) return setErro('Informe o CPF ou CNPJ de quem vai pagar (vai na nota da cobrança).')
    setBusy(true)
    try {
      const r = await chamar('assinar', { plano: plano.codigo, documento: digitos })
      await recarregarAssinatura()
      if (r.trocou) toast(`Plano trocado para ${plano.nome}.`)
      if (r.url && (!r.trocou || a!.situacao !== 'ativa')) window.location.href = r.url
      else if (!r.trocou) toast('Assinatura criada. A cobrança chega no seu e-mail.')
    } catch (e) { setErro((e as Error).message) } finally { setBusy(false) }
  }

  async function pagar() {
    setErro(null); setBusy(true)
    try {
      const r = a!.cobranca_url ? { url: a!.cobranca_url } : await chamar('fatura')
      if (r.url) window.location.href = r.url
      else setErro('Não há cobrança em aberto agora.')
    } catch (e) { setErro((e as Error).message) } finally { setBusy(false) }
  }

  async function cancelar() {
    const ok = await confirmar({
      titulo: 'Cancelar assinatura?',
      mensagem: a!.pago_ate ? `Você continua usando normalmente até ${dataBR(a!.pago_ate)}. Depois a conta fica só leitura — nada é apagado.` : 'A conta fica só leitura ao fim do teste — nada é apagado.',
      confirmar: 'Cancelar assinatura', perigo: true,
    })
    if (!ok) return
    setBusy(true); setErro(null)
    try { await chamar('cancelar'); await recarregarAssinatura(); toast('Assinatura cancelada.') }
    catch (e) { setErro((e as Error).message) } finally { setBusy(false) }
  }

  const situacao = {
    cortesia: <Badge tone="good">Cortesia</Badge>,
    teste: <Badge tone="warn">Teste grátis · {a.dias_teste} {a.dias_teste === 1 ? 'dia' : 'dias'}</Badge>,
    ativa: <Badge tone="good">Ativa</Badge>,
    atrasada: <Badge tone="warn">Pagamento atrasado</Badge>,
    cancelada: <Badge>Cancelada</Badge>,
    bloqueada: <Badge tone="bad">Só leitura</Badge>,
  }[a.situacao]

  return (
    <>
      <PageHeader title="Assinatura" sub="Seu plano do Lucrei, cobrança e uso do mês." />

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Situação" actions={situacao}>
          <dl className="space-y-2 p-4 text-sm">
            {a.situacao === 'cortesia' && <p className="text-muted">Esta empresa não é cobrada.</p>}
            {a.situacao === 'teste' && <div className="flex justify-between"><dt className="text-muted">Teste grátis até</dt><dd className="font-medium">{dataBR(a.teste_ate)}</dd></div>}
            {a.assinada && atual && <div className="flex justify-between"><dt className="text-muted">Plano</dt><dd className="font-medium">{atual.nome} · {brl(atual.preco)}/mês</dd></div>}
            {a.pago_ate && <div className="flex justify-between"><dt className="text-muted">{a.situacao === 'cancelada' ? 'Acesso até' : 'Pago até'}</dt><dd className="font-medium">{dataBR(a.pago_ate)}</dd></div>}
            {a.cobranca_vencimento && <div className="flex justify-between"><dt className="text-muted">Próxima cobrança vence</dt><dd className="font-medium">{dataBR(a.cobranca_vencimento)}</dd></div>}
            {a.situacao === 'bloqueada' && <p className="rounded-box bg-bad/10 p-2.5 text-bad">Sua conta está em <b>só leitura</b>: você vê tudo, mas não lança nada novo. Assine ou pague a cobrança em aberto para liberar na hora.</p>}
            {a.situacao === 'atrasada' && <p className="rounded-box bg-warn/10 p-2.5 text-warn">A cobrança venceu. Pague para não ficar em modo só leitura.</p>}
          </dl>
          {ehDono && a.situacao !== 'cortesia' && (a.cobranca_url || a.situacao === 'atrasada' || (a.situacao === 'bloqueada' && a.assinada)) && (
            <div className="border-t border-line p-4"><Button variant="primary" disabled={busy} onClick={pagar}><ExternalLink size={15} /> Pagar cobrança em aberto</Button></div>
          )}
        </Panel>

        <Panel title="Vendas neste mês">
          <div className="p-4">
            <p className="wide num text-3xl font-bold">{a.vendas_mes}{limite && a.situacao !== 'teste' && a.situacao !== 'cortesia' ? <span className="text-lg font-medium text-muted"> de {limite}</span> : null}</p>
            {limite && a.situacao !== 'teste' && a.situacao !== 'cortesia' ? (
              <>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full ${a.vendas_mes > limite ? 'bg-bad' : 'bg-led'}`} style={{ width: `${Math.min(100, (a.vendas_mes / limite) * 100)}%` }} /></div>
                {a.vendas_mes > limite && <p className="mt-2 text-sm text-bad">Você passou do limite do seu plano. Troque para um plano maior abaixo.</p>}
              </>
            ) : <p className="mt-1 text-sm text-muted">Vendas lançadas no mês, sem contar canceladas. É o que conta para o limite do plano.</p>}
          </div>
        </Panel>
      </div>

      {ehDono && a.situacao !== 'cortesia' && (
        <Panel className="mt-4" title={a.assinada ? 'Trocar de plano' : 'Escolha seu plano'}>
          <div className="grid gap-3 p-4 md:grid-cols-3">
            {lista.map((p) => {
              const sel = p.codigo === escolhido
              const sugerido = a.vendas_mes <= p.limite_vendas && !lista.some((q) => q.limite_vendas < p.limite_vendas && a.vendas_mes <= q.limite_vendas)
              return (
                <button key={p.codigo} type="button" onClick={() => setEscolhido(p.codigo)}
                  className={`relative rounded-box border p-4 text-left transition ${sel ? 'border-led bg-led/10 shadow-[0_0_0_1px_rgb(var(--led))]' : 'border-line hover:bg-line/30'}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{p.nome}</span>
                    {sel && <Check size={18} className="text-led" />}
                  </div>
                  <p className="wide num mt-2 text-2xl font-bold">{brl(p.preco)}<span className="text-sm font-normal text-muted">/mês</span></p>
                  <p className="mt-1 text-sm text-muted">Até {p.limite_vendas.toLocaleString('pt-BR')} vendas por mês</p>
                  {a.assinada && p.codigo === a.plano && <p className="mt-2 text-xs font-semibold text-ledink">Seu plano atual</p>}
                  {!a.assinada && sugerido && <p className="mt-2 text-xs font-semibold text-ledink">Cabe no seu volume atual</p>}
                </button>
              )
            })}
          </div>
          <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-[minmax(0,280px)_auto] sm:items-end">
            {!a.assinada && (
              <Field label="CPF ou CNPJ de quem paga" hint="Obrigatório para emitir a cobrança.">
                <Input inputMode="numeric" value={doc} onChange={(e) => setDoc(mascaraDoc(e.target.value))} placeholder="000.000.000-00" />
              </Field>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" disabled={busy || !plano || (a.assinada && escolhido === a.plano)} onClick={assinar}>
                {a.assinada ? `Trocar para ${plano?.nome ?? '…'}` : `Assinar ${plano?.nome ?? ''} · ${plano ? brl(plano.preco) : ''}/mês`}
              </Button>
              {!a.assinada && a.situacao === 'teste' && <span className="text-sm text-muted">A 1ª cobrança vence em {dataBR(a.teste_ate)}, no fim do teste. Você não perde dias grátis.</span>}
            </div>
          </div>
          <p className="px-4 pb-4 text-sm text-muted">Pagamento por Pix, boleto ou cartão, na página segura do Asaas. A cobrança de cada mês também chega por e-mail.</p>
          <div className="px-4 pb-3"><ErrorBox msg={erro} /></div>
        </Panel>
      )}

      {!ehDono && <p className="mt-4 text-sm text-muted">Só o dono da empresa pode assinar ou trocar de plano.</p>}

      {ehDono && a.assinada && (
        <div className="mt-6 text-right">
          <button disabled={busy} onClick={cancelar} className="text-sm text-muted underline hover:text-bad">Cancelar assinatura</button>
        </div>
      )}
    </>
  )
}
