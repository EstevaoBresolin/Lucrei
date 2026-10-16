import { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { supabase, erroMsg } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { dataHoraBR, money, parseNum, qty } from '../lib/fmt'
import { TIPO_MOV, type Material, type Produto } from '../lib/types'
import { baixarCSV } from '../lib/csv'
import { Badge, Button, Empty, ErrorBox, Field, Input, Loading, Modal, NumInput, PageHeader, Panel, Select, Table, Textarea, useToast } from '../components/ui'

type Aba = 'produtos' | 'materiais' | 'movimentos' | 'inventario'
type Alvo = { tipo: 'produto' | 'material'; id: string; nome: string; saldo: number; unidade: string; custo: number }

export default function Estoque() {
  const { modulo, podeEditar } = useAuth()
  const insumos = modulo('producao')
  const [aba, setAba] = useState<Aba>('produtos')
  const [alvo, setAlvo] = useState<Alvo | null>(null)
  const prods = useLoad<Produto[]>(() => supabase.from('vw_produto_estoque').select('*').eq('ativo', true).neq('tipo', 'kit').order('nome'), [])
  const mats = useLoad<Material[]>(() => supabase.from('vw_material_estoque').select('*').eq('ativo', true).order('nome'), [])
  const recarregar = () => { prods.recarregar(); mats.recarregar() }
  const [busca, setBusca] = useState('')
  const f = (n: string) => !busca || n.toLowerCase().includes(busca.toLowerCase())

  function exportar() {
    const linhas = [
      ...(prods.data ?? []).map((p) => ['Produto', p.sku, p.nome, p.saldo, 'un', p.estoque_minimo, Number(p.custo_medio) || Number(p.custo_padrao), p.valor_estoque]),
      ...(mats.data ?? []).map((m) => ['Insumo', m.sku, m.nome, m.saldo, m.unidade_uso, m.estoque_minimo, m.custo_medio, m.valor_estoque]),
    ]
    baixarCSV(`estoque_${new Date().toISOString().slice(0, 10)}.csv`, ['Tipo', 'SKU', 'Nome', 'Saldo', 'Unidade', 'Mínimo', 'Custo médio', 'Valor'], linhas)
  }

  const tabs = ([['produtos', 'Produtos'], ['materiais', 'Insumos'], ['movimentos', 'Movimentações'], ['inventario', 'Inventário']] as [Aba, string][]).filter(([k]) => k !== 'materiais' || insumos)
  return (
    <div>
      <PageHeader title="Estoque" sub={`${money((prods.data ?? []).reduce((s, p) => s + Number(p.valor_estoque ?? 0), 0))} em produtos${insumos ? ` · ${money((mats.data ?? []).reduce((s, m) => s + Number(m.valor_estoque ?? 0), 0))} em insumos` : ''}`}
        actions={<Button size="sm" onClick={exportar}><Download size={15} /> Exportar estoque</Button>} />
      <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)}
            className={`whitespace-nowrap px-3 pb-2.5 pt-1 text-[15px] ${aba === k ? 'led-strip font-semibold' : 'text-muted hover:text-ink'}`}>{l}</button>
        ))}
      </div>

      {(aba === 'produtos' || aba === 'materiais') && <Input placeholder="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} className="mb-4 max-w-xs" />}

      {aba === 'produtos' && (
        <Panel>
          {prods.carregando && !prods.data ? <Loading /> : (prods.data ?? []).length === 0 ? <Empty title="Nenhum produto cadastrado" /> : (
            <Table head={<tr><th>Produto</th><th className="text-right">Saldo</th><th className="text-right">Mínimo</th><th className="text-right">Vendidos 30d</th><th className="text-right">Custo médio</th><th className="text-right">Valor</th><th /></tr>}>
              {(prods.data ?? []).filter((p) => f(p.nome)).map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.nome}</td>
                  <td className="num whitespace-nowrap text-right"><span className="mr-2">{qty(p.saldo)}</span>{p.situacao !== 'ok' && <Badge tone={p.situacao === 'zerado' ? 'bad' : 'warn'}>{p.situacao === 'zerado' ? 'Zerado' : 'Baixo'}</Badge>}</td>
                  <td className="num text-right text-muted">{qty(p.estoque_minimo)}</td>
                  <td className="num text-right">{qty(p.vendidos_30d)}</td>
                  <td className="num text-right">{money(Number(p.custo_medio) || Number(p.custo_padrao))}</td>
                  <td className="num text-right">{money(p.valor_estoque)}</td>
                  <td className="text-right">{podeEditar && <Button size="sm" onClick={() => setAlvo({ tipo: 'produto', id: p.id, nome: p.nome, saldo: Number(p.saldo), unidade: 'un', custo: Number(p.custo_medio) || Number(p.custo_padrao) })}>Movimentar</Button>}</td>
                </tr>
              ))}
            </Table>
          )}
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted">Produtos entram pela produção (Produção → concluir ordem) ou por entrada manual. Saem pelas vendas.</p>
        </Panel>
      )}

      {aba === 'materiais' && (
        <Panel>
          {mats.carregando && !mats.data ? <Loading /> : (mats.data ?? []).length === 0 ? <Empty title="Nenhum insumo cadastrado" /> : (
            <Table head={<tr><th>Insumo</th><th className="text-right">Saldo</th><th className="text-right">Mínimo</th><th className="text-right">Custo médio</th><th className="text-right">Valor</th><th /></tr>}>
              {(mats.data ?? []).filter((m) => f(m.nome)).map((m) => (
                <tr key={m.id}>
                  <td className="font-medium">{m.nome}</td>
                  <td className="num whitespace-nowrap text-right"><span className="mr-2">{qty(m.saldo)} {m.unidade_uso}</span>{m.situacao !== 'ok' && <Badge tone={m.situacao === 'zerado' ? 'bad' : 'warn'}>{m.situacao === 'zerado' ? 'Zerado' : 'Baixo'}</Badge>}</td>
                  <td className="num text-right text-muted">{qty(m.estoque_minimo)}</td>
                  <td className="num whitespace-nowrap text-right">{money(m.custo_medio)}<span className="text-xs text-muted">/{m.unidade_uso}</span></td>
                  <td className="num text-right">{money(m.valor_estoque)}</td>
                  <td className="text-right">{podeEditar && <Button size="sm" onClick={() => setAlvo({ tipo: 'material', id: m.id, nome: m.nome, saldo: Number(m.saldo), unidade: m.unidade_uso, custo: Number(m.custo_medio) })}>Movimentar</Button>}</td>
                </tr>
              ))}
            </Table>
          )}
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted">Insumos entram pelas compras recebidas e saem pela produção.</p>
        </Panel>
      )}

      {aba === 'movimentos' && <Movimentos />}
      {aba === 'inventario' && <Inventario onConcluido={recarregar} />}

      <Movimentar alvo={alvo} onClose={() => setAlvo(null)} onSaved={() => { setAlvo(null); recarregar() }} />
    </div>
  )
}

