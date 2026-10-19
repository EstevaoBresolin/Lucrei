// Recebe os avisos do Mercado Livre (vendas, envios e perguntas) de todas as empresas
// e direciona cada um para a empresa dona da conta do ML (user_id do aviso).
import { admin, APP_ID, atualizarEnvio, avisarPergunta, importarPedido } from '../_shared/ml.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

async function processar(empresa: string, topic: string, resource: string) {
  const db = admin()
  const id = Number(resource.split('/').filter(Boolean).pop())
  if (!id) return 'sem_id'
  if (topic === 'orders_v2' || topic === 'orders') return importarPedido(db, empresa, id)
  if (topic === 'shipments') {
    const r = await atualizarEnvio(db, empresa, id)
    // Envio de um pedido que ainda não foi lançado: lança agora.
    if (!r.vendas && r.orderId) return importarPedido(db, empresa, r.orderId)
    return 'envio_atualizado'
  }
  if (topic === 'questions') return avisarPergunta(db, empresa, id)
  return 'ignorado'
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')
  const body = await req.json().catch(() => null)
  // O ML não assina os avisos: aceita só os do nosso aplicativo e só usa o id para buscar os dados na API com o token da empresa.
  if (!body?.resource || !APP_ID || String(body.application_id) !== APP_ID) return new Response('ignorado')
  const db = admin()
  if (typeof body.resource !== 'string' || body.resource.length > 200 || !/^\/?[a-z0-9_/]+$/i.test(body.resource)) return new Response('ignorado')
  const { data: conta } = await db.from('ml_conta').select('empresa_id').eq('ml_user_id', Number(body.user_id)).maybeSingle()
  if (!conta) return new Response('ok') // conta não conectada a nenhuma empresa: nem registra (evita encher o banco com avisos falsos)
  // O mesmo aviso repetido em poucos segundos não é processado de novo (o ML reenvia, e alguém poderia disparar em massa)
  const { count } = await db.from('ml_evento').select('id', { count: 'exact', head: true })
    .eq('empresa_id', conta.empresa_id).eq('resource', body.resource).gt('recebido_em', new Date(Date.now() - 30_000).toISOString())
  if (count) return new Response('ok')
  const { data: ev } = await db.from('ml_evento').insert({ empresa_id: conta.empresa_id, ml_user_id: body.user_id ?? null, topic: String(body.topic).slice(0, 40), resource: body.resource }).select('id').single()
  // Responde 200 na hora (senão o ML reenvia) e processa em segundo plano.
  EdgeRuntime.waitUntil(
    processar(conta.empresa_id, String(body.topic), String(body.resource))
      .then((r) => db.from('ml_evento').update({ processado_em: new Date().toISOString(), erro: r === 'pendente' ? 'Venda foi para conferir' : null }).eq('id', ev?.id))
      .catch((e) => db.from('ml_evento').update({ processado_em: new Date().toISOString(), erro: String(e?.message ?? e) }).eq('id', ev?.id)),
  )
  return new Response('ok')
})
