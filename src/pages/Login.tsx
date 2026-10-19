import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { supabase, erroMsg } from '../lib/supabase'
import { TERMOS_VERSAO, URL_APP, useAuth } from '../lib/auth'
import { guardarConvite } from './Onboarding'
import { Button, ErrorBox, Field, Input } from '../components/ui'

type Modo = 'entrar' | 'criar' | 'esqueci'

export function Moldura({ children, sub, largo }: { children: ReactNode; sub: string; largo?: boolean }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className={`w-full ${largo ? 'max-w-2xl' : 'max-w-sm'} py-10`}>
        <div className="mb-8">
          <a href="/" className="led-strip inline-flex items-center gap-3 pb-2">
            <img src="/icon.svg" alt="" className="h-10 w-10" />
            <span className="wide text-2xl font-bold tracking-tight">Lucrei</span>
          </a>
          <p className="mt-4 text-sm text-muted">{sub}</p>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function Login({ convite, inicio }: { convite?: string | null; inicio?: Modo }) {
  const [modo, setModo] = useState<Modo>(convite ? 'criar' : inicio ?? 'entrar')
  const [aceito, setAceito] = useState(false)
  // Convite aberto sem login: guarda para aceitar logo depois de entrar
  useEffect(() => { if (convite) guardarConvite(convite) }, [convite])
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [naoConfirmado, setNaoConfirmado] = useState(false)

  // Link de e-mail vencido ou já usado volta com o erro no endereço: mostra em português.
  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1))
    if (h.get('error')) {
      setErro(h.get('error_code') === 'otp_expired' ? 'Esse link venceu ou já foi usado. Peça outro abaixo.' : (h.get('error_description') ?? 'Link inválido.').replace(/\+/g, ' '))
      history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  const trocar = (m: Modo) => { setModo(m); setErro(null); setAviso(null) }

  async function enviar(e: FormEvent) {
    e.preventDefault(); setErro(null); setAviso(null); setNaoConfirmado(false); setEnviando(true)
    if (modo === 'entrar') {
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
      if (error?.message === 'Email not confirmed') { setErro('Seu e-mail ainda não foi confirmado. Abra o link que enviamos ou peça um novo abaixo.'); setNaoConfirmado(true) }
      else if (error) setErro(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : erroMsg(error))
    } else if (modo === 'criar') {
      if (!aceito) { setEnviando(false); return setErro('Para criar a conta, aceite os Termos de uso e a Política de privacidade.') }
      const { data, error } = await supabase.auth.signUp({ email, password: senha, options: { data: { nome, termos_versao: TERMOS_VERSAO }, emailRedirectTo: `${URL_APP}/` } })
      if (error) setErro(error.message.includes('already registered') ? 'Este e-mail já tem conta. Use "Voltar para entrar" ou "Esqueci minha senha".' : erroMsg(error))
      // Com e-mail já cadastrado o Supabase responde "ok" sem identidades, por segurança.
      else if (data.user && data.user.identities?.length === 0) setErro('Este e-mail já tem conta. Use "Voltar para entrar" ou "Esqueci minha senha".')
      else if (!data.session) setAviso('Conta criada. Confirme pelo link enviado ao seu e-mail e depois entre.')
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${URL_APP}/` })
      if (error) setErro(erroMsg(error))
      else setAviso('Se este e-mail tiver conta, enviamos um link para criar uma nova senha. Confira também o spam.')
    }
    setEnviando(false)
  }

  async function reenviarConfirmacao() {
    setErro(null)
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${URL_APP}/` } })
    if (error) return setErro(erroMsg(error))
    setNaoConfirmado(false); setAviso('Enviamos um novo link de confirmação. Confira também o spam.')
  }

  const sub = modo === 'esqueci' ? 'Informe seu e-mail e enviaremos um link para criar uma nova senha.'
    : modo === 'criar' && !convite ? 'Crie sua conta e use tudo por 30 dias grátis, sem cartão de crédito.'
    : convite ? 'Você recebeu um convite. Crie sua conta (ou entre, se já tiver uma) para participar da empresa.'
    : 'Saiba quanto você lucra de verdade em cada venda: estoque, custos, taxas e caixa em um lugar só.'
  return (
    <Moldura sub={sub}>
      <form onSubmit={enviar} className="flex flex-col gap-4 rounded-box border border-line bg-panel p-5">
        {modo === 'criar' && <Field label="Seu nome"><Input value={nome} onChange={(e) => setNome(e.target.value)} required /></Field>}
        <Field label="E-mail"><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        {modo !== 'esqueci' && (
          <Field label="Senha" hint={modo === 'criar' ? 'Mínimo de 6 caracteres.' : undefined}>
            <Input type="password" autoComplete={modo === 'criar' ? 'new-password' : 'current-password'} value={senha} onChange={(e) => setSenha(e.target.value)} required minLength={6} />
          </Field>
        )}
        {modo === 'criar' && (
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={aceito} onChange={(e) => setAceito(e.target.checked)} />
            <span>Li e aceito os <a href="/termos" target="_blank" className="underline">Termos de uso</a> e a <a href="/privacidade" target="_blank" className="underline">Política de privacidade</a>.</span></label>
        )}
        {modo === 'entrar' && (
          <button type="button" className="-mt-2 self-end text-sm text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => trocar('esqueci')}>Esqueci minha senha</button>
        )}
        <ErrorBox msg={erro} />
        {naoConfirmado && <Button type="button" size="sm" onClick={reenviarConfirmacao}>Reenviar e-mail de confirmação</Button>}
        {aviso && <p className="rounded-box bg-good/10 px-3 py-2 text-sm text-good">{aviso}</p>}
        <Button type="submit" variant="primary" disabled={enviando}>{enviando ? 'Aguarde…' : modo === 'entrar' ? 'Entrar' : modo === 'criar' ? 'Criar conta' : 'Enviar link'}</Button>
      </form>
      <button className="mt-4 text-sm text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => trocar(modo === 'criar' ? 'entrar' : modo === 'esqueci' ? 'entrar' : 'criar')}>
        {modo === 'entrar' ? 'Primeiro acesso? Criar conta grátis' : modo === 'criar' ? 'Já tenho conta: entrar' : 'Voltar para entrar'}
      </button>
      <p className="mt-6 text-xs text-muted"><a href="/termos" className="hover:underline">Termos de uso</a> · <a href="/privacidade" className="hover:underline">Privacidade</a></p>
    </Moldura>
  )
}