function Movimentar({ alvo, onClose, onSaved }: { alvo: Alvo | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [tipo, setTipo] = useState('entrada_manual')
  const [q, setQ] = useState('')
  const [custo, setCusto] = useState('')
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Cada item abre o formulário limpo (antes ficava o que foi digitado para o item anterior).
  useEffect(() => { setTipo('entrada_manual'); setQ(''); setCusto(''); setMotivo(''); setErro(null) }, [alvo?.id, alvo?.tipo])
  if (!alvo) return null
  const ajuste = tipo === 'ajuste'
  const delta = ajuste ? parseNum(q) - alvo.saldo : tipo === 'entrada_manual' ? parseNum(q) : -parseNum(q)

  async function salvar() {
    if (!alvo) return
    setErro(null)
    if (!ajuste && parseNum(q) <= 0) return setErro('Informe a quantidade.')
    if (ajuste && delta === 0) return setErro('O saldo informado é igual ao atual.')
    if (tipo !== 'entrada_manual' && !motivo.trim()) return setErro('Informe o motivo.')
    // Entrada sem custo entrava a R$ 0 quando o item ainda não tinha custo médio e derrubava a média.
    const custoEntrada = custo.trim() ? parseNum(custo) : alvo.custo
    if (tipo === 'entrada_manual' && !(custoEntrada > 0)) return setErro(`Informe o custo por ${alvo.unidade}. Sem custo, a entrada derruba o custo médio usado nas vendas.`)
    setBusy(true)
    const { error } = await supabase.rpc('movimentar_estoque', {
      p_item_tipo: alvo.tipo, p_item_id: alvo.id, p_tipo: tipo, p_quantidade: ajuste ? delta : parseNum(q),
      p_custo_unit: tipo === 'entrada_manual' ? custoEntrada : null, p_motivo: motivo,
    })
    setBusy(false)
    if (error) return setErro(erroMsg(error))
    toast('Movimento registrado.'); setQ(''); setCusto(''); setMotivo(''); onSaved()
  }

  return (
    <Modal open onClose={onClose} title={alvo.nome}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={busy} onClick={salvar}>Registrar</Button></>}>
      <p className="num mb-4 text-sm text-muted">Saldo atual: {qty(alvo.saldo)} {alvo.unidade}</p>
      <div className="flex flex-col gap-4">
        <Field label="O que aconteceu?">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="entrada_manual">Entrada (chegou sem compra lançada, saldo inicial…)</option>
            <option value="perda">Perda, quebra ou defeito</option>
            <option value="uso_interno">Uso interno ou amostra</option>
            <option value="ajuste">Corrigir saldo (contei e está diferente)</option>
          </Select>
        </Field>
        <Field label={ajuste ? `Saldo correto (${alvo.unidade})` : `Quantidade (${alvo.unidade})`}
          hint={ajuste && q ? `Diferença: ${delta > 0 ? '+' : ''}${qty(delta)}` : undefined}>
          <NumInput value={q} onChange={setQ} />
        </Field>
        {tipo === 'entrada_manual' && <Field label={`Custo por ${alvo.unidade} (R$)`} hint={alvo.custo > 0 ? `Vazio = usa o custo atual (${money(alvo.custo)}).` : 'Obrigatório: este item ainda não tem custo.'}><NumInput value={custo} onChange={setCusto} /></Field>}
        <Field label={tipo === 'entrada_manual' ? 'Observação (opcional)' : 'Motivo'}><Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} /></Field>
        <ErrorBox msg={erro} />
      </div>
    </Modal>
  )
}

