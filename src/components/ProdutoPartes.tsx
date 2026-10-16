import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Plus, Trash2 } from 'lucide-react'
import { supabase, erroMsg } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { money, parseNum, qty } from '../lib/fmt'
import { custoProduto, saldoProduto, type Produto } from '../lib/types'
import { useAuth } from '../lib/auth'
import { Button, Empty, ErrorBox, Field, Input, NumInput, Panel, Select, Table, useToast } from './ui'

type ItemKit = { id: string; produto_id: string; quantidade: number; produto: Produto | null }
const brn = (n: number) => String(Number(n)).replace('.', ',')

/** Produtos que formam o kit. Vender 1 kit baixa estas quantidades do estoque. */
export function ComposicaoKit({ kit, onMudou }: { kit: Produto; onMudou: () => void }) {
  const toast = useToast()
  const { podeEditar } = useAuth()
  const itens = useLoad<ItemKit[]>(() => supabase.from('kit_item').select('id, produto_id, quantidade, produto:produto_id(*)').eq('kit_id', kit.id) as unknown as PromiseLike<{ data: ItemKit[] | null; error: unknown }>, [kit.id])
  const produtos = useLoad<Produto[]>(() => supabase.from('vw_produto_estoque').select('*').eq('ativo', true).neq('tipo', 'kit').order('nome'), [])
  const [novo, setNovo] = useState({ produto_id: '', quantidade: '1' })
  const [edit, setEdit] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<string | null>(null)
  const lista = itens.data ?? []
  const custo = lista.reduce((s, i) => s + Number(i.quantidade) * (i.produto ? custoProduto(i.produto) : 0), 0) + Number(kit.custos_fixos_unit)

  async function add() {
    setErro(null)
    if (!novo.produto_id || !(parseNum(novo.quantidade) > 0)) return setErro('Escolha o produto e a quantidade.')
    const { error } = await supabase.from('kit_item').insert({ kit_id: kit.id, produto_id: novo.produto_id, quantidade: parseNum(novo.quantidade) })
    if (error) return setErro(erroMsg(error))
    setNovo({ produto_id: '', quantidade: '1' }); itens.recarregar(); onMudou()
  }
  async function salvar(i: ItemKit) {
    const v = edit[i.id]
    if (v === undefined) return
    if (!(parseNum(v) > 0)) return setErro('A quantidade precisa ser maior que zero. Para tirar o produto do kit, use a lixeira.')
    const { error } = await supabase.from('kit_item').update({ quantidade: parseNum(v) }).eq('id', i.id)
    if (error) return setErro(erroMsg(error))
    setEdit(({ [i.id]: _, ...resto }) => resto); toast('Kit atualizado.'); itens.recarregar(); onMudou()
  }
  async function remover(i: ItemKit) {
    const { error } = await supabase.from('kit_item').delete().eq('id', i.id)
    if (error) return setErro(erroMsg(error))
    itens.recarregar(); onMudou()
  }

  return (
    <Panel title="O que vai no kit">
      {lista.length === 0 ? <Empty title="Kit vazio">Adicione os produtos (e quantos de cada) que saem do estoque quando 1 kit é vendido.</Empty> : (
        <Table head={<tr><th>Produto</th><th className="text-right">Qtd. por kit</th><th className="text-right">Em estoque</th><th className="text-right">Custo</th><th /></tr>}>
          {lista.map((i) => (
            <tr key={i.id}>
              <td><Link to={`/produtos/${i.produto_id}`} className="hover:underline">{i.produto?.nome}</Link></td>
              <td className="text-right">
                {podeEditar ? <NumInput aria-label="Quantidade" className="ml-auto h-8 w-20" value={edit[i.id] ?? brn(i.quantidade)} onChange={(v) => setEdit({ ...edit, [i.id]: v })} onBlur={() => salvar(i)} />
                  : <span className="num">{qty(i.quantidade)}</span>}
              </td>
              <td className="num text-right">{i.produto ? qty(i.produto.saldo) : '–'}</td>
              <td className="num text-right">{money(Number(i.quantidade) * (i.produto ? custoProduto(i.produto) : 0))}</td>
              <td className="w-10">{podeEditar && <button aria-label="Tirar do kit" onClick={() => remover(i)} className="text-muted hover:text-bad"><Trash2 size={15} /></button>}</td>
            </tr>
          ))}
          {Number(kit.custos_fixos_unit) > 0 && <tr><td className="text-muted">Custo extra do kit</td><td /><td /><td className="num text-right">{money(kit.custos_fixos_unit)}</td><td /></tr>}
          <tr className="font-semibold"><td>Total</td><td /><td className="num text-right text-muted">dá {qty(saldoProduto(kit))} kit(s)</td><td className="num text-right">{money(custo)}</td><td /></tr>
        </Table>
      )}
      {podeEditar && (
        <div className="grid grid-cols-[1fr_90px] gap-2 border-t border-line p-4 sm:grid-cols-[1fr_110px_auto] sm:items-end">
          <Field label="Produto" className="col-span-2 sm:col-span-1">
            <Select value={novo.produto_id} onChange={(e) => setNovo({ ...novo, produto_id: e.target.value })}>
              <option value="">Escolha…</option>
              {(produtos.data ?? []).filter((x) => x.id !== kit.id && !lista.some((i) => i.produto_id === x.id)).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </Select>
          </Field>
          <Field label="Quantidade"><NumInput value={novo.quantidade} onChange={(v) => setNovo({ ...novo, quantidade: v })} /></Field>
          <Button onClick={add}><Plus size={15} /> Adicionar</Button>
        </div>
      )}
      <div className="px-4 pb-3"><ErrorBox msg={erro} /></div>
    </Panel>
  )
}

type Anuncio = { id: string; anuncio: string; variacao: number | null; titulo: string | null; permalink: string | null; quantidade: number }

/** Anúncios do Mercado Livre que, quando vendidos, baixam este produto. */
export function AnunciosDoProduto({ produto }: { produto: Produto }) {
  const toast = useToast()
  const { podeEditar } = useAuth()
  const lista = useLoad<Anuncio[]>(() => supabase.from('ml_anuncio').select('*').eq('produto_id', produto.id).order('anuncio'), [produto.id])
  const [novo, setNovo] = useState({ anuncio: '', quantidade: '1' })
  const [erro, setErro] = useState<string | null>(null)

  async function ligar() {
    setErro(null)
    const [a, v] = novo.anuncio.trim().split('/')
    const codigo = a?.replace(/\D/g, '')
    if (!codigo) return setErro('Informe o código do anúncio (MLB…). Anúncio com variação: MLB…/ID-da-variação.')
    const { error } = await supabase.from('ml_anuncio').insert({ anuncio: `MLB${codigo}`, variacao: v ? Number(v.replace(/\D/g, '')) : null, produto_id: produto.id, quantidade: parseNum(novo.quantidade) || 1 })
    if (error) return setErro(error.message.includes('duplicate') ? 'Este anúncio já está ligado a um produto. Desligue-o lá antes.' : erroMsg(error))
    toast('Anúncio ligado.'); setNovo({ anuncio: '', quantidade: '1' }); lista.recarregar()
  }
  async function desligar(a: Anuncio) {
    const { error } = await supabase.from('ml_anuncio').delete().eq('id', a.id)
    if (error) return setErro(erroMsg(error))
    lista.recarregar()
  }

  return (
    <Panel title="Anúncios no Mercado Livre">
      {(lista.data ?? []).length === 0 ? <p className="p-4 text-sm text-muted">Nenhum anúncio ligado. Vendas de anúncios ligados entram sozinhas e baixam este produto. Dica: em Configurações → Mercado Livre você importa todos os anúncios de uma vez.</p> : (
        <ul className="divide-y divide-line text-sm">
          {(lista.data ?? []).map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-medium">{a.titulo ?? a.anuncio}</p>
                <p className="text-xs text-muted">{a.anuncio}{a.variacao ? `/${a.variacao}` : ''}{Number(a.quantidade) !== 1 && ` · baixa ${qty(a.quantidade)} unidades por venda`}</p>
              </div>
              <div className="flex shrink-0 gap-3">
                {a.permalink && <a href={a.permalink} target="_blank" rel="noreferrer" className="text-muted hover:text-ink" aria-label="Abrir anúncio"><ExternalLink size={15} /></a>}
                {podeEditar && <button onClick={() => desligar(a)} className="text-muted hover:text-bad" aria-label="Desligar anúncio"><Trash2 size={15} /></button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {podeEditar && (
        <div className="grid grid-cols-[1fr_80px] gap-2 border-t border-line p-4 sm:grid-cols-[1fr_90px_auto] sm:items-end">
          <Field label="Código do anúncio" className="col-span-2 sm:col-span-1"><Input value={novo.anuncio} onChange={(e) => setNovo({ ...novo, anuncio: e.target.value })} placeholder="MLB1234567890" /></Field>
          <Field label="Unid./venda"><NumInput value={novo.quantidade} onChange={(v) => setNovo({ ...novo, quantidade: v })} /></Field>
          <Button onClick={ligar}><Plus size={15} /> Ligar</Button>
        </div>
      )}
      <div className="px-4 pb-3"><ErrorBox msg={erro} /></div>
    </Panel>
  )
}