/** Tela mostrada quando o usuário abre o link de redefinição de senha do e-mail. */
export function NovaSenha() {
  const { fimRecuperacao } = useAuth()
  const [senha, setSenha] = useState('')
  const [confirma, setConfirma] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function salvar(e: FormEvent) {
    e.preventDefault(); setErro(null)
    if (senha.length < 6) return setErro('A senha precisa ter pelo menos 6 caracteres.')
    if (senha !== confirma) return setErro('As duas senhas não são iguais.')
    setEnviando(true)
    const { error } = await supabase.auth.updateUser({ password: senha })
    setEnviando(false)
    if (error) return setErro(error.message.includes('different from the old') ? 'A nova senha precisa ser diferente da anterior.' : erroMsg(error))
    fimRecuperacao()
  }

  return (
    <Moldura sub="Crie uma nova senha para sua conta.">
      <form onSubmit={salvar} className="flex flex-col gap-4 rounded-box border border-line bg-panel p-5">
        <Field label="Nova senha" hint="Mínimo de 6 caracteres."><Input type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} required minLength={6} /></Field>
        <Field label="Repita a nova senha"><Input type="password" autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)} required minLength={6} /></Field>
        <ErrorBox msg={erro} />
        <Button variant="primary" disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar nova senha'}</Button>
      </form>
    </Moldura>
  )
}
