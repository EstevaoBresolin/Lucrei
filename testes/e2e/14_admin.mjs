// Painel do administrador da plataforma: só o admin vê e age; ninguém mais lê os dados de outras empresas
import { abrir, APP, ok, secao, salvar, espera, SQL, novoUsuario, entrar, KEYS_ as KEYS } from './lib.mjs'

const T = Date.now()
const ADM = `adm${T}@teste.com`, CLI = `cli${T}@teste.com`
const uAdm = await novoUsuario(ADM, 'Senha@123', 'Admin Apura')
await novoUsuario(CLI, 'Senha@123', 'Cliente Um')

async function criarEmpresa(page, email, nome) {
  await entrar(page, email); await espera(800)
  await page.getByLabel('Nome da loja ou empresa').fill(nome); await page.getByText('Compro pronto e revendo').click()
  await page.getByRole('button', { name: 'Criar minha empresa' }).click(); await page.locator('aside').waitFor({ timeout: 15000 })
}
async function token(email) {
  const r = await fetch('http://localhost:54321/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: KEYS.ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Senha@123' }) })
  return (await r.json()).access_token
}
const rest = (tk, caminho, opts = {}) => fetch('http://localhost:54321/rest/v1/' + caminho, { ...opts, headers: { apikey: KEYS.ANON_KEY, Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers ?? {}) } })

const { b, page: pc, erros } = await abrir()
await criarEmpresa(pc, CLI, `Cliente ${T}`)
const empCli = SQL(`select id from empresa where nome='Cliente ${T}'`)
const { b: b2, page: pa, erros: erros2 } = await abrir()
await criarEmpresa(pa, ADM, `Admin ${T}`)

secao('Quem não é admin')
ok(!(await pc.locator('aside').getByText('Admin', { exact: true }).count()), 'Cliente não vê o menu Admin')
await pc.goto(APP + '/admin'); await espera(1500)
ok(new URL(pc.url()).pathname === '/', 'Cliente abrindo /admin volta para o painel', pc.url())
const tkCli = await token(CLI)
let r = await rest(tkCli, 'rpc/admin_empresas', { method: 'POST', body: '{}' })
ok(r.status >= 400, 'Cliente chamando admin_empresas direto é recusado', `${r.status} ${(await r.text()).slice(0, 80)}`)
r = await rest(tkCli, 'rpc/admin_acao', { method: 'POST', body: JSON.stringify({ p_empresa: empCli, p_acao: 'cortesia' }) })
ok(r.status >= 400 && SQL(`select status from empresa where id='${empCli}'`) === 'teste', 'Cliente não consegue se dar cortesia', `${r.status}`)
r = await rest(tkCli, 'plataforma_admin', { method: 'POST', body: JSON.stringify({ user_id: (await (await fetch('http://localhost:54321/auth/v1/user', { headers: { apikey: KEYS.ANON_KEY, Authorization: `Bearer ${tkCli}` } })).json()).id }) })
ok(r.status >= 400, 'Cliente não consegue se colocar como admin', `${r.status}`)
r = await rest(tkCli, `empresa?id=eq.${empCli}`, { method: 'PATCH', body: JSON.stringify({ bloqueio_admin: null, status: 'cortesia' }) })
ok(SQL(`select status from empresa where id='${empCli}'`) === 'teste', 'Cliente não mexe no próprio status/bloqueio pela API', `${r.status}`)
r = await rest(tkCli, 'rpc/sou_admin_plataforma', { method: 'POST', body: '{}' })
ok((await r.text()) === 'false', 'sou_admin_plataforma diz false para o cliente')

secao('Admin vê todas as empresas')
SQL(`insert into plataforma_admin (user_id) values ('${uAdm.id}')`)
await pa.reload(); await pa.locator('aside').waitFor()
ok(await pa.locator('aside').getByText('Admin', { exact: true }).count(), 'Admin vê o menu Admin')
await pa.locator('aside').getByText('Admin', { exact: true }).click(); await pa.getByText('Todas as empresas do Apura').waitFor()
await espera(800)
ok(await pa.getByText(`Cliente ${T}`).count() && await pa.getByText(`Admin ${T}`).count(), 'Lista mostra a empresa do cliente e a do admin')
ok(await pa.getByRole('cell', { name: new RegExp(CLI) }).count(), 'Mostra o e-mail do dono')
const linha = pa.getByRole('row', { name: new RegExp(`Cliente ${T}`) })
ok(/Em teste/.test(await linha.innerText()), 'Situação "Em teste" na lista', (await linha.innerText()).replace(/\s+/g, ' '))
await pa.getByPlaceholder(/Buscar/).fill(`cli${T}`); await espera(300)
ok(await pa.getByRole('row').count() === 2, 'Busca por e-mail filtra (cabeçalho + 1 linha)')
await pa.getByPlaceholder(/Buscar/).fill('')

