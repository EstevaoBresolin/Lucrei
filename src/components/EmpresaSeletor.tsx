import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { PAPEL, useAuth } from '../lib/auth'

/** Nome da empresa atual. Quem participa de mais de uma empresa (por convite) troca entre elas aqui. */
export default function EmpresaSeletor({ compacto }: { compacto?: boolean }) {
  const { empresa, empresas, papel, trocarEmpresa } = useAuth()
  const [aberto, setAberto] = useState(false)
  if (!empresa) return null
  const varias = empresas.length > 1

  const conteudo = (
    <span className="min-w-0">
      <span className="block truncate text-sm font-semibold text-ink">{empresa.nome}</span>
      {!compacto && papel && <span className="block text-xs text-muted">{PAPEL[papel].nome}</span>}
    </span>
  )

  if (!varias) {
    return (
      <div className={compacto ? 'max-w-[55vw] truncate px-2 py-1' : 'px-3 pt-3 pb-3'}>
        <div className={compacto ? '' : 'rounded-box border border-line px-3 py-2'}>{conteudo}</div>
      </div>
    )
  }

  return (
    <div className={compacto ? 'relative' : 'relative px-3 pt-3 pb-3'}>
      <button onClick={() => setAberto(!aberto)}
        className={compacto
          ? 'flex max-w-[55vw] items-center gap-1 truncate rounded-box px-2 py-1 text-sm text-muted hover:bg-line/40'
          : 'flex w-full items-center justify-between gap-2 rounded-box border border-line px-3 py-2 text-left hover:border-muted'}>
        {conteudo}
        <ChevronsUpDown size={15} className="shrink-0 text-muted" />
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAberto(false)} />
          <div className={`absolute z-50 mt-1 w-64 rounded-box border border-line bg-panel p-1 shadow-xl ${compacto ? 'right-0' : 'left-3'}`}>
            {empresas.map((v) => (
              <button key={v.empresa.id} onClick={() => { setAberto(false); if (v.empresa.id !== empresa.id) trocarEmpresa(v.empresa.id) }}
                className="flex w-full items-center justify-between gap-2 rounded-box px-3 py-2 text-left text-sm hover:bg-line/40">
                <span className="min-w-0"><span className="block truncate font-medium">{v.empresa.nome}</span><span className="text-xs text-muted">{PAPEL[v.papel].nome}</span></span>
                {v.empresa.id === empresa.id && <Check size={15} className="text-ledink" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
