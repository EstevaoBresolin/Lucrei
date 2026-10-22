// Apura × Mercado Livre (compartilhado pelas funções ml-*).
// Cada empresa conecta a própria conta do ML. Toda leitura/escrita aqui usa service_role
// (ignora RLS), por isso TODA consulta filtra por empresa_id explicitamente.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const APP_ID = Deno.env.get('ML_APP_ID') ?? ''
export const APP_URL = (Deno.env.get('APP_URL') ?? 'https://apuragestao.com.br').replace(/\/$/, '')
export const REDIRECT_URI = `${Deno.env.get('SUPABASE_URL')}/functions/v1/ml-oauth`
const API = 'https://api.mercadolibre.com'
const MP = 'https://api.mercadopago.com'

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
export const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Cliente com service_role: ignora RLS. */
export const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

type Tokens = { access_token: string; refresh_token: string; expires_in: number; user_id: number }

export async function trocarToken(params: Record<string, string>): Promise<Tokens> {
  const r = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: APP_ID, client_secret: Deno.env.get('ML_SECRET') ?? '', ...params }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Autorização do Mercado Livre falhou: ${j.message ?? j.error ?? r.status}`)
  return j
}

export async function salvarTokens(db: SupabaseClient, empresa: string, t: Tokens, extra: Record<string, unknown> = {}) {
  const { error } = await db.from('ml_conta').upsert({
    empresa_id: empresa, ml_user_id: t.user_id, access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: new Date(Date.now() + (t.expires_in - 300) * 1000).toISOString(), updated_at: new Date().toISOString(), ...extra,
  })
  if (error) throw error
}

/** Token de acesso válido da empresa; renova sozinho (vale ~6 h e o refresh só pode ser usado uma vez). */
export async function token(db: SupabaseClient, empresa: string): Promise<string> {
  const ler = async () => (await db.from('ml_conta').select('*').eq('empresa_id', empresa).maybeSingle()).data
  const c = await ler()
  if (c?.access_token && new Date(c.expires_at).getTime() > Date.now()) return c.access_token
  if (!c?.refresh_token) throw new Error('Conexão com o Mercado Livre expirou. Clique em Conectar de novo.')
  try {
    const t = await trocarToken({ grant_type: 'refresh_token', refresh_token: c.refresh_token })
    await salvarTokens(db, empresa, t)
    return t.access_token
  } catch (e) {
    // Outro aviso pode ter renovado ao mesmo tempo: usa o token novo se já existir.
    const c2 = await ler()
    if (c2?.access_token && new Date(c2.expires_at).getTime() > Date.now()) return c2.access_token
    throw e
  }
}

export async function ml(db: SupabaseClient, empresa: string, path: string, base = API) {
  const tk = await token(db, empresa)
  const r = await fetch(base + path, { headers: { Authorization: `Bearer ${tk}`, ...(base === API && { 'x-format-new': 'true' }) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Mercado Livre ${path}: ${j.message ?? r.status}`)
  return j
}

const dataBR = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const digitos = (s: string) => String(s).replace(/\D/g, '')
const statusEnvio = (s?: string) => (s === 'delivered' ? 'entregue' : s === 'shipped' ? 'enviada' : 'aberta')
const ORDEM = { aberta: 0, enviada: 1, entregue: 2 } as Record<string, number>

/** Produto ligado ao anúncio (variação exata, senão o anúncio sem variação) e quantas unidades saem por venda. */
async function produtoDoAnuncio(db: SupabaseClient, empresa: string, mlb: string, variacao: number | null) {
  const { data } = await db.from('ml_anuncio').select('produto_id, quantidade, variacao').eq('empresa_id', empresa).eq('anuncio', 'MLB' + digitos(mlb))
  const lista = data ?? []
  return (variacao != null ? lista.find((l) => Number(l.variacao) === variacao) : null) ?? lista.find((l) => l.variacao == null) ?? (lista.length === 1 ? lista[0] : null)
}