secao('Ações do admin')
const antes = SQL(`select teste_ate::date from empresa where id='${empCli}'`)
await linha.click(); const dlg = pa.getByRole('dialog'); await dlg.waitFor()
ok(/Pode lançar normalmente/.test(await dlg.innerText()), 'Detalhe abre e mostra que a empresa está liberada')
await dlg.getByLabel('Dias').fill('10'); await dlg.getByRole('button', { name: 'Estender teste' }).click(); await espera(1200)
const depois = SQL(`select teste_ate::date from empresa where id='${empCli}'`)
ok((new Date(depois) - new Date(antes)) / 86400000 === 10, 'Estender teste soma 10 dias', `${antes} → ${depois}`)

await dlg.getByRole('button', { name: 'Bloquear…' }).click()
ok(await dlg.getByRole('button', { name: 'Bloquear empresa' }).isDisabled(), 'Bloquear exige motivo')
await dlg.getByLabel(/Motivo/).fill('Teste de bloqueio'); await dlg.getByRole('button', { name: 'Bloquear empresa' }).click(); await espera(1200)
ok(SQL(`select bloqueio_admin from empresa where id='${empCli}'`) === 'Teste de bloqueio', 'Bloqueio gravado com motivo')
ok(/Em modo só leitura/.test(await dlg.innerText()) && /Bloqueada por você/.test(await dlg.innerText()), 'Detalhe mostra o bloqueio')
await pc.goto(APP + '/'); await espera(2000)
ok(/Conta suspensa/.test(await pc.locator('main').innerText()), 'Cliente vê "Conta suspensa"')
r = await rest(tkCli, 'produto', { method: 'POST', body: JSON.stringify({ nome: 'Produto bloqueado', tipo: 'revenda', custo_padrao: 1 }) })
ok(r.status >= 400, 'Empresa bloqueada não consegue lançar nada', `${r.status}`)
SQL(`update empresa set status='ativa', pago_ate=current_date + 30 where id='${empCli}'`)
ok(SQL(`select bloqueio_admin is not null and not empresa_liberada(id) from empresa where id='${empCli}'`) === 't', 'Pagamento não desfaz o bloqueio do admin')
SQL(`update empresa set status='teste', pago_ate=null where id='${empCli}'`)

await dlg.getByRole('button', { name: 'Desbloquear' }).click(); await espera(1200)
ok(SQL(`select bloqueio_admin is null and empresa_liberada(id) from empresa where id='${empCli}'`) === 't', 'Desbloquear libera de novo')

await dlg.getByRole('button', { name: 'Dar cortesia' }).click(); await pa.getByRole('dialog', { name: 'Dar cortesia?' }).getByRole('button', { name: 'Dar cortesia' }).click(); await espera(1200)
ok(SQL(`select status from empresa where id='${empCli}'`) === 'cortesia', 'Dar cortesia')
await dlg.getByRole('button', { name: 'Tirar cortesia' }).click(); await pa.getByRole('dialog', { name: 'Tirar a cortesia?' }).getByRole('button', { name: 'Tirar cortesia' }).click(); await espera(1200)
ok(SQL(`select status from empresa where id='${empCli}'`) === 'teste', 'Tirar cortesia volta para teste')
const hist = await dlg.innerText()
ok(['Estendeu o teste (+10 dias)', 'Bloqueou: Teste de bloqueio', 'Desbloqueou', 'Deu cortesia', 'Tirou a cortesia'].every((t) => hist.includes(t)), 'Histórico registra as 5 ações')

secao('Celular')
const { b: b3, page: pm } = await abrir({ viewport: { width: 390, height: 844 } })
await entrar(pm, ADM); await pm.goto(APP + '/admin'); await pm.getByText('Todas as empresas do Apura').waitFor(); await espera(800)
ok(await pm.getByRole('button', { name: new RegExp(`Cliente ${T}`) }).isVisible(), 'Lista em cartões no celular')
ok(await pm.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Sem rolagem lateral no celular')
await b3.close()

ok(!erros.length && !erros2.length, 'Sem erros no console', [...erros, ...erros2].join(' | ').slice(0, 200))
await b.close(); await b2.close()
salvar('../r14.json')
