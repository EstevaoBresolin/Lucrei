// Ataques: anônimo, operador, outra empresa, testes grátis em série, convite, ML, XSS, cabeçalhos
import { abrir, APP, ok, nota, secao, salvar, espera, SQL, novoUsuario, entrar, KEYS_ } from './lib.mjs'
const API = 'http://localhost:54321'
const anonH = { apikey: KEYS_.ANON_KEY, Authorization: 'Bearer ' + KEYS_.ANON_KEY, 'Content-Type': 'application/json' }
async function login(email, senha = 'Senha@123') {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: anonH, body: JSON.stringify({ email, password: senha }) })
  const j = await r.json(); return { apikey: KEYS_.ANON_KEY, Authorization: 'Bearer ' + j.access_token, 'Content-Type': 'application/json', Prefer: 'return=representation' }
}
const rest = (h, path, init = {}) => fetch(`${API}/rest/v1/${path}`, { headers: h, ...init }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }))
const rpc = (h, f, body = {}) => rest(h, `rpc/${f}`, { method: 'POST', body: JSON.stringify(body) })
const fn = (h, f, body) => fetch(`${API}/functions/v1/${f}`, { method: 'POST', headers: h, body: JSON.stringify(body) }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }))
const linhas = (r) => (Array.isArray(r.j) ? r.j.length : 0)
const T = Date.now()

// ---------- montar o cenário: empresa A (dono + operador), empresa B (outro dono) ----------
const DA = `donoa${T}@teste.com`, OP = `oper${T}@teste.com`, DB = `donob${T}@teste.com`
for (const e of [DA, OP, DB]) await novoUsuario(e)
const hA = await login(DA), hOp = await login(OP), hB = await login(DB)
const EA = (await rpc(hA, 'criar_empresa', { p_nome: 'Seg A', p_tipo: 'revenda' })).j
const EB = (await rpc(hB, 'criar_empresa', { p_nome: 'Seg B', p_tipo: 'revenda' })).j
const tok = (await rpc(hA, 'criar_convite', { p_papel: 'operador', p_email: OP })).j
await rpc(hOp, 'aceitar_convite', { p_token: tok })
ok(SQL(`select papel from membro m join usuario u on u.id=m.user_id where u.email='${OP}' and m.empresa_id='${EA}'`) === 'operador', 'Cenário: operador entrou na empresa A')
// dados da empresa A
const pA = (await rest(hA, 'produto', { method: 'POST', body: JSON.stringify({ nome: 'Produto A', tipo: 'revenda' }) })).j?.[0]?.id
const cA = (await rest(hA, 'conta_financeira', { method: 'POST', body: JSON.stringify({ nome: 'Banco A', saldo_inicial: 1234.56 }) }))
const pB = (await rest(hB, 'produto', { method: 'POST', body: JSON.stringify({ nome: 'Produto B', tipo: 'revenda' }) })).j?.[0]?.id
SQL(`update empresa set documento='52998224725' where id='${EA}'`)
ok(pA && pB, 'Cenário: produtos criados', JSON.stringify(cA.s))

// ---------- 1. Anônimo ----------
secao('Sem login (chave pública do site)')
const tabelas = SQL("select string_agg(tablename, ',') from pg_tables where schemaname='public'").split(',')
const vazou = []
for (const t of [...tabelas, 'vw_extrato', 'vw_conta_saldo', 'vw_ml_a_receber', 'vw_produto_estoque', 'vw_material_estoque', 'vw_canal_taxa_vigente']) {
  const r = await rest(anonH, `${t}?select=*&limit=5`)
  if (r.s === 200 && linhas(r) > 0 && t !== 'plano') vazou.push(t)
}
ok(!vazou.length, `Nenhuma das ${tabelas.length + 6} tabelas/visões devolve dados sem login (plano é público de propósito)`, vazou.join(', '))
const escrita = await rest(anonH, 'produto', { method: 'POST', body: JSON.stringify({ empresa_id: EA, nome: 'anon', tipo: 'revenda' }) })
ok(escrita.s >= 400, 'Sem login não grava nada', String(escrita.s))
const funcs = SQL("select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute') and p.proname not in (select proname from pg_proc p2 join pg_depend d on d.objid=p2.oid and d.deptype='e')")
ok(!funcs, 'Nenhuma função do sistema pode ser chamada sem login', funcs)
const anonPlano = await rest(anonH, 'plano?select=*')
ok(anonPlano.s === 200 && !JSON.stringify(anonPlano.j).match(/asaas|token|secret/i), 'Tabela de planos pública só tem preço e limite')

