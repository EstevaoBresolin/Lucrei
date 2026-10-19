const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const n2 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })
const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 })

export const money = (v: number | string | null | undefined) => brl.format(Number(v ?? 0))
export const qty = (v: number | string | null | undefined) => n2.format(Number(v ?? 0))
export const percent = (v: number | string | null | undefined) => pct.format(Number(v ?? 0))
export const num = (v: unknown) => {
  if (typeof v === 'number') return v
  const s = String(v ?? '').trim().replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}
/** Aceita "12,5" ou "12.5". */
export const parseNum = (s: string) => {
  const t = s.trim()
  if (t === '') return 0
  // Formato brasileiro: vírgula é decimal e ponto é milhar ("1.234,56"). Sem vírgula, "1.000" também é mil.
  const br = t.includes(',') || /^-?\d{1,3}(\.\d{3})+$/.test(t)
  const n = Number(br ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : 0
}
export const hoje = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
export const somaDias = (iso: string, dias: number) => {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}
export const dataBR = (iso?: string | null) => {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
export const dataHoraBR = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''

/** Nome para comparar duplicados: ignora maiúsculas, acentos e espaços extras. */
export const normNome = (s: string) => s.trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/* ---------- Máscaras ---------- */
const soDigitos = (s: string) => s.replace(/\D/g, '')
/** CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00), conforme a quantidade de dígitos. */
export function mascaraDoc(v: string) {
  const d = soDigitos(v).slice(0, 14)
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2')
}
/** Telefone/WhatsApp com DDD: (54) 99999-9999 ou (54) 3222-1111. Aceita +55 na frente. */
export function mascaraTel(v: string) {
  let d = soDigitos(v)
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  d = d.slice(0, 11)
  if (d.length <= 2) return d ? `(${d}` : ''
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}
/** Valida CPF ou CNPJ pelos dígitos verificadores. */
export function docValido(v: string) {
  const d = soDigitos(v)
  if (/^(\d)\1+$/.test(d)) return false
  if (d.length === 11) {
    const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r }
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
  }
  if (d.length === 14) {
    const dv = (n: number) => { const p = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = p.reduce((a, x, i) => a + x * Number(d[i]), 0); const r = s % 11; return r < 2 ? 0 : 11 - r }
    return dv(12) === Number(d[12]) && dv(13) === Number(d[13])
  }
  return false
}
export const telValido = (v: string) => { const d = soDigitos(v); return d.length === 10 || d.length === 11 }
export const emailValido = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())
