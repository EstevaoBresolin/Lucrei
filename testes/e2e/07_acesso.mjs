// Bloqueio do teste vencido, isolamento entre empresas, segunda empresa, minha conta, sair
import { abrir, APP, ok, nota, secao, salvar, shot, espera, SQL, dialog, textoErro, toast, novoUsuario, entrar } from './lib.mjs'
const DONO = SQL("select email from usuario u join membro m on m.user_id=u.id join empresa e on e.id=m.empresa_id where e.nome='Fábrica Teste' and m.papel='dono'")
const { b, page, erros } = await abrir({ storageState: '/tmp/claude-0/e2e/dono.json' })
const E = SQL("select id from empresa where nome='Fábrica Teste'")

secao('Teste grátis vencido (modo só leitura)')
SQL(`update empresa set teste_ate = now() - interval '1 day' where id='${E}'`)
await page.goto(APP + '/'); await espera(2000)
const faixa = await page.locator('main').innerText()
ok(/Modo só leitura/.test(faixa) && /teste grátis acabou/.test(faixa), 'Faixa vermelha avisa que o teste acabou')
ok(!(await page.getByRole('button', { name: 'Nova venda' }).count()), 'Botão Nova venda some')
await page.goto(APP + '/produtos'); await espera(1000)
ok(/Fone Bluetooth X/.test(await page.locator('main').innerText()), 'Continua vendo os produtos')
ok(!(await page.getByRole('button', { name: /Novo produto/ }).count()), 'Não aparece "Novo produto"')
const r = await page.evaluate(async () => {
  const k = Object.keys(localStorage).find((x) => x.includes('auth-token')); const s = JSON.parse(localStorage.getItem(k))
  const h = { apikey: s.access_token, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json', Prefer: 'return=representation' }
  const ins = await fetch('http://localhost:54321/rest/v1/produto', { method: 'POST', headers: h, body: JSON.stringify({ nome: 'Burlando o bloqueio', tipo: 'revenda' }) })
  const rpc = await fetch('http://localhost:54321/rest/v1/rpc/registrar_venda', { method: 'POST', headers: h, body: JSON.stringify({ p: { itens: [] } }) })
  const upd = await fetch('http://localhost:54321/rest/v1/empresa?id=neq.00000000-0000-0000-0000-000000000000', { method: 'PATCH', headers: h, body: JSON.stringify({ teste_ate: '2099-01-01' }) })
  return { ins: ins.status, rpc: rpc.status, upd: upd.status, updTxt: await upd.text() }
})
ok(r.ins >= 400 && r.rpc >= 400, 'Mesmo chamando a API direto, não grava nada', JSON.stringify({ produto: r.ins, venda: r.rpc }))
ok(SQL(`select teste_ate > now() from empresa where id='${E}'`) === 'f', 'Não consegue estender o próprio teste pela API', `resposta ${r.upd} ${r.updTxt.slice(0, 60)} (nenhuma linha alterada)`)
await page.goto(APP + '/financas'); await espera(1200)
ok(/Em conta agora/.test(await page.locator('main').innerText()), 'Dono continua vendo Finanças')
await page.goto(APP + '/assinatura'); await espera(1200)
ok(/Só leitura/.test(await page.locator('main').innerText()) && await page.getByRole('button', { name: /^Assinar/ }).isVisible(), 'Tela de assinatura disponível para liberar')
await shot(page, '12-bloqueada')
SQL(`update empresa set teste_ate = now() + interval '30 days' where id='${E}'`)
await page.goto(APP + '/'); await espera(1500)
ok(await page.getByRole('button', { name: 'Nova venda' }).first().isVisible(), 'Teste ativo de novo: libera os lançamentos')

secao('Isolamento entre empresas')
const OUT = `outra${Date.now()}@teste.com`; await novoUsuario(OUT, 'Senha@123', 'Outra Loja')
const o = await abrir(); await entrar(o.page, OUT)
await o.page.getByLabel('Nome da loja ou empresa').fill('Outra Loja'); await o.page.getByText('Compro pronto e revendo').click()
await o.page.getByRole('button', { name: 'Criar minha empresa' }).click(); await o.page.locator('aside').waitFor()
await o.page.goto(APP + '/produtos'); await espera(1200)
ok(!/Fone Bluetooth X/.test(await o.page.locator('main').innerText()), 'Outra empresa não vê os produtos da primeira')
const fid = SQL("select id from produto where nome='Fone Bluetooth X'")
await o.page.goto(APP + '/produtos/' + fid); await espera(1500)
ok(!/Fone Bluetooth X/.test(await o.page.locator('main').innerText()), 'Nem abrindo o endereço do produto da outra empresa')
const leak = await o.page.evaluate(async (fid) => {
  const k = Object.keys(localStorage).find((x) => x.includes('auth-token')); const s = JSON.parse(localStorage.getItem(k))
  const h = { apikey: s.access_token, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }
  const tabs = ['produto', 'venda', 'material', 'conta_financeira', 'despesa', 'cliente', 'fornecedor', 'ml_conta', 'membro', 'convite']
  const out = {}
  for (const t of tabs) { const r = await fetch(`http://localhost:54321/rest/v1/${t}?select=*`, { headers: h }); out[t] = r.ok ? (await r.json()).length : r.status }
  const u = await fetch(`http://localhost:54321/rest/v1/produto?id=eq.${fid}`, { method: 'PATCH', headers: { ...h, Prefer: 'return=representation' }, body: JSON.stringify({ nome: 'hackeado' }) })
  out.update = (await u.json()).length ?? u.status
  return out
}, fid)
ok(leak.produto === 0 && leak.venda === 0 && leak.material === 0 && leak.cliente === 0 && leak.fornecedor === 0 && (leak.ml_conta === 0 || leak.ml_conta >= 400) && leak.update === 0, 'API não devolve nem altera dados da outra empresa', JSON.stringify(leak))
ok(SQL(`select nome from produto where id='${fid}'`) === 'Fone Bluetooth X', 'Produto da outra empresa intacto')
await o.b.close()

secao('Uma empresa por conta')
await page.goto(APP + '/'); await espera(1200)
ok(!(await page.getByRole('button', { name: /Nova empresa|Criar outra empresa|Adicionar empresa/ }).count()), 'Não existe opção de criar outra empresa')
ok(/Fábrica Teste/.test(await page.locator('aside').innerText()), 'Nome da empresa continua no menu')
const seg = await page.evaluate(async () => {
  const k = Object.keys(localStorage).find((x) => x.includes('auth-token')); const s = JSON.parse(localStorage.getItem(k))
  const r = await fetch('http://localhost:54321/rest/v1/rpc/criar_empresa', { method: 'POST', headers: { apikey: s.access_token, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_nome: 'Segunda Loja', p_tipo: 'revenda' }) })
  return { s: r.status, t: await r.text() }
})
ok(seg.s >= 400 && /já tem uma empresa/.test(seg.t), 'Nem pela API dá para criar uma segunda empresa', seg.t.slice(0, 90))

