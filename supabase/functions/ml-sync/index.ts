// Ações chamadas pelo sistema (usuário logado), sempre na empresa atual dele:
// link de conexão, sincronizar pedidos, reimportar um pedido e listar anúncios para importar.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { admin, APP_ID, atualizarLiberacao, cors, importarPedido, json, listarAnuncios, ml, REDIRECT_URI, salvarTokens, trocarToken } from '../_shared/ml.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false },
    })
    const [{ data: empresa }, { data: membro }] = await Promise.all([user.rpc('empresa_atual'), user.rpc('is_membro')])
    if (!empresa || !membro) return json({ erro: 'Sem permissão' }, 403)
    const { acao, order_id, code, state } = await req.json().catch(() => ({}))
    const db = admin()

    if (acao === 'auth_url') {
      const { data: dono } = await user.rpc('is_admin')
      if (!dono) return json({ erro: 'Só o dono da empresa pode conectar a conta.' }, 403)
      if (!APP_ID) return json({ erro: 'Integração com o Mercado Livre ainda não configurada (ML_APP_ID).' }, 500)
      const state = crypto.randomUUID()
      const { data: u } = await user.auth.getUser()
      await db.from('ml_oauth_state').insert({ state, empresa_id: empresa, created_by: u.user?.id ?? null })
      const url = `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}`
      return json({ url })
    }

    if (acao === 'finalizar') {
      const { data: dono } = await user.rpc('is_admin')
      if (!dono) return json({ erro: 'Só o dono da empresa pode conectar a conta.' }, 403)
      const { data: u } = await user.auth.getUser()
      // O pedido de conexão precisa ter sido feito por este mesmo usuário, nesta mesma empresa, há menos de 15 minutos
      const { data: st } = await db.from('ml_oauth_state').select('empresa_id, created_by, created_at').eq('state', String(state ?? '')).maybeSingle()
      await db.from('ml_oauth_state').delete().eq('state', String(state ?? ''))
      if (!st || st.empresa_id !== empresa || st.created_by !== u.user?.id || Date.now() - new Date(st.created_at).getTime() > 15 * 60 * 1000)
        return json({ erro: 'Este pedido de conexão não é seu ou já venceu. Clique em Conectar de novo.' }, 400)
      const t = await trocarToken({ grant_type: 'authorization_code', code: String(code ?? ''), redirect_uri: REDIRECT_URI })
      if (!t.refresh_token) return json({ erro: 'O aplicativo do Mercado Livre está sem a permissão "offline_access". Ative-a no DevCenter do ML e conecte de novo.' }, 400)
      const { data: outra } = await db.from('ml_conta').select('empresa_id').eq('ml_user_id', t.user_id).neq('empresa_id', empresa).maybeSingle()
      if (outra) return json({ erro: 'Esta conta do Mercado Livre já está conectada a outra empresa no Apura. Desconecte lá antes de conectar aqui.' }, 400)
      const me = await fetch('https://api.mercadolibre.com/users/me', { headers: { Authorization: `Bearer ${t.access_token}` } }).then((r) => r.json()).catch(() => ({}))
      await salvarTokens(db, empresa, t, { nickname: me.nickname ?? null })
      return json({ ok: true })
    }

    if (acao === 'importar' && order_id) return json({ resultado: await importarPedido(db, empresa, Number(order_id)) })

    if (acao === 'listar_anuncios') return json({ anuncios: await listarAnuncios(db, empresa) })

    if (acao === 'sincronizar') {
      const { data: c } = await db.from('ml_conta').select('ml_user_id').eq('empresa_id', empresa).maybeSingle()
      if (!c?.ml_user_id) return json({ erro: 'Mercado Livre não conectado' }, 400)
      const desde = new Date(Date.now() - 7 * 864e5).toISOString()
      const r = await ml(db, empresa, `/orders/search?seller=${c.ml_user_id}&order.date_created.from=${encodeURIComponent(desde)}&sort=date_desc&limit=50`)
      const cont: Record<string, number> = {}
      const vistos = new Set<number>()
      for (const o of r.results ?? []) {
        let res: string
        try { res = await importarPedido(db, empresa, o.id) } catch { res = 'erro' }
        cont[res] = (cont[res] ?? 0) + 1
        vistos.add(Number(o.id))
      }
      // Vendas mais antigas com dinheiro ainda não liberado: confere valor e data de liberação no Mercado Pago.
      const { data: pend } = await db.from('venda').select('ml_order_id').eq('empresa_id', empresa).not('ml_order_id', 'is', null)
        .eq('ml_liberado', false).not('status', 'in', '(cancelada,devolvida)').limit(100)
      let liberacoes = 0
      for (const v of pend ?? []) {
        if (vistos.has(Number(v.ml_order_id))) continue
        if (await atualizarLiberacao(db, empresa, Number(v.ml_order_id))) liberacoes++
      }
      return json({ total: (r.results ?? []).length, ...cont, liberacoes })
    }
    return json({ erro: 'Ação inválida' }, 400)
  } catch (e) {
    return json({ erro: String((e as Error).message ?? e) }, 500)
  }
})
