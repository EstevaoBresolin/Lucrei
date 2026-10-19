// Gateway local (imita a URL do Supabase) + simuladores do Mercado Livre, Mercado Pago e Asaas.
import http from 'node:http'
const ROTAS = { rest: 3000, auth: 9999 }
const FUNCOES = { 'ml-sync': 8101, 'ml-oauth': 8102, 'ml-webhook': 8103, 'assinatura': 8104, 'asaas-webhook': 8105 }
const log = []
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'Access-Control-Expose-Headers': '*' }

function corpo(req) { return new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))) }) }
function proxy(req, res, port, path, body) {
  const h = { ...req.headers, host: `127.0.0.1:${port}` }
  const p = http.request({ host: '127.0.0.1', port, path, method: req.method, headers: h }, (r) => {
    const hs = Object.fromEntries(Object.entries(r.headers).filter(([k]) => !k.startsWith('access-control-'))); Object.assign(hs, cors)
    res.writeHead(r.statusCode, hs); r.pipe(res)
  })
  p.on('error', (e) => { res.writeHead(502, cors); res.end('gateway: ' + e.message) })
  p.end(body)
}
const json = (res, b, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(b)) }

// ---- estado dos simuladores ----
const asaas = { clientes: [], assinaturas: {}, pagamentos: {}, seq: 1 }
const ML = {
  itens: {
    MLB1001: { id: 'MLB1001', title: 'Fone Bluetooth X', price: 99.9, available_quantity: 10, permalink: 'https://produto.mercadolivre.com.br/MLB-1001', status: 'active', seller_custom_field: 'FONE-X', variations: [], thumbnail: null },
    MLB1002: { id: 'MLB1002', title: 'Kit 2 Fones Bluetooth X', price: 179.9, available_quantity: 5, permalink: 'https://produto.mercadolivre.com.br/MLB-1002', status: 'active', seller_custom_field: null, variations: [], thumbnail: null },
  },
  pedidos: {
    5001: { id: 5001, status: 'paid', date_created: new Date().toISOString(), date_closed: new Date().toISOString(), total_amount: 199.8, buyer: { nickname: 'COMPRADOR1' },
      order_items: [{ item: { id: 'MLB1001', title: 'Fone Bluetooth X', variation_id: null }, quantity: 2, unit_price: 99.9, sale_fee: 12 }], shipping: { id: 7001 }, payments: [{ id: 9001, status: 'approved' }], pack_id: null },
    5002: { id: 5002, status: 'paid', date_created: new Date().toISOString(), date_closed: new Date().toISOString(), total_amount: 179.9, buyer: { nickname: 'COMPRADOR2' },
      order_items: [{ item: { id: 'MLB1002', title: 'Kit 2 Fones Bluetooth X', variation_id: null }, quantity: 1, unit_price: 179.9, sale_fee: 21.59 }], shipping: { id: 7002 }, payments: [{ id: 9002, status: 'approved' }], pack_id: null },
  },
}

