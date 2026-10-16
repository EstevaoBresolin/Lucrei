import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Field, Select } from './ui'

export type Conta = { id: string; nome: string; padrao: boolean; recebe_ml: boolean; ativo: boolean }

/** Contas de dinheiro ativas (Mercado Pago, banco…). */
export function useContas() {
  const [contas, setContas] = useState<Conta[]>([])
  useEffect(() => {
    supabase.from('conta_financeira').select('id,nome,padrao,recebe_ml,ativo').eq('ativo', true).order('nome').then(({ data }) => setContas((data ?? []) as Conta[]))
  }, [])
  return contas
}

/**
 * Campo "De qual conta saiu / em qual conta entrou". Com uma conta só, não aparece:
 * tudo vai para a conta padrão automaticamente.
 */
export function CampoConta({ value, onChange, label = 'Conta', className }: { value: string; onChange: (v: string) => void; label?: string; className?: string }) {
  const contas = useContas()
  if (contas.length <= 1) return null
  const padrao = contas.find((c) => c.padrao)
  return (
    <Field label={label} className={className}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{padrao ? `${padrao.nome} (padrão)` : 'Conta padrão'}</option>
        {contas.filter((c) => !c.padrao).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
      </Select>
    </Field>
  )
}