export async function atualizarEnvio(db: SupabaseClient, empresa: string, shipmentId: number) {
  const s = await ml(db, empresa, `/shipments/${shipmentId}`)
  const novo = statusEnvio(s.status)
  const { data: vendas } = await db.from('venda').select('id, status').eq('empresa_id', empresa).eq('ml_shipment_id', shipmentId)
  for (const v of vendas ?? []) {
    if (!(v.status in ORDEM) || ORDEM[novo] <= ORDEM[v.status]) continue
    const { error } = await db.rpc('ml_mudar_status', { p_empresa: empresa, p_id: v.id, p_status: novo })
    if (error) throw error
  }
  return { vendas: vendas?.length ?? 0, orderId: s.order_id as number | undefined }
}

/** Valor líquido e data de liberação do dinheiro, direto do Mercado Pago. Sem resposta, a venda fica com a estimativa. */
export async function atualizarLiberacao(db: SupabaseClient, empresa: string, orderId: number, pedido?: any) {
  try {
    const o = pedido ?? await ml(db, empresa, `/orders/${orderId}`)
    const pagos = (o.payments ?? []).filter((p: any) => p.status === 'approved')
    if (!pagos.length) return false
    let liquido = 0, quando: string | null = null, liberado = true
    for (const p of pagos) {
      const m = await ml(db, empresa, `/v1/payments/${p.id}`, MP)
      liquido += Number(m.transaction_details?.net_received_amount ?? 0)
      if (m.money_release_date && (!quando || new Date(m.money_release_date) > new Date(quando))) quando = m.money_release_date
      if (m.money_release_status !== 'released') liberado = false
    }
    const { error } = await db.from('venda').update({ ml_liquido: Math.round(liquido * 100) / 100, ml_liberacao_em: quando, ml_liberado: liberado })
      .eq('empresa_id', empresa).eq('ml_order_id', orderId)
    return !error
  } catch { return false }
}

