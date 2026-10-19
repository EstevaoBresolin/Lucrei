import { useState } from 'react'
import { Plus } from 'lucide-react'
import { supabase, erroMsg } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { docValido, emailValido, mascaraDoc, mascaraTel, normNome, telValido } from '../lib/fmt'
import type { Cliente, Fornecedor } from '../lib/types'
import { Badge, BotaoExcluir, Button, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Panel, Table, Textarea, useConfirm, useToast } from '../components/ui'
import { useAuth } from '../lib/auth'

type Aba = 'fornecedores' | 'clientes'

export default function Cadastros() {
  const { modulo } = useAuth()
  const abas = ([['clientes', 'Clientes'], ['fornecedores', 'Fornecedores']] as [Aba, string][]).filter(([k]) => modulo(k))
  const [escolhida, setAba] = useState<Aba>(abas[0]?.[0] ?? 'clientes')
  const aba = abas.some(([k]) => k === escolhida) ? escolhida : abas[0]?.[0]
  return (
    <div>
      <PageHeader title={abas.map(([, l]) => l).join(' e ')} />
      <div role="tablist" className="mb-5 flex gap-1 border-b border-line">
        {abas.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)} className={`px-3 pb-2.5 pt-1 text-[15px] ${aba === k ? 'led-strip font-semibold' : 'text-muted hover:text-ink'}`}>{l}</button>
        ))}
      </div>
      {aba === 'fornecedores' ? <Fornecedores /> : <Clientes />}
    </div>
  )
}

