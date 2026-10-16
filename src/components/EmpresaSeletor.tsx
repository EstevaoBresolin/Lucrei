import { useState } from 'react'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { supabase, erroMsg } from '../lib/supabase'
import { PAPEL, useAuth, type TipoNegocio } from '../lib/auth'
import { Button, ErrorBox, Field, Input, Modal, Select } from './ui'

/** Nome da empresa atual; com mais de uma, troca entre elas. Também cria outra empresa. */
export default function EmpresaSeletor({ compacto }: { compacto?: boolean }) {
  const { empresa, empresas, papel, trocarEmpresa } = useAuth()
  const [aberto, setAberto] = useState(false)
  const [nova, setNova] = useState(false)
  if (!empresa) return null

  return (
    <div className={compacto ? 'relative' : 'relative px-3 pt-3 pb-3'}>
      <button onClick={() => setAberto(!aberto)}
        className={compacto
          ? 'flex max-w-[55vw] items-center gap-1 truncate rounded-box px-2 py-1 text-sm text-muted hover:bg-line/40'
          : 'flex w-full items-center justify-between gap-2 rounded-box border border-line px-3 py-2 text-left hover:border-muted'}>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink">{empresa.nome}</span>
          {!compacto && papel && <span className="block text-xs text-muted">{PAPEL[papel].nome}</span>}
        </span>
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
            <button onClick={() => { setAberto(false); setNova(true) }} className="flex w-full items-center gap-2 rounded-box border-t border-line px-3 py-2 text-left text-sm text-muted hover:bg-line/40 hover:text-ink">
              <Plus size={15} /> Criar outra empresa
            </button>
          </div>
        </>
      )}
      {nova && <NovaEmpresa onClose={() => setNova(false)} />}
    </div>
  )
}

function NovaEmpresa({ onClose }: { onClose: () => void }) {
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<TipoNegocio>('revenda')
  const [erro, setErro] = useState<string | null>(null)
  async function criar() {
    if (!nome.trim()) return setErro('Dê um nome à empresa.')
    const { error } = await supabase.rpc('criar_empresa', { p_nome: nome.trim(), p_tipo: tipo })
    if (error) return setErro(erroMsg(error))
    window.location.assign('/')
  }
  return (
    <Modal open onClose={onClose} title="Criar outra empresa"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={criar}>Criar</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Nome"><Input value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <Field label="Como ela trabalha?">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value as TipoNegocio)}>
            <option value="revenda">Compra pronto e revende</option>
            <option value="fabricacao">Fabrica o que vende</option>
            <option value="misto">Os dois</option>
          </Select>
        </Field>
        <p className="text-xs text-muted">Os dados de cada empresa ficam totalmente separados. Você troca de empresa pelo nome dela no menu.</p>
        <ErrorBox msg={erro} />
      </div>
    </Modal>
  )
}