type Mov = { id: string; data: string; tipo: string; item_tipo: string; quantidade: number; custo_unit: number; saldo_apos: number; motivo: string | null; material: { nome: string; unidade_uso: string } | null; produto: { nome: string } | null }

function Movimentos() {
  const insumos = useAuth().modulo('producao')
  const [itemTipo, setItemTipo] = useState('')
  const [tipo, setTipo] = useState('')
  const [busca, setBusca] = useState('')
  const { data, carregando, erro } = useLoad<Mov[]>(() => {
    let q = supabase.from('movimento_estoque').select('*, material(nome,unidade_uso), produto(nome)').order('data', { ascending: false }).limit(300)
    if (itemTipo) q = q.eq('item_tipo', itemTipo)
    if (tipo) q = q.eq('tipo', tipo)
    return q
  }, [itemTipo, tipo])
  const lista = useMemo(() => (data ?? []).filter((m) => !busca || (m.material?.nome ?? m.produto?.nome ?? '').toLowerCase().includes(busca.toLowerCase())), [data, busca])

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={itemTipo} onChange={(e) => setItemTipo(e.target.value)} className="w-auto"><option value="">Produtos e insumos</option><option value="produto">Só produtos</option>{insumos && <option value="material">Só insumos</option>}</Select>
        <Select value={tipo} onChange={(e) => setTipo(e.target.value)} className="w-auto"><option value="">Todos os tipos</option>{Object.entries(TIPO_MOV).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Input placeholder="Buscar item" value={busca} onChange={(e) => setBusca(e.target.value)} className="max-w-xs" />
        <Button size="sm" className="ml-auto self-center" onClick={() => baixarCSV('movimentacoes.csv', ['Data', 'Item', 'Tipo', 'Quantidade', 'Custo unit.', 'Saldo após', 'Motivo'],
          lista.map((m) => [dataHoraBR(m.data), m.material?.nome ?? m.produto?.nome, TIPO_MOV[m.tipo], m.quantidade, m.custo_unit, m.saldo_apos, m.motivo]))}><Download size={15} /> CSV</Button>
      </div>
      <ErrorBox msg={erro} />
      <Panel>
        {carregando && !data ? <Loading /> : lista.length === 0 ? <Empty title="Nenhuma movimentação ainda" /> : (
          <Table head={<tr><th>Quando</th><th>Item</th><th>Tipo</th><th className="text-right">Qtd.</th><th className="text-right">Custo unit.</th><th className="text-right">Saldo após</th><th>Motivo</th></tr>}>
            {lista.map((m) => (
              <tr key={m.id}>
                <td className="num whitespace-nowrap text-muted">{dataHoraBR(m.data)}</td>
                <td className="font-medium">{m.material?.nome ?? m.produto?.nome}</td>
                <td className="whitespace-nowrap">{TIPO_MOV[m.tipo]}</td>
                <td className={`num whitespace-nowrap text-right ${Number(m.quantidade) < 0 ? 'text-bad' : 'text-good'}`}>{Number(m.quantidade) > 0 ? '+' : ''}{qty(m.quantidade)} {m.material?.unidade_uso ?? 'un'}</td>
                <td className="num text-right">{money(m.custo_unit)}</td>
                <td className="num text-right">{qty(m.saldo_apos)}</td>
                <td className="max-w-56 truncate text-muted">{m.motivo}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  )
}

type Inv = { id: string; data: string; item_tipo: 'material' | 'produto'; status: string }
type InvItem = { id: string; saldo_sistema: number; saldo_contado: number | null; material: { nome: string; unidade_uso: string } | null; produto: { nome: string } | null }

function Inventario({ onConcluido }: { onConcluido: () => void }) {
  const insumos = useAuth().modulo('producao')
  const toast = useToast()
  const invs = useLoad<Inv[]>(() => supabase.from('inventario').select('*').order('data', { ascending: false }).limit(20), [])
  const aberto = (invs.data ?? []).find((i) => i.status === 'aberto')
  const itens = useLoad<InvItem[]>(() => aberto ? supabase.from('inventario_item').select('*, material(nome,unidade_uso), produto(nome)').eq('inventario_id', aberto.id) : Promise.resolve({ data: [], error: null }), [aberto?.id])
  const [contagem, setContagem] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function abrir(tipo: 'material' | 'produto') {
    setErro(null)
    const { error } = await supabase.rpc('abrir_inventario', { p_item_tipo: tipo })
    if (error) return setErro(erroMsg(error))
    setContagem({}); invs.recarregar()
  }
  async function salvarContagem(id: string, v: string) {
    await supabase.from('inventario_item').update({ saldo_contado: v.trim() === '' ? null : parseNum(v) }).eq('id', id)
  }
  async function concluir() {
    if (!aberto) return
    setBusy(true); setErro(null)
    for (const [id, v] of Object.entries(contagem)) await salvarContagem(id, v)
    const { error } = await supabase.rpc('concluir_inventario', { p_inv: aberto.id })
    setBusy(false)
    if (error) return setErro(erroMsg(error))
    toast('Inventário concluído. As diferenças viraram ajustes de estoque.')
    invs.recarregar(); onConcluido()
  }
  async function cancelar() {
    if (!aberto) return
    await supabase.from('inventario').update({ status: 'cancelado' }).eq('id', aberto.id)
    invs.recarregar()
  }

  if (invs.carregando && !invs.data) return <Loading />
  if (!aberto)
    return (
      <Panel>
        <div className="p-6">
          <p className="font-medium">Contagem física</p>
          <p className="mt-1 max-w-prose text-sm text-muted">Gere a lista, conte o que tem no estoque e digite. Ao concluir, o sistema ajusta cada diferença e registra no histórico.</p>
          <div className="mt-4 flex flex-wrap gap-2">{insumos && <Button onClick={() => abrir('material')}>Contar insumos</Button>}<Button onClick={() => abrir('produto')}>Contar produtos</Button></div>
          <div className="mt-3"><ErrorBox msg={erro} /></div>
        </div>
        {(invs.data ?? []).length > 0 && (
          <div className="border-t border-line px-6 py-4 text-sm text-muted">
            <p className="mb-2 font-medium text-ink">Contagens anteriores</p>
            {(invs.data ?? []).map((i) => <p key={i.id}>{dataHoraBR(i.data)}: {i.item_tipo === 'material' ? 'insumos' : 'produtos'} ({i.status})</p>)}
          </div>
        )}
      </Panel>
    )

  const lista = itens.data ?? []
  const contados = lista.filter((i) => (contagem[i.id] ?? (i.saldo_contado != null ? String(i.saldo_contado) : '')) !== '').length
  return (
    <Panel title={`Contagem de ${aberto.item_tipo === 'material' ? 'insumos' : 'produtos'} · ${contados} de ${lista.length} contados`}
      actions={<div className="flex gap-2"><Button size="sm" variant="ghost" onClick={cancelar}>Descartar</Button><Button size="sm" variant="primary" disabled={busy} onClick={concluir}>Concluir e ajustar</Button></div>}>
      <Table head={<tr><th>Item</th><th className="text-right">No sistema</th><th className="w-36 text-right">Contado</th><th className="text-right">Diferença</th></tr>}>
        {lista.map((i) => {
          const v = contagem[i.id] ?? (i.saldo_contado != null ? String(i.saldo_contado).replace('.', ',') : '')
          const dif = v === '' ? null : parseNum(v) - Number(i.saldo_sistema)
          return (
            <tr key={i.id}>
              <td className="font-medium">{i.material?.nome ?? i.produto?.nome}</td>
              <td className="num text-right">{qty(i.saldo_sistema)} {i.material?.unidade_uso ?? 'un'}</td>
              <td><NumInput value={v} onChange={(x) => setContagem({ ...contagem, [i.id]: x })} onBlur={() => salvarContagem(i.id, v)} aria-label={`Contado de ${i.material?.nome ?? i.produto?.nome}`} /></td>
              <td className={`num text-right ${dif == null ? 'text-muted' : dif < 0 ? 'text-bad' : dif > 0 ? 'text-good' : ''}`}>{dif == null ? '–' : `${dif > 0 ? '+' : ''}${qty(dif)}`}</td>
            </tr>
          )
        })}
      </Table>
      <p className="border-t border-line px-4 py-2.5 text-xs text-muted">Itens deixados em branco não são ajustados. A diferença final é calculada contra o saldo no momento de concluir.</p>
      <div className="px-4 pb-3"><ErrorBox msg={erro} /></div>
    </Panel>
  )
}
