import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { supabase, erroMsg } from '../lib/supabase'
import { dataBR, hoje, money, parseNum } from '../lib/fmt'
import { Button, ErrorBox, Field, Input, Modal, NumInput, Select, useConfirm, useToast } from './ui'
import { useContas } from './Contas'

/** Total, pago e a pagar de uma compra (vw_compra_financeiro, só o dono vê). */
export type CompraFin = { id: string; numero: number; status: string; data: string; fornecedor: string | null; total: number; pago: number }
type Pagamento = { id: string; data: string; valor: number; observacao: string | null; conta: { nome: string } | null }

export const falta = (c: CompraFin) => Math.max(0, Math.round((Number(c.total) - Number(c.pago)) * 100) / 100)

/**
 * Lança um pagamento de compra (adiantamento, parcela ou o restante) e mostra os já lançados.
 * O dinheiro sai da conta na data do pagamento, independente de a compra já ter sido recebida.
 */
export function PagarCompra({ compra, contaSugerida, onClose, onSalvo }: { compra: CompraFin | null; contaSugerida?: string | null; onClose: () => void; onSalvo: () => void }) {
  const toast = useToast()
  const confirmar = useConfirm()
  const contas = useContas()
  const [lista, setLista] = useState<Pagamento[]>([])
  const [f, setF] = useState({ valor: '', data: hoje(), conta: '', obs: '' })
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const restante = compra ? falta(compra) : 0

  async function carregar() {
    if (!compra) return
    const { data, error } = await supabase.from('compra_pagamento').select('id, data, valor, observacao, conta:conta_financeira(nome)').eq('compra_id', compra.id).order('data').order('created_at')
    if (error) setErro(erroMsg(error))
    setLista((data ?? []) as unknown as Pagamento[])
  }
  useEffect(() => {
    if (!compra) return
    setF({ valor: restante > 0 ? String(restante).replace('.', ',') : '', data: hoje(), conta: '', obs: '' })
    setErro(null); carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compra?.id])
  useEffect(() => {
    // Conta já usada nesta compra, senão a padrão
    if (compra && !f.conta && contas.length) setF((x) => ({ ...x, conta: contas.find((c) => c.id === contaSugerida)?.id ?? contas.find((c) => c.padrao)?.id ?? contas[0].id }))
  }, [contas, compra, contaSugerida, f.conta])

  if (!compra) return null

  async function salvar() {
    const valor = parseNum(f.valor)
    if (!(valor > 0)) return setErro('Informe o valor pago.')
    if (valor > restante + 0.009) return setErro(`O valor passa do que falta pagar (${money(restante)}).`)
    if (!f.data) return setErro('Informe a data do pagamento.')
    if (f.data > hoje()) return setErro('A data do pagamento não pode ser no futuro.')
    if (!f.conta) return setErro('Cadastre uma conta em Finanças antes de lançar pagamentos.')
    setBusy(true); setErro(null)
    const { error } = await supabase.from('compra_pagamento').insert({ compra_id: compra!.id, conta_id: f.conta, data: f.data, valor, observacao: f.obs.trim() || null })
    setBusy(false)
    if (error) return setErro(erroMsg(error))
    toast(valor >= restante - 0.009 ? `Compra #${compra!.numero} paga.` : `Pagamento de ${money(valor)} lançado. Falta ${money(restante - valor)}.`)
    onSalvo()
  }
  async function excluir(p: Pagamento) {
    if (!(await confirmar({ titulo: `Excluir o pagamento de ${money(p.valor)}?`, mensagem: 'O valor volta para o saldo da conta.', confirmar: 'Excluir', perigo: true }))) return
    const { error } = await supabase.from('compra_pagamento').delete().eq('id', p.id)
    if (error) return setErro(erroMsg(error))
    toast('Pagamento excluído.'); onSalvo()
  }

  return (
    <Modal open onClose={onClose} title={`Pagamentos da compra #${compra.numero}`}
      footer={<><Button onClick={onClose}>Fechar</Button>{restante > 0 && <Button variant="primary" disabled={busy} onClick={salvar}>Lançar pagamento</Button>}</>}>
      <div className="flex flex-col gap-4 text-sm">
        <div className="num grid grid-cols-3 gap-px overflow-hidden rounded-box border border-line bg-line [&>*]:bg-panel">
          <div className="px-3 py-2"><span className="block text-xs text-muted">Total</span><b>{money(compra.total)}</b></div>
          <div className="px-3 py-2"><span className="block text-xs text-muted">Pago</span><b className="text-good">{money(compra.pago)}</b></div>
          <div className="px-3 py-2"><span className="block text-xs text-muted">Falta</span><b className={restante > 0 ? 'text-warn' : ''}>{money(restante)}</b></div>
        </div>

        {lista.length > 0 && (
          <ul className="divide-y divide-line rounded-box border border-line">
            {lista.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="num font-medium">{dataBR(p.data)} · {money(p.valor)}</span>
                  <span className="block truncate text-xs text-muted">{[p.conta?.nome, p.observacao].filter(Boolean).join(' · ')}</span>
                </span>
                <Button size="sm" variant="ghost" className="hover:text-bad" aria-label={`Excluir pagamento de ${money(p.valor)}`} onClick={() => excluir(p)}><Trash2 size={15} /></Button>
              </li>
            ))}
          </ul>
        )}

        {restante > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Valor pago (R$)" hint="Pode ser só o adiantamento. O resto você lança quando pagar.">
              <NumInput value={f.valor} onChange={(v) => setF({ ...f, valor: v })} />
            </Field>
            <Field label="Data do pagamento"><Input type="date" value={f.data} max={hoje()} onChange={(e) => setF({ ...f, data: e.target.value })} /></Field>
            {contas.length > 1 && (
              <Field label="Saiu da conta"><Select value={f.conta} onChange={(e) => setF({ ...f, conta: e.target.value })}>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field>
            )}
            <Field label="Observação (opcional)" className={contas.length > 1 ? '' : 'sm:col-span-2'}><Input value={f.obs} maxLength={200} onChange={(e) => setF({ ...f, obs: e.target.value })} placeholder="Adiantamento de 50%" /></Field>
          </div>
        ) : <p className="text-good">Compra paga por completo.</p>}
        <ErrorBox msg={erro} />
      </div>
    </Modal>
  )
}
