import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Link2, RefreshCw, Store, Unplug } from 'lucide-react'
import { supabase, erroMsg } from '../lib/supabase'
import { useLoad } from '../lib/useQuery'
import { dataHoraBR, money, parseNum, qty } from '../lib/fmt'
import { useAuth } from '../lib/auth'
import { TIPO_PRODUTO, type Produto, type TipoProduto } from '../lib/types'
import { Badge, Button, Empty, ErrorBox, Field, Loading, Modal, NumInput, Panel, Select, useConfirm, useToast } from './ui'

type Status = { conectado: boolean; nickname: string | null; atualizado_em: string | null; ultimo_evento: string | null; pendentes: number }
type Alvo = { anuncio: string; variacao: number | null; titulo: string | null }
type Pendente = { ml_order_id: number; motivo: string; criado_em: string; resumo: { data: string; comprador: string | null; total: number; itens: { mlb: string; titulo: string; qtd: number; preco: number; variacao: number | null }[] } }
/** Anúncio (ou variação) vindo do Mercado Livre para importar */
type AnuncioML = { anuncio: string; variacao: number | null; titulo: string; nome: string; permalink: string | null; preco: number; estoque: number; sku: string | null; foto_url: string | null; status: string; ligado_a: string | null }

export async function chamar(acao: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('ml-sync', { body: { acao, ...extra } })
  if (error) {
    // Mensagem que a função devolveu, quando houver.
    const ctx = (error as { context?: Response }).context
    const corpo = ctx ? await ctx.json().catch(() => null) : null
    throw new Error(corpo?.erro ?? error.message)
  }
  if (data?.erro) throw new Error(data.erro)
  return data
}

const RESULTADO: Record<string, string> = {
  lancada: 'lançadas', ja_lancada: 'já estavam lançadas', pendente: 'foram para conferir', cancelada: 'canceladas',
  ignorada: 'canceladas no ML (ignoradas)', aguardando_pagamento: 'aguardando pagamento', erro: 'com erro',
  liberacoes: 'liberações conferidas no Mercado Pago',
}