// ---------- 2. Operador ----------
secao('Operador tentando ver/fazer o que é do dono')
const vs = await rest(hOp, 'vw_conta_saldo?select=*'), ve = await rest(hOp, 'vw_extrato?select=*'), vm = await rest(hOp, 'vw_ml_a_receber?select=*')
ok(linhas(vs) === 0 && linhas(ve) === 0 && linhas(vm) === 0, 'Operador não vê saldos, extrato nem a receber do ML pela API', `${vs.s}/${ve.s}/${vm.s}`)
ok(linhas(await rest(hA, 'vw_conta_saldo?select=*')) === 1, 'Dono continua vendo o saldo')
const doc = await rest(hOp, 'empresa?select=documento')
ok(doc.s >= 400 || !JSON.stringify(doc.j).includes('52998224725'), 'Operador não lê o CPF/CNPJ do dono', String(doc.s))
const docDono = await rest(hA, 'empresa?select=documento')
ok(docDono.s >= 400, 'Coluna do documento fechada até para o dono pela tabela (sai só pela minha_assinatura)', String(docDono.s))
const ass = await rpc(hOp, 'minha_assinatura')
ok(!JSON.stringify(ass.j).includes('52998224725'), 'minha_assinatura não entrega o documento ao operador')
ok(JSON.stringify((await rpc(hA, 'minha_assinatura')).j).includes('52998224725'), 'minha_assinatura entrega o documento ao dono')
const meuId = SQL(`select id from usuario where email='${OP}'`), donoId = SQL(`select id from usuario where email='${DA}'`)
const em = await rest(hOp, `usuario?id=eq.${meuId}`, { method: 'PATCH', body: JSON.stringify({ email: DA }) })
ok(SQL(`select email from usuario where id='${meuId}'`) === OP, 'Operador não troca o próprio e-mail na lista da equipe (falsificar o dono)', String(em.s))
const nm = await rest(hOp, `usuario?id=eq.${meuId}`, { method: 'PATCH', body: JSON.stringify({ nome: 'Novo nome' }) })
ok(nm.s < 300 && SQL(`select nome from usuario where id='${meuId}'`) === 'Novo nome', 'Mas consegue trocar o próprio nome')
const pp = await rest(hOp, `membro?user_id=eq.${meuId}`, { method: 'PATCH', body: JSON.stringify({ papel: 'dono' }) })
ok(SQL(`select papel from membro where user_id='${meuId}' and empresa_id='${EA}'`) === 'operador', 'Operador não se promove a dono', String(pp.s))
const del = await rest(hOp, `produto?id=eq.${pA}`, { method: 'DELETE' })
ok(SQL(`select count(*) from produto where id='${pA}'`) === '1', 'Operador não exclui produto pela API', String(del.s))
const conv = await rpc(hOp, 'criar_convite', { p_papel: 'dono', p_email: 'x@x.com' })
ok(conv.s >= 400, 'Operador não cria convite (nem de dono)', String(conv.s))
const lconv = await rest(hOp, 'convite?select=token')
ok(linhas(lconv) === 0, 'Operador não enxerga os códigos de convite')
const ap = await rpc(hOp, 'assinatura_aplicar', { p_empresa: EA, p: { status: 'cortesia' } })
ok(ap.s >= 400 && SQL(`select status from empresa where id='${EA}'`) === 'teste', 'Ninguém logado chama assinatura_aplicar (virar cortesia)', String(ap.s))
const est = await rest(hA, `empresa?id=eq.${EA}`, { method: 'PATCH', body: JSON.stringify({ status: 'cortesia', teste_ate: '2099-01-01', created_by: meuId }) })
ok(SQL(`select status||'|'||(teste_ate<'2099-01-01')||'|'||(created_by='${donoId}') from empresa where id='${EA}'`) === 'teste|true|true', 'Dono não muda a própria cobrança/teste/criador pela API', String(est.s))
const ass2 = await fn(hOp, 'assinatura', { acao: 'cancelar' })
ok(ass2.s === 403, 'Operador não cancela/assina pela função de assinatura', String(ass2.s))

