import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await b.newPage(); const errs = []
p.on('console', (m) => { if (/Content Security Policy|Refused/.test(m.text())) errs.push(m.text()) })
p.on('pageerror', (e) => errs.push(e.message))
const A = 'http://localhost:4174'
await p.goto(A + '/'); await p.waitForTimeout(1500)
const lp = await p.locator('body').innerText()
await p.goto(A + '/entrar'); await p.waitForTimeout(800)
await p.getByLabel('E-mail').fill(process.argv[2]); await p.getByLabel('Senha').fill('Senha@123')
await p.getByRole('button', { name: 'Entrar', exact: true }).click(); await p.waitForTimeout(3000)
for (const r of ['/', '/vendas', '/vendas/nova', '/produtos', '/estoque', '/financas', '/config', '/assinatura']) { await p.goto(A + r); await p.waitForTimeout(1200) }
const logado = await p.locator('aside').count()
const fr = await (await fetch(A + '/')).headers
console.log(JSON.stringify({ lpOk: lp.length > 200, logado, erros: errs.slice(0, 10), xfo: fr.get('x-frame-options'), csp: !!fr.get('content-security-policy') }))
await b.close()
