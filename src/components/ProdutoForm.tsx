import { useEffect, useState } from 'react'
import { supabase, erroMsg } from '../lib/supabase'
import { normNome, parseNum } from '../lib/fmt'
import { TIPO_PRODUTO, type Categoria, type Produto, type TipoProduto } from '../lib/types'
import { BotaoExcluir, Button, ErrorBox, Field, Input, Modal, NumInput, Select, Textarea, useConfirm, useToast } from './ui'
import { useAuth } from '../lib/auth'

const br = (n: number | null | undefined) => (n == null ? '' : String(Number(n)).replace('.', ','))

/**
 * Cadastro/edição de produto. Com `copiaDe`, abre como cadastro novo já preenchido
 * com os dados daquele produto; ao salvar, a ficha técnica e os preços também são copiados.
 */
export default function ProdutoForm({ open, onClose, onSaved, onDeleted, produto, copiaDe }: { open: boolean; onClose: () => void; onSaved: (id: string) => void; onDeleted?: () => void; produto?: Produto | null; copiaDe?: Produto | null }) {
  const toast = useToast()
  const confirmar = useConfirm()
  const { isAdmin, modulo, empresa } = useAuth()
  const [cats, setCats] = useState<Categoria[]>([])
  const [forns, setForns] = useState<{ id: string; nome: string }[]>([])
  const tipoPadrao: TipoProduto = empresa?.tipo_negocio === 'fabricacao' && modulo('producao') ? 'fabricado' : 'revenda'
  const [f, setF] = useState({ tipo: tipoPadrao as TipoProduto, nome: '', sku: '', categoria_id: '', fornecedor_padrao_id: '', custo_padrao: '', custos_fixos_unit: '', estoque_minimo: '', observacoes: '', ativo: true })
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    supabase.from('categoria').select('*').eq('tipo', 'produto').order('nome').then(({ data }) => setCats((data ?? []) as Categoria[]))
    supabase.from('fornecedor').select('id,nome').eq('ativo', true).order('nome').then(({ data }) => setForns(data ?? []))
    setErro(null)
    const base = produto ?? copiaDe
    setF({
      tipo: base?.tipo ?? tipoPadrao,
      nome: copiaDe ? `${copiaDe.nome} (cópia)` : base?.nome ?? '',
      // SKU identifica um produto só: na cópia começa vazio.
      sku: copiaDe ? '' : base?.sku ?? '', categoria_id: base?.categoria_id ?? '', fornecedor_padrao_id: base?.fornecedor_padrao_id ?? '',
      custo_padrao: br(base?.custo_padrao), custos_fixos_unit: br(base?.custos_fixos_unit), estoque_minimo: br(base?.estoque_minimo),
      observacoes: base?.observacoes ?? '', ativo: copiaDe ? true : base?.ativo ?? true,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, produto, copiaDe])

  const tipos = (Object.keys(TIPO_PRODUTO) as TipoProduto[]).filter((t) => t === f.tipo || t === 'revenda' || (t === 'fabricado' && modulo('producao')) || (t === 'kit' && modulo('kits')))

  async function salvar() {
    if (!f.nome.trim()) return setErro('Dê um nome ao produto.')
    if (produto && f.tipo === 'kit' && produto.tipo !== 'kit' && Number(produto.saldo) !== 0)
      return setErro('Este produto tem estoque. Kit não tem estoque próprio: zere o saldo antes de transformá-lo em kit, ou crie um produto novo do tipo kit.')
    setBusy(true); setErro(null)
    const existentes = await supabase.from('produto').select('id,nome')
    if (existentes.error) { setBusy(false); return setErro(erroMsg(existentes.error)) }
    const igual = existentes.data.find((x) => x.id !== produto?.id && normNome(x.nome) === normNome(f.nome))
    if (igual) { setBusy(false); return setErro(`Já existe um produto chamado "${igual.nome}". Use outro nome.`) }
    const row = {
      tipo: f.tipo, nome: f.nome.trim(), sku: f.sku.trim() || null, categoria_id: f.categoria_id || null,
      fornecedor_padrao_id: f.fornecedor_padrao_id || null,
      custo_padrao: f.tipo === 'kit' ? 0 : parseNum(f.custo_padrao), custos_fixos_unit: f.tipo === 'revenda' ? 0 : parseNum(f.custos_fixos_unit),
      estoque_minimo: f.tipo === 'kit' ? 0 : parseNum(f.estoque_minimo), observacoes: f.observacoes.trim() || null, ativo: f.ativo,
    }
    const r = produto
      ? await supabase.from('produto').update(row).eq('id', produto.id).select('id').single()
      : await supabase.from('produto').insert(row).select('id').single()
    if (r.error) { setBusy(false); return setErro(erroMsg(r.error)) }
    if (copiaDe) {
      const [ficha, kit, precos] = await Promise.all([
        supabase.from('ficha_tecnica_item').select('material_id,quantidade,perc_perda').eq('produto_id', copiaDe.id),
        supabase.from('kit_item').select('produto_id,quantidade').eq('kit_id', copiaDe.id),
        supabase.from('preco_canal').select('canal_id,preco_venda').eq('produto_id', copiaDe.id),
      ])
      const erros = [ficha.error, kit.error, precos.error]
      if (ficha.data?.length) erros.push((await supabase.from('ficha_tecnica_item').insert(ficha.data.map((i) => ({ ...i, produto_id: r.data.id })))).error)
      if (kit.data?.length) erros.push((await supabase.from('kit_item').insert(kit.data.map((i) => ({ ...i, kit_id: r.data.id })))).error)
      if (precos.data?.length) erros.push((await supabase.from('preco_canal').insert(precos.data.map((p) => ({ ...p, produto_id: r.data.id })))).error)
      const e = erros.find(Boolean)
      if (e) toast(`Produto criado, mas a composição ou os preços não foram copiados por completo: ${erroMsg(e)}`)
    }
    setBusy(false)
    toast(produto ? 'Produto salvo.' : copiaDe ? 'Produto duplicado.' : 'Produto cadastrado.')
    onSaved(r.data.id)
  }
  async function excluir() {
    if (!produto) return
    if (!(await confirmar({ titulo: `Excluir ${produto.nome}?`, mensagem: 'A ficha técnica, a composição do kit, os preços, o saldo inicial e os ajustes manuais dele também são apagados. Produto que já teve venda, compra ou produção não pode ser excluído; nesse caso, desmarque "Produto ativo".' }))) return
    setBusy(true)
    const { error } = await supabase.rpc('excluir_produto', { p_id: produto.id })
    setBusy(false)
    if (error) return setErro(erroMsg(error))
    toast('Produto excluído.'); onDeleted?.()
  }
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v })

  return (
    <Modal open={open} onClose={onClose} title={produto ? 'Editar produto' : copiaDe ? `Duplicar ${copiaDe.nome}` : 'Novo produto'} wide
      footer={<>{produto && isAdmin && onDeleted && <BotaoExcluir disabled={busy} onClick={excluir} />}<Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={busy} onClick={salvar}>{produto ? 'Salvar' : 'Cadastrar produto'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {tipos.length > 1 && (
          <Field label="Tipo" className="sm:col-span-2">
            <div className="grid gap-2 sm:grid-cols-3">
              {tipos.map((t) => (
                <button key={t} type="button" onClick={() => setF({ ...f, tipo: t })}
                  className={`rounded-box border p-2.5 text-left text-sm ${f.tipo === t ? 'border-led bg-led/10' : 'border-line hover:border-muted'}`}>
                  <span className="block font-semibold">{TIPO_PRODUTO[t].nome}</span>
                  <span className="text-xs text-muted">{TIPO_PRODUTO[t].texto}</span>
                </button>
              ))}
            </div>
          </Field>
        )}
        <Field label="Nome" className="sm:col-span-2"><Input value={f.nome} onChange={(e) => set('nome')(e.target.value)} placeholder={f.tipo === 'kit' ? 'Kit 2 unidades' : 'Nome do produto'} /></Field>
        <Field label="SKU (código interno)"><Input value={f.sku} onChange={(e) => set('sku')(e.target.value)} /></Field>
        <Field label="Categoria"><Select value={f.categoria_id} onChange={(e) => set('categoria_id')(e.target.value)}><option value="">Sem categoria</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field>
        {f.tipo === 'revenda' && (
          <>
            <Field label="Custo de compra (R$)" hint="Use até a primeira compra lançada. Depois o custo médio das compras passa a valer."><NumInput value={f.custo_padrao} onChange={set('custo_padrao')} /></Field>
            {modulo('fornecedores') && <Field label="Fornecedor principal"><Select value={f.fornecedor_padrao_id} onChange={(e) => set('fornecedor_padrao_id')(e.target.value)}><option value="">Nenhum</option>{forns.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>}
          </>
        )}
        {f.tipo === 'fabricado' && (
          <>
            <Field label="Custo unitário informado (R$)" hint="Use enquanto não cadastrar a ficha técnica. Depois da primeira produção, o custo real passa a valer."><NumInput value={f.custo_padrao} onChange={set('custo_padrao')} /></Field>
            <Field label="Custos fixos por unidade (R$)" hint="Embalagem, energia… somados ao custo da ficha."><NumInput value={f.custos_fixos_unit} onChange={set('custos_fixos_unit')} /></Field>
          </>
        )}
        {f.tipo === 'kit' && (
          <Field label="Custo extra por kit (R$)" hint="Embalagem do kit, brinde… somado ao custo dos produtos que o compõem."><NumInput value={f.custos_fixos_unit} onChange={set('custos_fixos_unit')} /></Field>
        )}
        {f.tipo !== 'kit' && <Field label="Estoque mínimo" hint="Avisa no painel quando o saldo chegar aqui."><NumInput value={f.estoque_minimo} onChange={set('estoque_minimo')} /></Field>}
        <Field label="Observações" className="sm:col-span-2"><Textarea value={f.observacoes} onChange={(e) => set('observacoes')(e.target.value)} rows={2} /></Field>
        {produto && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Produto ativo (aparece nas vendas)</label>}
      </div>
      {f.tipo === 'kit' && !produto && <p className="mt-4 text-sm text-muted">Depois de cadastrar, você escolhe quais produtos (e quantos de cada) formam o kit.</p>}
      {copiaDe && <p className="mt-4 text-sm text-muted">A composição (ficha técnica ou kit) e os preços por canal também serão copiados. O estoque começa em zero.</p>}
      <div className="mt-3"><ErrorBox msg={erro} /></div>
    </Modal>
  )
}
