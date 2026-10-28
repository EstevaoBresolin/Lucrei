import { chromium } from 'playwright'
import fs from 'node:fs'
export const APP = 'http://localhost:4173'
export const R = []
let area = ''
export const secao = (s) => { area = s; console.log('\n## ' + s) }
export function ok(cond, nome, obs = '') { R.push({ area, nome, ok: !!cond, obs }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${nome}${obs ? '  — ' + obs : ''}`) }
export function nota(nome, obs) { R.push({ area, nome, ok: null, obs }); console.log(`OBS   ${nome} — ${obs}`) }
export function salvar(arq) { fs.writeFileSync(arq, JSON.stringify(R, null, 1)) }
export async function abrir(opts = {}) {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', ...opts })
  const page = await ctx.newPage()
  const erros = []
  page.on('pageerror', (e) => erros.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) erros.push('console: ' + m.text()) })
  return { b, ctx, page, erros }
}
export const shot = (page, nome) => page.screenshot({ path: `/tmp/claude-0/e2e/shots/${nome}.png`, fullPage: true })
/** Último e-mail recebido para o endereço */
export function ultimoEmail(para) {
  const dir = '/tmp/claude-0/e2e/mails'
  const fs2 = fs.readdirSync(dir).sort().reverse()
  for (const f of fs2) { const t = fs.readFileSync(`${dir}/${f}`, 'utf8'); if (t.includes(para)) return t.replace(/=\r?\n/g, '').replace(/=3D/g, '=').replace(/&amp;/g, '&') }
  return null
}
export const espera = (ms) => new Promise((r) => setTimeout(r, ms))
export async function toastOuErro(page) {
  await espera(600)
  const alert = await page.locator('[role=alert]').allInnerTexts().catch(() => [])
  return alert.join(' | ')
}
import { execSync } from 'node:child_process'
export const SQL = (q) => execSync(`psql -h /var/tmp/pgtest -p 54329 -U postgres -d e2e -Atq -c 'set session_replication_role=replica' -c ${JSON.stringify(q)}`).toString().trim()
const KEYS = Object.fromEntries(fs.readFileSync('/tmp/claude-0/e2e/env.sh', 'utf8').split('\n').filter(Boolean).map((l) => l.replace('export ', '').split('=')).map(([k, ...v]) => [k, v.join('=').replace(/'/g, '')]))
export async function novoUsuario(email, senha = 'Senha@123', nome = 'Teste') {
  const r = await fetch('http://localhost:54321/auth/v1/admin/users', { method: 'POST', headers: { Authorization: `Bearer ${KEYS.SERVICE_KEY}`, apikey: KEYS.SERVICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha, email_confirm: true, user_metadata: { nome, termos_versao: '2026-10-28' } }) })
  return r.json()
}
export async function entrar(page, email, senha = 'Senha@123') {
  await page.goto(APP + '/entrar')
  await page.getByLabel('E-mail').fill(email); await page.getByLabel('Senha').fill(senha)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForFunction(() => !document.body.innerText.includes('Esqueci minha senha'), null, { timeout: 15000 })
}
/** Clica num botão/link pelo texto e espera um tempinho */
export async function clicar(page, nome, opts = {}) { await page.getByRole(opts.role ?? 'button', { name: nome, exact: opts.exact }).first().click(); await espera(opts.ms ?? 500) }
export const dialog = (page) => page.getByRole('dialog')
export async function textoErro(scope) { await espera(700); return (await scope.locator('[role=alert]').allInnerTexts().catch(() => [])).join(' | ') }
export async function toast(page) { await espera(400); return (await page.locator('[aria-live=polite]').innerText().catch(() => '')).trim() }
export const KEYS_ = KEYS
/** Escolhe a opção de um select cujo texto casa com a expressão */
export async function escolher(sel, re) {
  const opts = await sel.locator('option').evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent })))
  const o = opts.find((x) => re.test(x.t)); if (!o) throw new Error('opção não encontrada: ' + re + ' em ' + opts.map((x) => x.t).join(' | '))
  await sel.selectOption(o.v)
}