// ---------- 3. Entre empresas ----------
secao('Empresa B tentando mexer na empresa A')
ok(linhas(await rest(hB, `produto?id=eq.${pA}`)) === 0, 'B não vê produto de A pelo id')
const up = await rest(hB, `produto?id=eq.${pA}`, { method: 'PATCH', body: JSON.stringify({ nome: 'hackeado' }) })
ok(SQL(`select nome from produto where id='${pA}'`) === 'Produto A', 'B não altera produto de A', String(up.s))
const ins = await rest(hB, 'produto', { method: 'POST', body: JSON.stringify({ empresa_id: EA, nome: 'plantado', tipo: 'revenda' }) })
ok(SQL(`select count(*) from produto where nome='plantado' and empresa_id='${EA}'`) === '0', 'B não planta produto na empresa A', String(ins.s))
const tr = await rpc(hB, 'trocar_empresa', { p_empresa: EA })
ok(tr.s >= 400, 'B não troca para a empresa A', String(tr.s))
const idB = SQL(`select id from usuario where email='${DB}'`)
await rest(hB, `usuario?id=eq.${idB}`, { method: 'PATCH', body: JSON.stringify({ empresa_atual: EA }) })
ok(SQL(`select empresa_atual from usuario where id='${idB}'`) === EB, 'B não se coloca na empresa A editando o próprio usuário')
const vB = await rpc(hB, 'registrar_venda', { p: { data: new Date().toISOString().slice(0, 10), itens: [{ produto_id: pA, quantidade: 1, preco_unit: 10 }] } })
ok(vB.s >= 400 && SQL(`select count(*) from venda_item where produto_id='${pA}'`) === '0', 'B não lança venda usando produto de A', String(vB.s) + ' ' + (vB.j?.message ?? '').slice(0, 60))
const exB = await rpc(hB, 'excluir_produto', { p_id: pA })
ok(SQL(`select count(*) from produto where id='${pA}'`) === '1', 'B não exclui produto de A pela função', String(exB.s))
const mov = await rpc(hB, 'movimentar_estoque', { p_item_tipo: 'produto', p_item_id: pA, p_tipo: 'entrada', p_quantidade: 5, p_custo_unit: 1, p_motivo: 'x' })
ok(SQL(`select count(*) from movimento_estoque where produto_id='${pA}'`) === '0', 'B não mexe no estoque de A', String(mov.s))
for (const f of ['importar_venda_ml', 'ml_cancelar_venda', 'ml_mudar_status']) {
  const r = await rpc(hB, f, { p_empresa: EA, p: {}, p_order: 1, p_shipment: 1, p_id: pA, p_motivo: 'x', p_status: 'x' })
  ok(r.s >= 400, `Função interna ${f} (recebe a empresa por parâmetro) não pode ser chamada logado`, String(r.s))
}