/** Lança (ou atualiza) a venda de um pedido. Pedido que não dá para lançar vai para "Vendas do ML para conferir". */
export async function importarPedido(db: SupabaseClient, empresa: string, orderId: number): Promise<string> {
  const o = await ml(db, empresa, `/orders/${orderId}`)
  const { data: existente } = await db.from('venda').select('id, status').eq('empresa_id', empresa).eq('ml_order_id', orderId).maybeSingle()

  if (o.status === 'cancelled') {
    if (existente && !['cancelada', 'devolvida'].includes(existente.status)) {
      const { error } = await db.rpc('ml_cancelar_venda', { p_empresa: empresa, p_id: existente.id, p_motivo: 'Cancelada no Mercado Livre' })
      if (error) throw error
    }
    await db.from('ml_pendente').update({ resolvido: true }).eq('empresa_id', empresa).eq('ml_order_id', orderId)
    return existente ? 'cancelada' : 'ignorada'
  }
  if (existente) {
    if (o.shipping?.id) await atualizarEnvio(db, empresa, o.shipping.id)
    await atualizarLiberacao(db, empresa, orderId, o)
    return 'ja_lancada'
  }
  if (o.status !== 'paid') return 'aguardando_pagamento'

  const resumo = {
    data: dataBR(o.date_closed ?? o.date_created), comprador: o.buyer?.nickname ?? null, total: o.total_amount,
    itens: (o.order_items ?? []).map((i: any) => ({ mlb: i.item.id, variacao: i.item.variation_id ?? null, titulo: i.item.title, qtd: i.quantity, preco: i.unit_price })),
  }
  const pendente = async (motivo: string) => {
    await db.from('ml_pendente').upsert({ empresa_id: empresa, ml_order_id: orderId, motivo, resumo, resolvido: false })
    return 'pendente'
  }

  const itens: { produto_id: string; quantidade: number; preco_unit: number }[] = []
  let taxa = 0, bruta = 0
  for (const i of o.order_items ?? []) {
    const lig = await produtoDoAnuncio(db, empresa, i.item.id, i.item.variation_id ?? null)
    if (!lig) return pendente(`O anúncio ${i.item.id} ("${i.item.title}") não está ligado a nenhum produto. Use "Ligar anúncio" para dizer qual produto sai do estoque.`)
    const qtdAnuncio = Number(i.quantity), linha = qtdAnuncio * Number(i.unit_price)
    const quantidade = qtdAnuncio * Number(lig.quantidade)
    itens.push({ produto_id: lig.produto_id, quantidade, preco_unit: Math.round((linha / quantidade) * 100) / 100 })
    taxa += Number(i.sale_fee ?? 0) * qtdAnuncio
    bruta += linha
  }

  const { data: canal } = await db.from('canal').select('id').eq('empresa_id', empresa).ilike('nome', '%mercado%livre%').eq('ativo', true).limit(1).maybeSingle()
  if (!canal) return pendente('Não existe um canal ativo chamado "Mercado Livre" em Configurações.')
  const { data: taxaCanal } = await db.from('canal_taxa').select('id').eq('empresa_id', empresa).eq('canal_id', canal.id).eq('ativo', true).order('vigente_desde', { ascending: false }).limit(1).maybeSingle()

  // Frete pago pelo vendedor. Em carrinho (vários pedidos, um envio) conta uma vez só.
  let frete = 0, statusVenda = 'aberta'
  const shipId = o.shipping?.id ?? null
  if (shipId) {
    const { count } = await db.from('venda').select('id', { count: 'exact', head: true }).eq('empresa_id', empresa).eq('ml_shipment_id', shipId)
    if (!count) {
      try {
        const custos = await ml(db, empresa, `/shipments/${shipId}/costs`)
        frete = (custos.senders ?? []).reduce((s: number, x: any) => s + Number(x.cost ?? 0), 0)
      } catch { /* sem custo de envio disponível */ }
    }
    try { statusVenda = statusEnvio((await ml(db, empresa, `/shipments/${shipId}`)).status) } catch { /* mantém aberta */ }
  }

  const { error, data: vendaId } = await db.rpc('importar_venda_ml', {
    p_empresa: empresa, p_order: orderId, p_shipment: shipId,
    p: {
      data: resumo.data, canal_id: canal.id, canal_taxa_id: taxaCanal?.id ?? null,
      pedido_externo: String(o.pack_id ?? o.id), status: statusVenda,
      perc_taxa: bruta > 0 ? Math.round((taxa / bruta) * 100 * 100) / 100 : 0, tarifa_fixa: 0,
      frete: Math.round(frete * 100) / 100, desconto: 0, outros_custos: 0,
      forma_pagamento: 'Mercado Pago',
      observacoes: `Importada do Mercado Livre${resumo.comprador ? `. Comprador: ${resumo.comprador}` : ''}.`,
      itens,
    },
  })
  if (error) return pendente(error.message)
  if (vendaId) await atualizarLiberacao(db, empresa, orderId, o)
  return vendaId ? 'lancada' : 'erro'
}

