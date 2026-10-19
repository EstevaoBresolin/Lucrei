// Volta da autorização do Mercado Livre. Não conecta nada aqui: só confere o pedido e devolve o código
// para o site, onde o próprio usuário logado que clicou em "Conectar" conclui a conexão (ml-sync, ação finalizar).
// Assim ninguém consegue ligar a conta do ML de outra pessoa à própria empresa com um link preparado.
import { admin, APP_URL } from '../_shared/ml.ts'

const voltar = (q: string) => Response.redirect(`${APP_URL}/config?${q}`, 302)

Deno.serve(async (req) => {
  const u = new URL(req.url)
  const code = u.searchParams.get('code'), state = u.searchParams.get('state')
  if (!code || !state || !/^[0-9a-f-]{36}$/.test(state) || code.length > 200) return voltar('ml=erro&motivo=cancelado')
  const { data: st } = await admin().from('ml_oauth_state').select('created_at').eq('state', state).maybeSingle()
  if (!st || Date.now() - new Date(st.created_at).getTime() > 15 * 60 * 1000) return voltar('ml=erro&motivo=vencido')
  return voltar(`ml_code=${encodeURIComponent(code)}&ml_state=${state}`)
})
