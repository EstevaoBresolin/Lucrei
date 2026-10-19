// Passa por todas as telas no celular (390px) e no modo escuro: rolagem lateral, textos cortados, erros
import { abrir, APP, ok, secao, salvar, shot, espera, SQL } from './lib.mjs'
const fid = SQL("select id from produto where nome='Fone Bluetooth X'"), vid = SQL("select id from venda order by numero limit 1")
const rotas = ['/', '/vendas', '/vendas/nova', `/vendas/${vid}`, '/produtos', `/produtos/${fid}`, '/estoque', '/insumos', '/producao', '/compras', '/cadastros', '/financas', '/financeiro', '/config', '/assinatura']
for (const [modo, opts] of [['celular', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }], ['escuro', { colorScheme: 'dark' }]]) {
  secao(`Todas as telas — ${modo}`)
  const { b, page, erros } = await abrir({ storageState: '/tmp/claude-0/e2e/dono.json', ...opts })
  for (const r of rotas) {
    await page.goto(APP + r); await espera(1500)
    const largura = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    const vazio = (await page.locator('main').innerText().catch(() => '')).trim().length < 20
    ok(largura <= 1 && !vazio, `${r} abre sem rolagem lateral`, largura > 1 ? `vaza ${largura}px para o lado` : vazio ? 'tela vazia' : '')
    await shot(page, `${modo}${r.replace(/\//g, '_').replace(/_[0-9a-f-]{36}/, '_id') || '_painel'}`)
  }
  if (modo === 'celular') {
    await page.goto(APP + '/'); await espera(800)
    await page.getByRole('button', { name: 'Mais' }).click(); await espera(400)
    ok(await page.getByRole('link', { name: 'Configurações' }).isVisible(), 'Menu "Mais" no celular abre as outras telas')
    await page.goto(APP + '/'); await espera(800)
    await page.getByRole('button', { name: 'Nova venda' }).last().click(); await espera(800)
    ok(page.url().endsWith('/vendas/nova'), 'Botão + do celular abre Nova venda')
    ok(await page.getByText(/Lucro · margem/).isVisible(), 'Barra de lucro fixa no celular')
  }
  ok(erros.length === 0, `Sem erros de JavaScript (${modo})`, erros.slice(0, 3).join(' / '))
  await b.close()
}
for (const [modo, opts] of [['celular', { viewport: { width: 390, height: 844 } }]]) {
  const { b, page } = await abrir(opts)
  for (const r of ['/', '/cadastro', '/entrar', '/termos', '/privacidade']) {
    await page.goto(APP + r); await espera(1200)
    const largura = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(largura <= 1, `${r} (público) sem rolagem lateral no celular`, largura > 1 ? `vaza ${largura}px` : '')
  }
  await b.close()
}
salvar('/tmp/claude-0/e2e/r08.json')
