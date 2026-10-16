import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { money, qty } from '../lib/fmt'
import { custoProduto, saldoProduto, TIPO_PRODUTO, type Categoria, type Produto } from '../lib/types'
import { useAuth } from '../lib/auth'
import { Badge, Button, Empty, ErrorBox, Input, Loading, PageHeader, Panel, Select, Table } from '../components/ui'
import ProdutoForm from '../components/ProdutoForm'

export default function Produtos() {
  const nav = useNavigate()
  const { modulo, podeEditar } = useAuth()
  const [novo, setNovo] = useState(false)
  const [busca, setBusca] = useState('')
  const [cat, setCat] = useState('')
  const [inativos, setInativos] = useState(false)
  const { data, erro, carregando, recarregar } = useLoad<Produto[]>(() => supabase.from('vw_produto_estoque').select('*').order('nome'), [])
  const cats = useLoad<Categoria[]>(() => supabase.from('categoria').select('*').eq('tipo', 'produto').order('nome'), [])
  const fichas = useLoad<{ produto_id: string }[]>(() => supabase.from('ficha_tecnica_item').select('produto_id'), [])
  const comFicha = new Set((fichas.data ?? []).map((f) => f.produto_id))

  const lista = useMemo(() => (data ?? []).filter((p) =>
    (inativos || p.ativo) && (!cat || p.categoria_id === cat) &&
    (!busca || `${p.nome} ${p.sku ?? ''}`.toLowerCase().includes(busca.toLowerCase()))), [data, busca, cat, inativos])

  return (
    <div>
      <PageHeader title="Produtos" sub="Tudo o que você vende, com o custo e o estoque de cada um."
        actions={podeEditar && <Button variant="primary" size="sm" onClick={() => setNovo(true)}><Plus size={15} /> Novo produto</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input placeholder="Buscar por nome ou SKU" value={busca} onChange={(e) => setBusca(e.target.value)} className="max-w-xs" />
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="w-auto"><option value="">Todas as categorias</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select>
        <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar inativos</label>
      </div>
      <ErrorBox msg={erro} />
      <Panel>
        {carregando && !data ? <Loading /> : lista.length === 0 ? (
          <Empty title={data?.length ? 'Nenhum produto neste filtro' : 'Nenhum produto cadastrado'}>
            {!data?.length && <Button className="mt-3" onClick={() => setNovo(true)}><Plus size={15} /> Cadastrar o primeiro produto</Button>}
          </Empty>
        ) : (
          <Table head={<tr><th>Produto</th><th className="text-right">Em estoque</th><th className="text-right">Custo unit.</th><th className="text-right">Vendidos 30 dias</th><th>Tipo</th></tr>}>
            {lista.map((p) => (
              <tr key={p.id} onClick={() => nav(`/produtos/${p.id}`)} className={`cursor-pointer hover:bg-line/30 ${!p.ativo ? 'text-muted' : ''}`}>
                <td><span className="font-medium">{p.nome}</span>{p.sku && <span className="ml-2 text-xs text-muted">{p.sku}</span>}{!p.ativo && <span className="ml-2"><Badge>Inativo</Badge></span>}</td>
                <td className="text-right"><span className="num mr-2">{qty(saldoProduto(p))}</span>{p.situacao !== 'ok' && <Badge tone={p.situacao === 'zerado' ? 'bad' : 'warn'}>{p.situacao === 'zerado' ? 'Zerado' : 'Baixo'}</Badge>}</td>
                <td className="num text-right">{money(custoProduto(p))}</td>
                <td className="num text-right">{qty(p.vendidos_30d)}</td>
                <td><span className="text-sm">{TIPO_PRODUTO[p.tipo]?.nome ?? p.tipo}</span>{p.tipo === 'fabricado' && modulo('producao') && !comFicha.has(p.id) && <span className="ml-2"><Badge tone="warn">Sem ficha</Badge></span>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <ProdutoForm open={novo} onClose={() => setNovo(false)} onSaved={(id) => { setNovo(false); recarregar(); nav(`/produtos/${id}`) }} />
    </div>
  )
}
