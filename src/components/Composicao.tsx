import { money, percent } from '../lib/fmt'

type Parte = { label: string; valor: number; cor: string }

/** Barra horizontal: para onde vai cada real da venda. */
export default function Composicao({ receita, custo, taxas, frete, imposto, outros }: { receita: number; custo: number; taxas: number; frete: number; imposto: number; outros: number }) {
  const lucro = receita - custo - taxas - frete - imposto - outros
  const partes: Parte[] = [
    { label: 'Custo do produto', valor: custo, cor: 'rgb(var(--muted))' },
    { label: 'Taxa do canal', valor: taxas, cor: 'rgb(var(--ink) / .75)' },
    { label: 'Frete', valor: frete, cor: 'rgb(var(--muted) / .55)' },
    { label: 'Imposto', valor: imposto, cor: 'rgb(var(--ink) / .45)' },
    { label: 'Outros', valor: outros, cor: 'rgb(var(--line))' },
  ].filter((p) => p.valor > 0)
  const total = Math.max(receita, partes.reduce((s, p) => s + p.valor, 0) + Math.max(lucro, 0), 0.01)
  const prejuizo = lucro < 0

  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded-sm bg-line/50" role="img" aria-label={`Lucro de ${money(lucro)} sobre ${money(receita)}`}>
        {partes.map((p) => <div key={p.label} style={{ width: `${(p.valor / total) * 100}%`, background: p.cor }} title={`${p.label}: ${money(p.valor)}`} />)}
        {!prejuizo && <div style={{ width: `${(lucro / total) * 100}%`, background: 'rgb(var(--led))', boxShadow: '0 0 10px rgb(var(--led) / .7)' }} title={`Lucro: ${money(lucro)}`} />}
      </div>
      <ul className="mt-3 flex flex-col gap-1.5 text-sm">
        {partes.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.cor }} />
            <span className="text-muted">{p.label}</span>
            <span className="num ml-auto">{receita > 0 ? percent(p.valor / receita) : '–'}</span>
          </li>
        ))}
        <li className="flex items-center gap-2 font-semibold">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: prejuizo ? 'rgb(var(--bad))' : 'rgb(var(--led))' }} />
          <span>{prejuizo ? 'Prejuízo' : 'Lucro'}</span>
          <span className={`num ml-auto ${prejuizo ? 'text-bad' : ''}`}>{receita > 0 ? percent(lucro / receita) : '–'}</span>
        </li>
      </ul>
    </div>
  )
}