/** Anúncios da conta (cada variação vira uma linha), marcando os que já estão ligados a produtos. */
export async function listarAnuncios(db: SupabaseClient, empresa: string) {
  const { data: c } = await db.from('ml_conta').select('ml_user_id').eq('empresa_id', empresa).maybeSingle()
  if (!c?.ml_user_id) throw new Error('Mercado Livre não conectado')
  const ids: string[] = []
  for (let offset = 0; offset < 1000; offset += 100) {
    const r = await ml(db, empresa, `/users/${c.ml_user_id}/items/search?limit=100&offset=${offset}`)
    ids.push(...(r.results ?? []))
    if ((r.results ?? []).length < 100 || ids.length >= (r.paging?.total ?? 0)) break
  }
  const { data: ligs } = await db.from('ml_anuncio').select('anuncio, variacao, produto:produto_id(nome)').eq('empresa_id', empresa)
  const ligado = (a: string, v: number | null) => {
    const l = (ligs ?? []).find((x: any) => x.anuncio === a && (x.variacao == null ? v == null : Number(x.variacao) === v))
    return (l as any)?.produto?.nome ?? null
  }
  const sku = (x: any) => x?.seller_custom_field || (x?.attributes ?? []).find((a: any) => a.id === 'SELLER_SKU')?.value_name || null
  const anuncios: unknown[] = []
  for (let i = 0; i < ids.length; i += 20) {
    const lote = await ml(db, empresa, `/items?ids=${ids.slice(i, i + 20).join(',')}&attributes=id,title,price,available_quantity,permalink,thumbnail,secure_thumbnail,status,variations,seller_custom_field,attributes`)
    for (const { body: it } of lote ?? []) {
      if (!it?.id) continue
      const foto = it.secure_thumbnail ?? it.thumbnail ?? null
      if (it.variations?.length) {
        for (const v of it.variations) {
          const desc = (v.attribute_combinations ?? []).map((a: any) => a.value_name).filter(Boolean).join(' / ')
          anuncios.push({ anuncio: it.id, variacao: v.id, titulo: it.title, nome: desc ? `${it.title} - ${desc}` : it.title, permalink: it.permalink, preco: Number(v.price ?? it.price), estoque: Number(v.available_quantity ?? 0), sku: sku(v) ?? null, foto_url: foto, status: it.status, ligado_a: ligado(it.id, v.id) ?? ligado(it.id, null) })
        }
      } else {
        anuncios.push({ anuncio: it.id, variacao: null, titulo: it.title, nome: it.title, permalink: it.permalink, preco: Number(it.price), estoque: Number(it.available_quantity ?? 0), sku: sku(it), foto_url: foto, status: it.status, ligado_a: ligado(it.id, null) })
      }
    }
  }
  return anuncios
}

async function enviarEmail(para: string, assunto: string, html: string) {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key || !para) return
  const de = Deno.env.get('EMAIL_REMETENTE') ?? 'Apura Gestão <onboarding@resend.dev>'
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: de, to: [para], subject: assunto, html }),
  })
  if (!r.ok) throw new Error(`E-mail não enviado: ${await r.text()}`)
}

async function enviarNtfy(topico: string | null, titulo: string, texto: string, link: string) {
  if (!topico) return
  await fetch(`https://ntfy.sh/${encodeURIComponent(topico)}`, { method: 'POST', body: texto, headers: { Title: titulo, Click: link, Tags: 'question' } })
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Avisa a empresa (e-mail e, se configurado, ntfy) quando chega pergunta nova. Cada pergunta é avisada uma vez. */
export async function avisarPergunta(db: SupabaseClient, empresa: string, questionId: number) {
  const q = await ml(db, empresa, `/questions/${questionId}`)
  if (q.status !== 'UNANSWERED') return 'respondida'
  const { data: novo } = await db.from('ml_pergunta_avisada').upsert({ empresa_id: empresa, question_id: questionId }, { onConflict: 'empresa_id,question_id', ignoreDuplicates: true }).select('question_id')
  if (!novo?.length) return 'ja_avisada'
  const { data: emp } = await db.from('empresa').select('nome, email_avisos, ntfy_topico').eq('id', empresa).single()
  let titulo = q.item_id as string, link = `https://produto.mercadolivre.com.br/${String(q.item_id).replace(/^MLB/, 'MLB-')}`
  try { const it = await ml(db, empresa, `/items/${q.item_id}`); titulo = it.title; link = it.permalink ?? link } catch { /* usa o código */ }
  const texto = String(q.text ?? '')
  await Promise.allSettled([
    enviarEmail(emp?.email_avisos ?? '', `Nova pergunta no ML: ${titulo}`,
      `<p style="font:15px system-ui;color:#555">Nova pergunta no Mercado Livre · ${esc(emp?.nome ?? '')}</p>
       <p style="font:600 17px system-ui">${esc(titulo)}</p>
       <blockquote style="font:16px system-ui;border-left:3px solid #10A36A;margin:12px 0;padding:6px 12px">${esc(texto)}</blockquote>
       <p style="font:14px system-ui;color:#555">Responda pelo app do Mercado Livre, em <b>Vendas → Perguntas</b>. <a href="${link}">Ver anúncio</a></p>`),
    enviarNtfy(emp?.ntfy_topico ?? null, `Nova pergunta: ${titulo}`, texto, link),
  ])
  return 'avisada'
}
