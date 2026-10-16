/** Gera e baixa um CSV compatível com Excel em português (separador ;). */
export function baixarCSV(nome: string, cab: string[], linhas: unknown[][]) {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const txt = '﻿' + [cab, ...linhas].map((l) => l.map(esc).join(';')).join('\n')
  const url = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = nome; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