/** Configurações → conexão desta empresa com a conta dela no Mercado Livre. */
export function PainelML() {
  const toast = useToast()
  const confirmar = useConfirm()
  const { isAdmin, podeEditar } = useAuth()
  const st = useLoad<Status>(() => supabase.rpc('ml_status'), [])
  const ligados = useLoad<{ id: string }[]>(() => supabase.from('ml_anuncio').select('id'), [])
  const [erro, setErro] = useState<string | null>(null)
  const [importar, setImportar] = useState(false)

  // Volta da autorização: ?ml=ok ou ?ml=erro&msg=…
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const r = q.get('ml')
    if (!r) return
    if (r === 'ok') { toast('Mercado Livre conectado.'); setImportar(true) }
    else setErro(q.get('msg') ?? 'Não foi possível conectar.')
    history.replaceState(null, '', window.location.pathname)
    st.recarregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function conectar() {
    setErro(null)
    try { const { url } = await chamar('auth_url'); window.location.href = url } catch (e) { setErro(erroMsg(e)) }
  }
  async function desconectar() {
    if (!(await confirmar({ titulo: 'Desconectar o Mercado Livre?', mensagem: 'Vendas e perguntas novas param de chegar. O que já foi lançado continua no sistema. Para remover o acesso por completo, revogue também em Mercado Livre → Minha conta → Segurança → Aplicativos conectados.', confirmar: 'Desconectar' }))) return
    const { error } = await supabase.rpc('ml_desconectar')
    if (error) return setErro(erroMsg(error))
    toast('Mercado Livre desconectado.'); st.recarregar()
  }
  async function sincronizar() {
    setErro(null)
    try {
      const r = await chamar('sincronizar')
      const partes = Object.entries(r).filter(([k, v]) => k !== 'total' && v).map(([k, v]) => `${v} ${RESULTADO[k] ?? k}`)
      toast(r.total ? `${r.total} pedidos dos últimos 7 dias: ${partes.join(', ')}.` : 'Nenhum pedido nos últimos 7 dias.')
      st.recarregar()
    } catch (e) { setErro(erroMsg(e)) }
  }

  const s = st.data
  return (
    <Panel title={<span className="inline-flex items-center gap-2"><Store size={17} /> Mercado Livre</span>}
      actions={s?.conectado ? <Badge tone="good">Conectado{s.nickname ? ` · ${s.nickname}` : ''}</Badge> : <Badge>Não conectado</Badge>}>
      <div className="flex flex-col gap-3 p-4 text-sm">
        <p className="text-muted">Conecte a conta do Mercado Livre <b>desta empresa</b>. Vendas entram sozinhas com a taxa e o frete reais, cancelamentos devolvem o estoque e perguntas novas chegam por e-mail. Cada empresa conecta a sua própria conta; nada é compartilhado entre empresas.</p>
        {s?.conectado && (
          <p className="text-muted">
            {(ligados.data ?? []).length} anúncio(s) ligado(s) a produtos · Último aviso: {s.ultimo_evento ? dataHoraBR(s.ultimo_evento) : 'nenhum ainda'}
            {s.pendentes > 0 && <> · <Link to="/vendas" className="font-medium text-ledink underline">{s.pendentes} venda(s) para conferir</Link></>}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {isAdmin && !s?.conectado && <Button size="sm" variant="primary" onClick={conectar}>Conectar Mercado Livre</Button>}
          {s?.conectado && podeEditar && <Button size="sm" variant="primary" onClick={() => setImportar(true)}><Download size={15} /> Importar anúncios</Button>}
          {s?.conectado && podeEditar && <Button size="sm" onClick={sincronizar}><RefreshCw size={15} /> Buscar vendas dos últimos 7 dias</Button>}
          {s?.conectado && isAdmin && <Button size="sm" variant="ghost" onClick={conectar}>Reconectar</Button>}
          {s?.conectado && isAdmin && <Button size="sm" variant="ghost" onClick={desconectar}><Unplug size={15} /> Desconectar</Button>}
        </div>
        <ErrorBox msg={erro} />
      </div>
      {importar && <ImportarAnuncios onClose={() => setImportar(false)} onImportou={() => { setImportar(false); ligados.recarregar() }} />}
    </Panel>
  )
}

type Linha = AnuncioML & { marcado: boolean; acao: 'criar' | 'ligar'; produto_id: string; tipo: TipoProduto; custo: string; quantidade: string }

/** Lista os anúncios da conta e cria os produtos (ou liga a produtos que já existem) de uma vez. */
function ImportarAnuncios({ onClose, onImportou }: { onClose: () => void; onImportou: () => void }) {
  const toast = useToast()
  const { modulo, empresa } = useAuth()
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [comEstoque, setComEstoque] = useState(true)
  const [soAtivos, setSoAtivos] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tipoPadrao: TipoProduto = empresa?.tipo_negocio === 'fabricacao' && modulo('producao') ? 'fabricado' : 'revenda'

  useEffect(() => {
    supabase.from('produto').select('*').eq('ativo', true).order('nome').then(({ data }) => setProdutos((data ?? []) as Produto[]))
    chamar('listar_anuncios').then((r: { anuncios: AnuncioML[] }) => {
      setLinhas(r.anuncios.map((a) => ({
        ...a, marcado: !a.ligado_a && a.status === 'active', acao: 'criar', produto_id: '',
        // "Kit 2 …", "Kit com 3 …": sugere kit quando o módulo de kits está ligado
        tipo: modulo('kits') && /^\s*kit\b/i.test(a.titulo) ? 'kit' : tipoPadrao, custo: '', quantidade: '1',
      })))
    }).catch((e) => setErro(erroMsg(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visiveis = useMemo(() => (linhas ?? []).filter((l) => !soAtivos || l.status === 'active'), [linhas, soAtivos])
  const set = (i: Linha, p: Partial<Linha>) => setLinhas((linhas ?? []).map((l) => (l === i ? { ...l, ...p } : l)))
  const marcados = visiveis.filter((l) => l.marcado)
  const tipos = (Object.keys(TIPO_PRODUTO) as TipoProduto[]).filter((t) => t === 'revenda' || (t === 'fabricado' && modulo('producao')) || (t === 'kit' && modulo('kits')))

  async function importar() {
    setErro(null)
    if (!marcados.length) return setErro('Marque pelo menos um anúncio.')
    if (marcados.some((l) => l.acao === 'ligar' && !l.produto_id)) return setErro('Escolha o produto nas linhas marcadas como "Ligar a produto existente".')
    setBusy(true)
    const itens = marcados.map((l) => ({
      anuncio: l.anuncio, variacao: l.variacao, titulo: l.titulo, permalink: l.permalink,
      produto_id: l.acao === 'ligar' ? l.produto_id : null, quantidade: l.acao === 'ligar' ? parseNum(l.quantidade) || 1 : 1,
      nome: l.nome, sku: l.sku, tipo: l.tipo, preco: l.preco, foto_url: l.foto_url,
      custo: l.custo.trim() ? parseNum(l.custo) : null,
      estoque: comEstoque && l.tipo !== 'kit' ? l.estoque : 0,
    }))
    const { data, error } = await supabase.rpc('importar_anuncios', { p: { itens } })
    setBusy(false)
    if (error) return setErro(erroMsg(error))
    toast(`${data.criados} produto(s) criado(s) e ${data.ligados} anúncio(s) ligado(s).${data.criados && marcados.some((l) => l.tipo === 'kit' && l.acao === 'criar') ? ' Abra os kits em Produtos para dizer o que vai em cada um.' : ''}`)
    onImportou()
  }

  return (
    <Modal open onClose={onClose} title="Importar anúncios do Mercado Livre" wide
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={busy || !linhas} onClick={importar}>{busy ? 'Importando…' : `Importar ${marcados.length} anúncio(s)`}</Button></>}>
      {!linhas && !erro ? <Loading /> : (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">Cada anúncio (e cada variação de cor/tamanho) vira um produto, já com o preço do ML e ligado ao anúncio: as próximas vendas entram sozinhas. Anúncio que já é de um produto seu? Escolha "Ligar a produto existente".</p>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2"><input type="checkbox" checked={comEstoque} onChange={(e) => setComEstoque(e.target.checked)} /> Usar o estoque do anúncio como saldo inicial</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={soAtivos} onChange={(e) => setSoAtivos(e.target.checked)} /> Só anúncios ativos</label>
            <button className="text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => setLinhas((linhas ?? []).map((l) => (visiveis.includes(l) && !l.ligado_a ? { ...l, marcado: !marcados.length } : l)))}>{marcados.length ? 'Desmarcar todos' : 'Marcar todos'}</button>
          </div>
          {comEstoque && <p className="rounded-box bg-warn/10 px-3 py-2 text-warn">Informe o custo de cada produto: sem ele, o estoque inicial entra com custo zero e o lucro das vendas fica errado. Dá para corrigir depois no produto.</p>}
          {visiveis.length === 0 ? <Empty title="Nenhum anúncio encontrado nesta conta" /> : (
            <ul className="divide-y divide-line rounded-box border border-line">
              {visiveis.map((l) => (
                <li key={`${l.anuncio}/${l.variacao ?? ''}`} className={`grid gap-2 p-3 ${l.marcado ? '' : 'opacity-60'}`}>
                  <label className="flex items-start gap-2.5">
                    <input type="checkbox" className="mt-1" checked={l.marcado} onChange={(e) => set(l, { marcado: e.target.checked })} />
                    {l.foto_url && <img src={l.foto_url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />}
                    <span className="min-w-0">
                      <span className="block font-medium">{l.nome}</span>
                      <span className="num text-xs text-muted">{l.anuncio}{l.variacao ? `/${l.variacao}` : ''} · {money(l.preco)} · {qty(l.estoque)} em estoque no ML{l.status !== 'active' && ' · pausado'}{l.sku && ` · SKU ${l.sku}`}</span>
                      {l.ligado_a && <span className="block text-xs text-good">Já ligado a: {l.ligado_a}</span>}
                    </span>
                  </label>
                  {l.marcado && (
                    <div className="grid gap-2 pl-7 sm:grid-cols-[180px_1fr_110px]">
                      <Select value={l.acao} onChange={(e) => set(l, { acao: e.target.value as Linha['acao'] })} className="h-9 text-sm">
                        <option value="criar">Criar produto</option><option value="ligar">Ligar a produto existente</option>
                      </Select>
                      {l.acao === 'criar' ? (
                        <>
                          <Select value={l.tipo} onChange={(e) => set(l, { tipo: e.target.value as TipoProduto })} className="h-9 text-sm">{tipos.map((t) => <option key={t} value={t}>{TIPO_PRODUTO[t].nome}</option>)}</Select>
                          {l.tipo !== 'kit' ? <NumInput aria-label="Custo unitário" placeholder="Custo R$" value={l.custo} onChange={(v) => set(l, { custo: v })} className="h-9" /> : <span className="self-center text-xs text-muted">custo = itens do kit</span>}
                        </>
                      ) : (
                        <>
                          <Select value={l.produto_id} onChange={(e) => set(l, { produto_id: e.target.value })} className="h-9 text-sm"><option value="">Escolha o produto…</option>{produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</Select>
                          <NumInput aria-label="Unidades por venda" title="Unidades que saem do estoque por venda (ex.: pacote com 2)" value={l.quantidade} onChange={(v) => set(l, { quantidade: v })} className="h-9" />
                        </>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="mt-3"><ErrorBox msg={erro} /></div>
    </Modal>
  )
}

/** Vendas → aviso e lista das vendas do ML que não entraram sozinhas. */
export function PendentesML({ onImportou }: { onImportou: () => void }) {
  const toast = useToast()
  const { podeEditar } = useAuth()
  const lista = useLoad<Pendente[]>(() => supabase.from('ml_pendente').select('*').eq('resolvido', false).order('criado_em', { ascending: false }), [])
  const [aberto, setAberto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ligar, setLigar] = useState<{ alvo: Alvo; pedido: Pendente } | null>(null)
  const n = lista.data?.length ?? 0

  async function tentar(p: Pendente) {
    setErro(null)
    try {
      const { resultado } = await chamar('importar', { order_id: p.ml_order_id })
      if (resultado === 'lancada' || resultado === 'ja_lancada') { toast('Venda do Mercado Livre lançada.'); onImportou() }
      else if (resultado === 'pendente') setErro('Ainda não deu para lançar. Veja o motivo atualizado na lista.')
      else toast(`Pedido ${RESULTADO[resultado] ?? resultado}.`)
      lista.recarregar()
    } catch (e) { setErro(erroMsg(e)) }
  }
  async function ignorar(p: Pendente) {
    const { error } = await supabase.from('ml_pendente').update({ resolvido: true }).eq('ml_order_id', p.ml_order_id)
    if (error) return setErro(erroMsg(error))
    lista.recarregar()
  }

  if (!n || !podeEditar) return null
  return (
    <>
      <button onClick={() => setAberto(true)} className="mb-4 flex w-full items-center justify-between gap-3 rounded-box border border-led/50 bg-led/10 px-4 py-3 text-left text-sm hover:bg-led/15">
        <span><b>{n} venda(s) do Mercado Livre para conferir.</b> <span className="text-muted">Não entraram sozinhas: veja o motivo e resolva.</span></span>
        <span className="font-medium text-ledink">Ver</span>
      </button>
      <Modal open={aberto} onClose={() => setAberto(false)} title="Vendas do Mercado Livre para conferir" wide
        footer={<Button onClick={() => setAberto(false)}>Fechar</Button>}>
        {n === 0 ? <Empty title="Tudo resolvido" /> : (
          <ul className="flex flex-col gap-3">
            {(lista.data ?? []).map((p) => (
              <li key={p.ml_order_id} className="rounded-box border border-line p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">Pedido {p.ml_order_id}{p.resumo?.comprador && <span className="font-normal text-muted"> · {p.resumo.comprador}</span>}</p>
                    <p className="num text-xs text-muted">{p.resumo?.data} · {money(p.resumo?.total)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {p.motivo.includes('não está ligado') && (() => {
                      const i = p.resumo?.itens?.find((x) => p.motivo.includes(x.mlb)) ?? p.resumo?.itens?.[0]
                      return i && <Button size="sm" variant="primary" onClick={() => setLigar({ alvo: { anuncio: i.mlb, variacao: i.variacao, titulo: i.titulo }, pedido: p })}><Link2 size={15} /> Ligar anúncio</Button>
                    })()}
                    <Button size="sm" variant={p.motivo.includes('não está ligado') ? 'plain' : 'primary'} onClick={() => tentar(p)}>Tentar de novo</Button>
                    <Button size="sm" variant="ghost" onClick={() => ignorar(p)}>Ignorar</Button>
                  </div>
                </div>
                <ul className="mt-2 space-y-0.5 text-muted">
                  {(p.resumo?.itens ?? []).map((i, k) => <li key={k}>{i.qtd}× {i.titulo} <span className="text-xs">({i.mlb}{i.variacao ? `/${i.variacao}` : ''})</span></li>)}
                </ul>
                <p className="mt-2 rounded-box bg-warn/10 px-2.5 py-1.5 text-warn">{p.motivo}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted">"Ligar anúncio" diz qual produto sai do estoque e já lança a venda. Kit? Cadastre um produto do tipo Kit e ligue o anúncio a ele. "Ignorar" só tira da lista; nada é lançado.</p>
        <div className="mt-3"><ErrorBox msg={erro} /></div>
      </Modal>
      {ligar && <LigarAnuncio alvo={ligar.alvo} onClose={() => setLigar(null)} onSalvo={async () => { const p = ligar.pedido; setLigar(null); await tentar(p) }} />}
    </>
  )
}

/** Liga um anúncio a um produto (kit ou não) e quantas unidades saem por venda. */
function LigarAnuncio({ alvo, onClose, onSalvo }: { alvo: Alvo; onClose: () => void; onSalvo: () => void }) {
  const toast = useToast()
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [produto, setProduto] = useState('')
  const [qtdTxt, setQtdTxt] = useState('1')
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => { supabase.from('produto').select('*').eq('ativo', true).order('nome').then(({ data }) => setProdutos((data ?? []) as Produto[])) }, [])

  async function salvar() {
    if (!produto) return setErro('Escolha o produto.')
    const { error } = await supabase.rpc('importar_anuncios', { p: { itens: [{ anuncio: alvo.anuncio, variacao: alvo.variacao, titulo: alvo.titulo, produto_id: produto, quantidade: parseNum(qtdTxt) || 1 }] } })
    if (error) return setErro(erroMsg(error))
    toast('Anúncio ligado.'); onSalvo()
  }
  return (
    <Modal open onClose={onClose} title={`Ligar ${alvo.anuncio}`}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={salvar}>Ligar e lançar a venda</Button></>}>
      <div className="flex flex-col gap-4 text-sm">
        {alvo.titulo && <p className="font-medium">{alvo.titulo}</p>}
        <Field label="Produto que sai do estoque"><Select value={produto} onChange={(e) => setProduto(e.target.value)}><option value="">Escolha…</option>{produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.tipo === 'kit' ? ' (kit)' : ''}</option>)}</Select></Field>
        <Field label="Unidades por venda" hint="Ex.: anúncio 'pacote com 2' do mesmo produto = 2. Para kits com produtos diferentes, crie um produto do tipo Kit."><NumInput value={qtdTxt} onChange={setQtdTxt} className="max-w-28" /></Field>
        <p className="text-xs text-muted">Produto ainda não existe? Cadastre em <Link to="/produtos" className="underline">Produtos</Link> e volte aqui.</p>
        <ErrorBox msg={erro} />
      </div>
    </Modal>
  )
}