// ---------- 4. Uma empresa por conta ----------
secao('Uma empresa por conta (sem teste grátis infinito)')
const r2 = await rpc(hB, 'criar_empresa', { p_nome: 'Seg B2', p_tipo: 'revenda' })
ok(r2.s >= 400 && /já tem uma empresa/.test(JSON.stringify(r2.j)), 'Segunda empresa do mesmo usuário é recusada', r2.j?.message)
ok(SQL(`select count(*) from empresa where nome='Seg B2'`) === '0' && SQL(`select teste_ate > now() + interval '29 days' from empresa where id='${EB}'`) === 't', 'A primeira continua com 30 dias e nada foi criado')
const longo = await rpc(hA, 'criar_empresa', { p_nome: 'x'.repeat(500), p_tipo: 'revenda' })
ok(longo.s >= 400, 'Nome de empresa gigante é recusado', String(longo.s))

// ---------- 5. Convites ----------
secao('Convites')
const X = `intruso${T}@teste.com`; await novoUsuario(X); const hX = await login(X)
const tokOutro = (await rpc(hA, 'criar_convite', { p_papel: 'operador', p_email: `alguem${T}@teste.com` })).j
const ac = await rpc(hX, 'aceitar_convite', { p_token: tokOutro })
ok(ac.s >= 400 && SQL(`select count(*) from membro m join usuario u on u.id=m.user_id where u.email='${X}'`) === '0', 'Convite feito para um e-mail não é aceito por outra pessoa', ac.j?.message)
const ac2 = await rpc(hX, 'aceitar_convite', { p_token: tok })
ok(ac2.s >= 400, 'Convite já usado não serve de novo', ac2.j?.message)
const ac3 = await rpc(hX, 'aceitar_convite', { p_token: 'a'.repeat(36) })
ok(ac3.s >= 400, 'Código de convite inventado não funciona')
const tokVenc = (await rpc(hA, 'criar_convite', { p_papel: 'operador', p_email: '' })).j
SQL(`update convite set expira_em = now() - interval '1 day' where token='${tokVenc}'`)
ok((await rpc(hX, 'aceitar_convite', { p_token: tokVenc })).s >= 400, 'Convite vencido não funciona')

// ---------- 6. Mercado Livre ----------
secao('Mercado Livre')
await rpc(hB, 'trocar_empresa', { p_empresa: EB })
const au = await fn(hA, 'ml-sync', { acao: 'auth_url' })
const stateA = new URL(au.j?.url ?? 'http://x/?state=').searchParams.get('state')
ok(/^[0-9a-f-]{36}$/.test(stateA ?? ''), 'Pedido de conexão gera um código único', String(au.s))
const fB = await fn(hB, 'ml-sync', { acao: 'finalizar', code: 'TG-falso', state: stateA })
ok(fB.s === 400 && SQL(`select count(*) from ml_conta where empresa_id='${EB}' and ml_user_id is not null`) === '0', 'Outra empresa não usa o pedido de conexão de A (link preparado)', fB.j?.erro)
ok(SQL(`select count(*) from ml_oauth_state where state='${stateA}'`) === '0', 'O pedido é descartado depois da tentativa')
const fOp = await fn(hOp, 'ml-sync', { acao: 'finalizar', code: 'x', state: stateA })
ok(fOp.s === 403, 'Operador não conecta conta do ML', String(fOp.s))
const cb = await fetch(`${API}/functions/v1/ml-oauth?code=abc&state=${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}`, { redirect: 'manual' })
ok(/motivo=vencido/.test(cb.headers.get('location') ?? ''), 'Volta do ML com código desconhecido é recusada', cb.headers.get('location'))
const cb2 = await fetch(`${API}/functions/v1/ml-oauth?code=abc&state=<script>`, { redirect: 'manual' })
ok(/motivo=cancelado/.test(cb2.headers.get('location') ?? '') && !/script/.test(cb2.headers.get('location') ?? ''), 'Parâmetros estranhos na volta do ML não são repassados', cb2.headers.get('location'))
const evAntes = SQL('select count(*) from ml_evento')
const app = '123456'
for (const body of [{ resource: '/orders/1', user_id: 999999, topic: 'orders_v2', application_id: 'falso' },
  { resource: '/orders/1', user_id: 999999, topic: 'orders_v2', application_id: app },
  { resource: '../../etc', user_id: 1, topic: 'x', application_id: app }]) await fetch(`${API}/functions/v1/ml-webhook`, { method: 'POST', body: JSON.stringify(body) })