function Fornecedores() {
  const toast = useToast()
  const confirmar = useConfirm()
  const { isAdmin } = useAuth()
  const { data, carregando, erro, recarregar } = useLoad<Fornecedor[]>(() => supabase.from('fornecedor').select('*').order('nome'), [])
  const [ed, setEd] = useState<Partial<Fornecedor> | null>(null)
  const [err, setErr] = useState<string | null>(null)
  async function salvar() {
    if (!ed?.nome?.trim()) return setErr('Informe o nome.')
    if (ed.documento && !docValido(ed.documento)) return setErr('CNPJ ou CPF inválido. Confira os números.')
    if (ed.whatsapp && !telValido(ed.whatsapp)) return setErr('WhatsApp incompleto: informe DDD + número.')
    if (ed.telefone && !telValido(ed.telefone)) return setErr('Telefone incompleto: informe DDD + número.')
    if (ed.email && !emailValido(ed.email)) return setErr('E-mail inválido.')
    if (ed.prazo_entrega_dias != null && ed.prazo_entrega_dias > 365) return setErr('Prazo de entrega muito alto (máximo 365 dias).')
    const igual = (data ?? []).find((x) => x.id !== ed.id && normNome(x.nome) === normNome(ed.nome!))
    if (igual) return setErr(`Já existe um fornecedor chamado "${igual.nome}".`)
    const row = { nome: ed.nome.trim(), documento: ed.documento || null, telefone: ed.telefone || null, whatsapp: ed.whatsapp || null, email: ed.email?.trim() || null, prazo_entrega_dias: ed.prazo_entrega_dias || null, observacoes: ed.observacoes || null, ativo: ed.ativo ?? true }
    const r = ed.id ? await supabase.from('fornecedor').update(row).eq('id', ed.id) : await supabase.from('fornecedor').insert(row)
    if (r.error) return setErr(erroMsg(r.error))
    toast('Fornecedor salvo.'); setEd(null); recarregar()
  }
  async function excluir() {
    if (!ed?.id) return
    if (!(await confirmar({ titulo: `Excluir ${ed.nome}?`, mensagem: 'Se o fornecedor já tiver compras, produtos ou insumos ligados a ele, não dá para excluir. Nesse caso, desmarque "Ativo".' }))) return
    const { error } = await supabase.from('fornecedor').delete().eq('id', ed.id)
    if (error) return setErr(erroMsg(error))
    toast('Fornecedor excluído.'); setEd(null); recarregar()
  }
  return (
    <>
      <div className="mb-4 flex justify-end"><Button size="sm" variant="primary" onClick={() => { setErr(null); setEd({}) }}><Plus size={15} /> Novo fornecedor</Button></div>
      <ErrorBox msg={erro} />
      <Panel>
        {carregando && !data ? <Loading /> : (data ?? []).length === 0 ? <Empty title="Nenhum fornecedor cadastrado" /> : (
          <Table head={<tr><th>Nome</th><th>WhatsApp</th><th>E-mail</th><th className="text-right">Prazo</th><th /></tr>}>
            {(data ?? []).map((f) => (
              <tr key={f.id} onClick={() => { setErr(null); setEd(f) }} className={`cursor-pointer hover:bg-line/30 ${!f.ativo ? 'text-muted' : ''}`}>
                <td className="font-medium">{f.nome}</td><td>{f.whatsapp}</td><td>{f.email}</td><td className="num text-right">{f.prazo_entrega_dias ? `${f.prazo_entrega_dias} dias` : ''}</td><td>{!f.ativo && <Badge>Inativo</Badge>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <Modal open={!!ed} onClose={() => setEd(null)} title={ed?.id ? 'Editar fornecedor' : 'Novo fornecedor'} footer={<>{ed?.id && isAdmin && <BotaoExcluir onClick={excluir} />}<Button onClick={() => setEd(null)}>Cancelar</Button><Button variant="primary" onClick={salvar}>Salvar</Button></>}>
        {ed && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" className="sm:col-span-2"><Input value={ed.nome ?? ''} onChange={(e) => setEd({ ...ed, nome: e.target.value })} /></Field>
            <Field label="CNPJ ou CPF"><Input inputMode="numeric" value={ed.documento ?? ''} onChange={(e) => setEd({ ...ed, documento: mascaraDoc(e.target.value) })} placeholder="00.000.000/0000-00" /></Field>
            <Field label="Prazo de entrega (dias)"><Input inputMode="numeric" value={ed.prazo_entrega_dias ?? ''} onChange={(e) => setEd({ ...ed, prazo_entrega_dias: Number(e.target.value.replace(/\D/g, '')) || null })} /></Field>
            <Field label="WhatsApp" hint="Com DDD. Usado no botão de pedido."><Input inputMode="tel" value={ed.whatsapp ?? ''} onChange={(e) => setEd({ ...ed, whatsapp: mascaraTel(e.target.value) })} placeholder="(54) 99999-9999" /></Field>
            <Field label="Telefone"><Input inputMode="tel" value={ed.telefone ?? ''} onChange={(e) => setEd({ ...ed, telefone: mascaraTel(e.target.value) })} placeholder="(54) 3222-1111" /></Field>
            <Field label="E-mail" className="sm:col-span-2"><Input type="email" value={ed.email ?? ''} onChange={(e) => setEd({ ...ed, email: e.target.value })} /></Field>
            <Field label="Observações" className="sm:col-span-2"><Textarea value={ed.observacoes ?? ''} onChange={(e) => setEd({ ...ed, observacoes: e.target.value })} rows={2} /></Field>
            {ed.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ed.ativo ?? true} onChange={(e) => setEd({ ...ed, ativo: e.target.checked })} /> Ativo</label>}
          </div>
        )}
        <div className="mt-3"><ErrorBox msg={err} /></div>
      </Modal>
    </>
  )
}

function Clientes() {
  const toast = useToast()
  const confirmar = useConfirm()
  const { isAdmin } = useAuth()
  const { data, carregando, erro, recarregar } = useLoad<(Cliente & { venda: { receita: number; status: string }[] })[]>(() => supabase.from('cliente').select('*, venda(receita,status)').order('nome'), [])
  const [ed, setEd] = useState<Partial<Cliente> | null>(null)
  const [busca, setBusca] = useState('')
  const [err, setErr] = useState<string | null>(null)
  async function salvar() {
    if (!ed?.nome?.trim()) return setErr('Informe o nome.')
    if (ed.whatsapp && !telValido(ed.whatsapp)) return setErr('WhatsApp incompleto: informe DDD + número.')
    if (ed.telefone && !telValido(ed.telefone)) return setErr('Telefone incompleto: informe DDD + número.')
    const row = { nome: ed.nome.trim(), telefone: ed.telefone || null, whatsapp: ed.whatsapp || null, cidade: ed.cidade || null, origem: ed.origem || null, observacoes: ed.observacoes || null }
    const r = ed.id ? await supabase.from('cliente').update(row).eq('id', ed.id) : await supabase.from('cliente').insert(row)
    if (r.error) return setErr(erroMsg(r.error))
    toast('Cliente salvo.'); setEd(null); recarregar()
  }
  async function excluir() {
    if (!ed?.id) return
    if (!(await confirmar({ titulo: `Excluir ${ed.nome}?`, mensagem: 'Clientes com vendas lançadas não podem ser excluídos, para não perder o histórico.' }))) return
    const { error } = await supabase.from('cliente').delete().eq('id', ed.id)
    if (error) return setErr(erroMsg(error))
    toast('Cliente excluído.'); setEd(null); recarregar()
  }
  const lista = (data ?? []).filter((c) => !busca || `${c.nome} ${c.cidade ?? ''} ${c.whatsapp ?? ''}`.toLowerCase().includes(busca.toLowerCase()))
  return (
    <>
      <div className="mb-4 flex flex-wrap justify-between gap-2">
        <Input placeholder="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} className="max-w-xs" />
        <Button size="sm" variant="primary" onClick={() => { setErr(null); setEd({}) }}><Plus size={15} /> Novo cliente</Button>
      </div>
      <ErrorBox msg={erro} />
      <Panel>
        {carregando && !data ? <Loading /> : lista.length === 0 ? <Empty title="Nenhum cliente cadastrado">Útil para as vendas diretas e para chamar quem já comprou.</Empty> : (
          <Table head={<tr><th>Nome</th><th>WhatsApp</th><th>Cidade</th><th>Origem</th><th className="text-right">Compras</th><th className="text-right">Total gasto</th></tr>}>
            {lista.map((c) => {
              const v = c.venda.filter((x) => x.status !== 'cancelada' && x.status !== 'devolvida')
              return (
                <tr key={c.id} onClick={() => { setErr(null); setEd(c) }} className="cursor-pointer hover:bg-line/30">
                  <td className="font-medium">{c.nome}</td><td>{c.whatsapp}</td><td>{c.cidade}</td><td>{c.origem}</td>
                  <td className="num text-right">{v.length}</td>
                  <td className="num text-right">{v.reduce((s, x) => s + Number(x.receita), 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                </tr>
              )
            })}
          </Table>
        )}
      </Panel>
      <Modal open={!!ed} onClose={() => setEd(null)} title={ed?.id ? 'Editar cliente' : 'Novo cliente'} footer={<>{ed?.id && isAdmin && <BotaoExcluir onClick={excluir} />}<Button onClick={() => setEd(null)}>Cancelar</Button><Button variant="primary" onClick={salvar}>Salvar</Button></>}>
        {ed && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" className="sm:col-span-2"><Input value={ed.nome ?? ''} onChange={(e) => setEd({ ...ed, nome: e.target.value })} /></Field>
            <Field label="WhatsApp"><Input inputMode="tel" value={ed.whatsapp ?? ''} onChange={(e) => setEd({ ...ed, whatsapp: mascaraTel(e.target.value) })} placeholder="(54) 99999-9999" /></Field>
            <Field label="Telefone"><Input inputMode="tel" value={ed.telefone ?? ''} onChange={(e) => setEd({ ...ed, telefone: mascaraTel(e.target.value) })} placeholder="(54) 3222-1111" /></Field>
            <Field label="Cidade" className="sm:col-span-2"><Input value={ed.cidade ?? ''} onChange={(e) => setEd({ ...ed, cidade: e.target.value })} placeholder="Caxias do Sul" /></Field>
            <Field label="Como conheceu" className="sm:col-span-2">
              <Input list="origens" value={ed.origem ?? ''} onChange={(e) => setEd({ ...ed, origem: e.target.value })} />
              <datalist id="origens"><option>Mercado Livre</option><option>Indicação</option><option>Instagram</option><option>WhatsApp</option><option>Feira</option></datalist>
            </Field>
            <Field label="Observações" className="sm:col-span-2"><Textarea value={ed.observacoes ?? ''} onChange={(e) => setEd({ ...ed, observacoes: e.target.value })} rows={2} /></Field>
          </div>
        )}
        <div className="mt-3"><ErrorBox msg={err} /></div>
      </Modal>
    </>
  )
}