async function simulador(req, res, url, body) {
  const p = url.pathname
  log.push({ m: req.method, p: p + url.search, b: body.length ? body.toString() : undefined })
  // Mercado Livre
  if (p === '/ml-auth') { const r = new URL(url.searchParams.get('redirect_uri')); r.searchParams.set('code', 'TG-TESTE'); r.searchParams.set('state', url.searchParams.get('state')); res.writeHead(302, { Location: r.toString() }); return res.end() }
  if (p === '/ml/oauth/token') return json(res, { access_token: 'APP_USR-teste', refresh_token: 'TG-refresh', expires_in: 21600, user_id: 999 })
  if (p === '/ml/users/me') return json(res, { id: 999, nickname: 'LOJA_TESTE' })
  if (p === '/ml/users/999/items/search') return json(res, { results: Object.keys(ML.itens), paging: { total: 2 } })
  if (p === '/ml/items') return json(res, url.searchParams.get('ids').split(',').map((id) => ({ code: 200, body: ML.itens[id] })))
  if (p === '/ml/orders/search') return json(res, { results: Object.values(ML.pedidos).map((o) => ({ id: o.id })) })
  let m
  if ((m = p.match(/^\/ml\/orders\/(\d+)$/))) return ML.pedidos[m[1]] ? json(res, ML.pedidos[m[1]]) : json(res, { message: 'not found' }, 404)
  if ((m = p.match(/^\/ml\/shipments\/(\d+)\/costs$/))) return json(res, { senders: [{ cost: 20 }] })
  if ((m = p.match(/^\/ml\/shipments\/(\d+)$/))) return json(res, { id: Number(m[1]), status: 'shipped', order_id: m[1] === '7001' ? 5001 : 5002 })
  if ((m = p.match(/^\/ml\/items\/(MLB\d+)$/))) return json(res, ML.itens[m[1]])
  if ((m = p.match(/^\/mp\/v1\/payments\/(\d+)$/))) return json(res, { transaction_details: { net_received_amount: m[1] === '9001' ? 155.42 : 138.31 }, money_release_date: '2026-11-15T10:00:00.000-03:00', money_release_status: 'pending' })
  // Asaas
  if (p === '/asaas/customers' && req.method === 'POST') { const c = { id: 'cus_' + asaas.seq++, ...JSON.parse(body) }; asaas.clientes.push(c); return json(res, c) }
  if (p === '/asaas/subscriptions' && req.method === 'POST') {
    const b = JSON.parse(body); const id = 'sub_' + asaas.seq++; asaas.assinaturas[id] = { id, ...b, status: 'ACTIVE' }
    const pid = 'pay_' + asaas.seq++; asaas.pagamentos[pid] = { id: pid, subscription: id, status: 'PENDING', dueDate: b.nextDueDate, value: b.value, invoiceUrl: `http://localhost:54321/__fatura/${pid}` }
    return json(res, asaas.assinaturas[id])
  }
  if ((m = p.match(/^\/asaas\/subscriptions\/(sub_\d+)\/payments$/))) return json(res, { data: Object.values(asaas.pagamentos).filter((x) => x.subscription === m[1]) })
  if ((m = p.match(/^\/asaas\/subscriptions\/(sub_\d+)$/))) {
    if (req.method === 'DELETE') { asaas.assinaturas[m[1]].status = 'DELETED'; return json(res, { deleted: true, id: m[1] }) }
    const b = JSON.parse(body); Object.assign(asaas.assinaturas[m[1]], b)
    if (b.updatePendingPayments) for (const x of Object.values(asaas.pagamentos)) if (x.subscription === m[1] && x.status === 'PENDING') x.value = b.value
    return json(res, asaas.assinaturas[m[1]])
  }
  return json(res, { message: 'simulador: rota desconhecida ' + p }, 404)
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const body = await corpo(req)
  if (req.method === 'OPTIONS') { res.writeHead(200, cors); return res.end('ok') }
  const [, a, b, ...resto] = url.pathname.split('/')
  if (a === 'rest' && b === 'v1') return proxy(req, res, ROTAS.rest, '/' + resto.join('/') + url.search, body)
  if (a === 'auth' && b === 'v1') return proxy(req, res, ROTAS.auth, '/' + resto.join('/') + url.search, body)
  if (a === 'functions' && b === 'v1') { const fn = resto[0]; if (!FUNCOES[fn]) return json(res, { erro: 'função não existe' }, 404); return proxy(req, res, FUNCOES[fn], '/' + resto.join('/') + url.search, body) }
  if (a === '__log') return json(res, log)
  if (a === '__asaas') return json(res, asaas)
  if (a === '__fatura') {
    // Página de pagamento do Asaas simulada: ao abrir com ?pagar=1, avisa o Lucrei como o Asaas faria.
    const pg = asaas.pagamentos[b]
    if (!pg) { res.writeHead(404); return res.end('fatura não encontrada') }
    if (url.searchParams.get('pagar') === '1') {
      pg.status = 'RECEIVED'
      const r = await fetch('http://localhost:54321/functions/v1/asaas-webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'asaas-access-token': process.env.ASAAS_WEBHOOK_TOKEN },
        body: JSON.stringify({ id: 'evt_' + pg.id + '_rec', event: 'PAYMENT_RECEIVED', payment: pg }) })
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(`<h1>Pago</h1><p id="webhook">webhook ${r.status}</p>`)
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(`<h1>Fatura Asaas (simulada)</h1><p id="valor">${pg.value}</p><p id="venc">${pg.dueDate}</p><a id="pagar" href="?pagar=1">Pagar com Pix</a>`)
  }
  if (a === '__sim') { url.pathname = '/' + [b, ...resto].join('/'); return simulador(req, res, url, body) }
  json(res, { erro: 'rota ' + url.pathname }, 404)
}).listen(54321, '127.0.0.1', () => console.log('gateway 54321'))