ok(SQL('select count(*) from ml_evento') === evAntes, 'Avisos falsos do ML (app errado, conta desconhecida, caminho estranho) não gravam nada')
const big = await fetch(`${API}/functions/v1/ml-webhook`, { method: 'POST', body: 'x'.repeat(100000) })
ok(big.status < 500, 'Aviso do ML com lixo não derruba a função', String(big.status))

// ---------- 7. Asaas ----------
secao('Webhook de cobrança (Asaas)')
const semTok = await fetch(`${API}/functions/v1/asaas-webhook`, { method: 'POST', body: JSON.stringify({ event: 'PAYMENT_RECEIVED', payment: { subscription: 'x', dueDate: '2099-01-01' } }) })
ok(semTok.status === 401, 'Sem o token secreto o aviso de pagamento é recusado')
const tokErr = await fetch(`${API}/functions/v1/asaas-webhook`, { method: 'POST', headers: { 'asaas-access-token': 'chute' }, body: '{}' })
ok(tokErr.status === 401, 'Com token errado também')
SQL(`update empresa set asaas_assinatura_id='sub_atual_${T}' where id='${EB}'`)
await fetch(`${API}/functions/v1/asaas-webhook`, { method: 'POST', headers: { 'asaas-access-token': KEYS_.ASAAS_WEBHOOK_TOKEN }, body: JSON.stringify({ id: 'ev_' + T, event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_velha_' + T, externalReference: EB } }) })
ok(SQL(`select status||'|'||asaas_assinatura_id from empresa where id='${EB}'`) === `teste|sub_atual_${T}`, 'Aviso de uma assinatura antiga não cancela a atual')
const docRuim = await fn(hA, 'assinatura', { acao: 'assinar', plano: 'inicial', documento: '11111111111' })
ok(docRuim.s === 400, 'CPF falso é recusado também no servidor', docRuim.j?.erro)

// ---------- 8. XSS ----------
secao('Textos maliciosos (XSS)')
const XSS = `<img src=x onerror="window.__xss=1">"><script>window.__xss=1</script>`
await rest(hA, `produto?id=eq.${pA}`, { method: 'PATCH', body: JSON.stringify({ nome: 'Prod ' + XSS }) })
await rest(hA, 'cliente', { method: 'POST', body: JSON.stringify({ nome: 'Cli ' + XSS }) })
await rest(hA, 'fornecedor', { method: 'POST', body: JSON.stringify({ nome: 'Forn ' + XSS }) })
await rest(hA, `usuario?id=eq.${donoId}`, { method: 'PATCH', body: JSON.stringify({ nome: 'Dono ' + XSS }) })
SQL(`update empresa set nome=${"'Seg A <img src=x onerror=window.__xss=1>'"} where id='${EA}'`)
const { b, page, erros } = await abrir()
let alerta = false; page.on('dialog', (d) => { alerta = true; d.dismiss() })
await entrar(page, DA)
for (const p of ['/', '/produtos', '/cadastros', '/estoque', '/config', '/vendas/nova', '/compras']) { await page.goto(APP + p).catch(() => {}); await espera(900) }
const disparou = await page.evaluate(() => window.__xss === 1)
ok(!disparou && !alerta, 'Nomes com código HTML/JS aparecem como texto e não executam', disparou ? 'EXECUTOU' : '')
ok(/<img src=x/.test(await page.locator('body').innerText()), 'O texto aparece escapado na tela')
const g = await page.goto(APP + '/config?ml=erro&msg=' + encodeURIComponent('Sua conta foi suspensa, ligue 0800')); await espera(1000)
ok(!/ligue 0800/.test(await page.locator('body').innerText()), 'Mensagem livre na URL não aparece na tela (golpe de texto)')
await b.close()
salvar('/tmp/claude-0/e2e/logs/10.json')