secao('Minha conta e sair')
await page.goto(APP + '/'); await espera(1000)
await page.getByTitle('Minha conta').click(); let d = dialog(page)
await d.getByRole('button', { name: /Salvar|Trocar/ }).last().click()
const e1 = await textoErro(d)
ok(/6 caracteres/.test(e1), 'Senha curta é bloqueada', e1)
await d.getByRole('textbox', { name: /^Nova senha/ }).fill('Nova@1234'); await d.getByLabel('Repita a nova senha').fill('Outra@1234')
await d.getByRole('button', { name: /Salvar|Trocar/ }).last().click()
ok(/não são iguais/.test(await textoErro(d)), 'Senhas diferentes são bloqueadas')
await d.getByLabel('Repita a nova senha').fill('Nova@1234'); await d.getByRole('button', { name: /Salvar|Trocar/ }).last().click(); await espera(1500)
ok(/alterada|salva/i.test(await toast(page)) || !(await d.isVisible()), 'Trocar a senha', await toast(page))
await page.locator('aside').getByRole('button', { name: 'Sair' }).click(); await espera(1500)
ok(/quanto sobra/.test(await page.locator('body').innerText()) || /Entrar/.test(await page.locator('body').innerText()), 'Sair volta para a página inicial')
await entrar(page, DONO, 'Nova@1234'); await espera(1500)
ok(await page.locator('aside').isVisible(), 'Entra com a senha nova')
await page.context().storageState({ path: '/tmp/claude-0/e2e/dono.json' })
ok(erros.length === 0, 'Sem erros de JavaScript', erros.slice(0, 3).join(' / '))
salvar('/tmp/claude-0/e2e/r07.json'); await b.close()
