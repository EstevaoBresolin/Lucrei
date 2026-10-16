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
