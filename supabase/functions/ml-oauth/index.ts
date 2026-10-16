// Volta da autorização do Mercado Livre: troca o código pelos tokens e guarda na empresa que pediu a conexão.
import { admin, APP_URL, REDIRECT_URI, salvarTokens, trocarToken } from '../_shared/ml.ts'

const voltar = (q: string) => Response.redirect(`${APP_URL}/config?${q}`, 302)
const erro = (msg: string) => voltar('ml=erro&msg=' + encodeURIComponent(msg))

Deno.serve(async (req) => {
  const u = new URL(req.url)
  const code = u.searchParams.get('code'), state = u.searchParams.get('state')
  if (!code || !state) return erro(u.searchParams.get('error_description') ?? 'Autorização cancelada')
  const db = admin()
  // Só aceita autorizações iniciadas pelo botão "Conectar" (vale 15 minutos) e sabe de qual empresa ela é.
  const { data: st } = await db.from('ml_oauth_state').select('empresa_id, created_at').eq('state', state).maybeSingle()
  await db.from('ml_oauth_state').delete().eq('state', state)
  if (!st || Date.now() - new Date(st.created_at).getTime() > 15 * 60 * 1000) return erro('Link de conexão vencido. Clique em Conectar de novo.')
  try {
    const t = await trocarToken({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI })
    // Sem refresh_token a conexão morre em 6 horas: o app do ML precisa do escopo offline_access.
    if (!t.refresh_token) return erro('O aplicativo do Mercado Livre está sem a permissão "offline_access". Ative-a nas configurações do app no DevCenter do ML e conecte de novo.')
    // Uma conta do Mercado Livre só pode estar ligada a uma empresa do Lucrei.
    const { data: outra } = await db.from('ml_conta').select('empresa_id').eq('ml_user_id', t.user_id).neq('empresa_id', st.empresa_id).maybeSingle()
    if (outra) return erro('Esta conta do Mercado Livre já está conectada a outra empresa no Lucrei. Desconecte lá antes de conectar aqui.')
    const me = await fetch('https://api.mercadolibre.com/users/me', { headers: { Authorization: `Bearer ${t.access_token}` } }).then((r) => r.json()).catch(() => ({}))
    await salvarTokens(db, st.empresa_id, t, { nickname: me.nickname ?? null })
    return voltar('ml=ok')
  } catch (e) {
    return erro(String((e as Error).message ?? e))
  }
})
