// Avisos do Asaas sobre a assinatura do Lucrei: pagou → libera; atrasou → avisa; cancelou → só leitura após a data paga.
// Autenticado pelo token configurado no webhook do Asaas (header asaas-access-token).
import { createClient } from 'npm:@supabase/supabase-js@2'

const ok = () => new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } })

/** 'AAAA-MM-DD' + 1 mês (31/01 → 28/02 ou 29/02). */
function maisUmMes(d: string) {
  const [a, m, dia] = d.split('-').map(Number)
  const ultimo = new Date(Date.UTC(a, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(a, m, Math.min(dia, ultimo))).toISOString().slice(0, 10)
}

Deno.serve(async (req) => {
  const token = Deno.env.get('ASAAS_WEBHOOK_TOKEN')
  if (!token || req.headers.get('asaas-access-token') !== token) return new Response('unauthorized', { status: 401 })
  const ev = await req.json().catch(() => null)
  if (!ev?.event) return ok()

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const pay = ev.payment, sub = ev.subscription
  const assinatura: string | undefined = pay?.subscription ?? sub?.id
  if (!assinatura) return ok() // cobrança avulsa: não é do Lucrei

  let { data: emp } = await db.from('empresa').select('id').eq('asaas_assinatura_id', assinatura).maybeSingle()
  if (!emp && sub?.externalReference) emp = (await db.from('empresa').select('id').eq('id', sub.externalReference).maybeSingle()).data
  if (!emp) return ok()

  // Cada evento é processado uma vez só (o Asaas pode reenviar)
  if (ev.id) {
    const { error } = await db.from('asaas_evento').insert({ id: ev.id, evento: ev.event, empresa_id: emp.id })
    if (error) return ok()
  }

  let p: Record<string, unknown> | null = null
  switch (ev.event) {
    case 'PAYMENT_CREATED':
    case 'PAYMENT_UPDATED':
    case 'PAYMENT_RESTORED':
      if (['PENDING', 'OVERDUE'].includes(pay.status)) p = { cobranca_url: pay.invoiceUrl, cobranca_vencimento: pay.dueDate }
      break
    case 'PAYMENT_CONFIRMED':
    case 'PAYMENT_RECEIVED':
      p = { status: 'ativa', pago_ate: maisUmMes(pay.dueDate), cobranca_url: null, cobranca_vencimento: null }
      break
    case 'PAYMENT_OVERDUE':
      p = { status: 'atrasada', cobranca_url: pay.invoiceUrl, cobranca_vencimento: pay.dueDate }
      break
    case 'SUBSCRIPTION_DELETED':
    case 'SUBSCRIPTION_INACTIVATED':
      p = { status: 'cancelada', asaas_assinatura_id: null, cobranca_url: null, cobranca_vencimento: null }
      break
  }
  if (p) {
    const { error } = await db.rpc('assinatura_aplicar', { p_empresa: emp.id, p })
    if (error) console.error('assinatura_aplicar', error.message)
  }
  return ok()
})
