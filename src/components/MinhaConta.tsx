import { useEffect, useState } from 'react'
import { supabase, erroMsg } from '../lib/supabase'
import { PAPEL, useAuth } from '../lib/auth'
import { Button, ErrorBox, Field, Input, Modal, useToast } from './ui'

/** Dados da própria conta e troca de senha sem precisar sair do sistema. */
export default function MinhaConta({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, nome, papel, empresa } = useAuth()
  const toast = useToast()
  const [senha, setSenha] = useState('')
  const [confirma, setConfirma] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => { if (open) { setSenha(''); setConfirma(''); setErro(null) } }, [open])

  async function salvar() {
    setErro(null)
    if (senha.length < 6) return setErro('A senha precisa ter pelo menos 6 caracteres.')
    if (senha !== confirma) return setErro('As duas senhas não são iguais.')
    const { error } = await supabase.auth.updateUser({ password: senha })
    if (error) return setErro(error.message.includes('different from the old') ? 'A nova senha precisa ser diferente da atual.' : erroMsg(error))
    toast('Senha alterada.'); onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Minha conta"
      footer={<><Button onClick={onClose}>Fechar</Button><Button variant="primary" onClick={salvar}>Trocar senha</Button></>}>
      <dl className="mb-5 grid grid-cols-[90px_1fr] gap-y-1.5 text-sm">
        <dt className="text-muted">Nome</dt><dd>{nome || '–'}</dd>
        <dt className="text-muted">E-mail</dt><dd className="break-all">{session?.user.email}</dd>
        <dt className="text-muted">Empresa</dt><dd>{empresa?.nome}</dd>
        <dt className="text-muted">Acesso</dt><dd>{papel ? PAPEL[papel].nome : '–'}</dd>
      </dl>
      <p className="mb-3 text-sm font-medium">Trocar senha</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nova senha" hint="Mínimo de 6 caracteres."><Input type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} /></Field>
        <Field label="Repita a nova senha"><Input type="password" autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)} /></Field>
      </div>
      <div className="mt-3"><ErrorBox msg={erro} /></div>
    </Modal>
  )
}
