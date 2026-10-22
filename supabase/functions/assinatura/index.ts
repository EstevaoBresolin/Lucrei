// Assinatura do Apura (cobrança via Asaas). Só o dono da empresa usa — e funciona mesmo com a empresa bloqueada.
// Ações: assinar (cria ou troca o plano e devolve o link de pagamento), fatura (link da cobrança em aberto) e cancelar.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const BASE = Deno.env.get('ASAAS_AMBIENTE') === 'producao' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3'

async function asaas(path: string, init: { method?: string; body?: unknown } = {}) {
  const key = Deno.env.get('ASAAS_API_KEY')
  if (!key) throw new Error('Cobrança ainda não configurada (ASAAS_API_KEY).')
  const r = await fetch(BASE + path, {
    method: init.method ?? 'GET',
    headers: { access_token: key, 'Content-Type': 'application/json', 'User-Agent': 'ApuraGestao' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.errors?.[0]?.description ?? `Asaas respondeu ${r.status}`)
  return j
}

const hojeBR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const digitos = (s: unknown) => String(s ?? '').replace(/\D/g, '')
/** CPF ou CNPJ com dígitos verificadores corretos */
function docValido(d: string) {
  if (/^(\d)\1+$/.test(d)) return false
  if (d.length === 11) {
    const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r }
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
  }
  if (d.length === 14) {
    const dv = (n: number) => { const p = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = p.reduce((a, x, i) => a + x * Number(d[i]), 0); const r = s % 11; return r < 2 ? 0 : 11 - r }
    return dv(12) === Number(d[12]) && dv(13) === Number(d[13])
  }
  return false
}

/** Cobrança em aberto mais antiga da assinatura (link de pagamento do Asaas). */
async function faturaAberta(assinatura: string) {
  const r = await asaas(`/subscriptions/${assinatura}/payments?limit=20`)
  const abertas = (r.data ?? []).filter((p: any) => ['PENDING', 'OVERDUE'].includes(p.status))
    .sort((a: any, b: any) => String(a.dueDate).localeCompare(String(b.dueDate)))
  return abertas[0] ? { cobranca_url: abertas[0].invoiceUrl as string, cobranca_vencimento: abertas[0].dueDate as string } : { cobranca_url: null, cobranca_vencimento: null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false },
    })
    const [{ data: empresaId }, { data: dono }, { data: u }] = await Promise.all([user.rpc('empresa_atual'), user.rpc('is_dono'), user.auth.getUser()])
    if (!empresaId || !dono) return json({ erro: 'Só o dono da empresa cuida da assinatura.' }, 403)
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const { data: emp } = await db.from('empresa').select('*').eq('id', empresaId).single()
    const aplicar = async (p: Record<string, unknown>) => {
      const { error } = await db.rpc('assinatura_aplicar', { p_empresa: empresaId, p })
      if (error) throw error
    }
    const { acao, plano: codigo, documento } = await req.json().catch(() => ({}))

    if (acao === 'assinar') {
      const { data: plano } = await db.from('plano').select('*').eq('codigo', codigo).eq('ativo', true).maybeSingle()
      if (!plano) return json({ erro: 'Escolha um plano.' }, 400)
      const descricao = `Apura Gestão · Plano ${plano.nome} (até ${plano.limite_vendas} vendas/mês)`

      // Já assina: só troca o plano (vale também para a cobrança em aberto)
      if (emp.asaas_assinatura_id) {
        await asaas(`/subscriptions/${emp.asaas_assinatura_id}`, { method: 'POST', body: { value: Number(plano.preco), description: descricao, updatePendingPayments: true } })
        const fatura = await faturaAberta(emp.asaas_assinatura_id)
        await aplicar({ plano: plano.codigo, ...fatura })
        return json({ url: fatura.cobranca_url, trocou: true })
      }

      const doc = digitos(documento || emp.documento)
      if (!docValido(doc)) return json({ erro: 'CPF ou CNPJ inválido. Confira os números.' }, 400)

      let cliente = emp.asaas_cliente_id as string | null
      if (!cliente) {
        const c = await asaas('/customers', { method: 'POST', body: { name: emp.nome, cpfCnpj: doc, email: u.user?.email, externalReference: empresaId } })
        cliente = c.id
      }
      // Assinou durante o teste: a 1ª cobrança vence quando o teste acaba (não perde os dias grátis).
      const fimTeste = emp.teste_ate ? new Date(emp.teste_ate).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : null
      const vencimento = fimTeste && fimTeste > hojeBR() ? fimTeste : hojeBR()
      const sub = await asaas('/subscriptions', {
        method: 'POST',
        body: { customer: cliente, billingType: 'UNDEFINED', value: Number(plano.preco), nextDueDate: vencimento, cycle: 'MONTHLY', description: descricao, externalReference: empresaId },
      })
      await aplicar({ plano: plano.codigo, documento: doc, asaas_cliente_id: cliente, asaas_assinatura_id: sub.id })
      const fatura = await faturaAberta(sub.id)
      await aplicar(fatura)
      return json({ url: fatura.cobranca_url })
    }

    if (acao === 'fatura') {
      if (!emp.asaas_assinatura_id) return json({ url: null })
      const fatura = await faturaAberta(emp.asaas_assinatura_id)
      await aplicar(fatura)
      return json({ url: fatura.cobranca_url })
    }

    if (acao === 'cancelar') {
      if (!emp.asaas_assinatura_id) return json({ erro: 'Não há assinatura ativa.' }, 400)
      await asaas(`/subscriptions/${emp.asaas_assinatura_id}`, { method: 'DELETE' })
      // Continua liberada até a data já paga (pago_ate); depois fica só leitura.
      await aplicar({ status: 'cancelada', asaas_assinatura_id: null, cobranca_url: null, cobranca_vencimento: null })
      return json({ ok: true })
    }

    return json({ erro: 'Ação inválida' }, 400)
  } catch (e) {
    console.error('assinatura', e)
    const msg = String((e as Error).message ?? e)
    // Mensagens do Asaas e nossas são úteis para o usuário; erros internos do banco não são mostrados
    return json({ erro: /violates|relation|column|syntax|permission denied/i.test(msg) ? 'Não foi possível concluir agora. Tente de novo em instantes.' : msg }, 500)
  }
})
