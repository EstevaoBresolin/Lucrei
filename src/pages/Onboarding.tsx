import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Factory, Layers, ShoppingBag } from 'lucide-react'
import { supabase, erroMsg } from '../lib/supabase'
import { PAPEL, TERMOS_VERSAO, useAuth, type Papel, type TipoNegocio } from '../lib/auth'
import { Button, ErrorBox, Field, Input } from '../components/ui'
import { Moldura } from './Login'

const CHAVE_CONVITE = 'lucrei_convite'
export function conviteGuardado(): string | null {
  try { return localStorage.getItem(CHAVE_CONVITE) } catch { return null }
}
export function guardarConvite(token: string | null) {
  try { if (token) localStorage.setItem(CHAVE_CONVITE, token); else localStorage.removeItem(CHAVE_CONVITE) } catch { /* sem armazenamento */ }
}

const sair = () => supabase.auth.signOut()

/** Aceite dos termos (primeiro acesso ou quando a versão muda). */
export function AceitarTermos() {
  const { recarregar } = useAuth()
  const [ok, setOk] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  async function aceitar() {
    const { error } = await supabase.rpc('aceitar_termos', { p_versao: TERMOS_VERSAO })
    if (error) return setErro(erroMsg(error))
    await recarregar()
  }
  return (
    <Moldura sub="Antes de continuar, leia e aceite as regras de uso do Lucrei.">
      <div className="flex flex-col gap-4 rounded-box border border-line bg-panel p-5 text-sm">
        <p>Para usar o Lucrei você precisa concordar com os <Link to="/termos" target="_blank" className="font-medium underline">Termos de uso</Link> e
          com a <Link to="/privacidade" target="_blank" className="font-medium underline">Política de privacidade</Link>, que explicam como seus dados são guardados e usados.</p>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={ok} onChange={(e) => setOk(e.target.checked)} /> Li e concordo com os Termos de uso e a Política de privacidade.</label>
        <ErrorBox msg={erro} />
        <Button variant="primary" disabled={!ok} onClick={aceitar}>Continuar</Button>
      </div>
      <button className="mt-4 text-sm text-muted underline-offset-4 hover:text-ink hover:underline" onClick={sair}>Sair</button>
    </Moldura>
  )
}

const TIPOS: { id: TipoNegocio; titulo: string; texto: string; icone: typeof ShoppingBag }[] = [
  { id: 'revenda', titulo: 'Compro pronto e revendo', texto: 'Celular, roupa, acessórios… O custo vem do que você paga ao fornecedor.', icone: ShoppingBag },
  { id: 'fabricacao', titulo: 'Fabrico o que vendo', texto: 'Móveis, artesanato, peças… O custo vem dos insumos usados em cada unidade.', icone: Factory },
  { id: 'misto', titulo: 'Os dois', texto: 'Tenho produtos que fabrico e outros que compro prontos.', icone: Layers },
]

/** Primeiro acesso sem empresa: cria a empresa e define o tipo de negócio. */
export function CriarEmpresa() {
  const { recarregar } = useAuth()
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<TipoNegocio | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  async function criar() {
    if (!nome.trim()) return setErro('Dê um nome à sua loja ou empresa.')
    if (!tipo) return setErro('Escolha como você trabalha.')
    const { error } = await supabase.rpc('criar_empresa', { p_nome: nome.trim(), p_tipo: tipo })
    if (error) return setErro(erroMsg(error))
    await recarregar()
  }
  return (
    <Moldura sub="Vamos montar o Lucrei do jeito que sua loja funciona." largo>
      <div className="flex flex-col gap-5 rounded-box border border-line bg-panel p-5">
        <Field label="Nome da loja ou empresa"><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Minha Loja" /></Field>
        <div>
          <p className="mb-2 text-sm font-medium">Como você trabalha?</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {TIPOS.map((t) => (
              <button key={t.id} type="button" onClick={() => setTipo(t.id)}
                className={`flex flex-col gap-1.5 rounded-box border p-3 text-left text-sm transition-colors ${tipo === t.id ? 'border-led bg-led/10' : 'border-line hover:border-muted'}`}>
                <t.icone size={20} className={tipo === t.id ? 'text-ledink' : 'text-muted'} />
                <span className="font-semibold">{t.titulo}</span>
                <span className="text-xs text-muted">{t.texto}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Isso só define o que aparece no menu. Dá para mudar depois em Configurações → Empresa.</p>
        </div>
        <ErrorBox msg={erro} />
        <Button variant="primary" onClick={criar}>Criar minha empresa</Button>
      </div>
      <p className="mt-4 text-sm text-muted">Foi convidado para a empresa de outra pessoa? Abra o link de convite que ela enviou. · <button className="underline-offset-4 hover:text-ink hover:underline" onClick={sair}>Sair</button></p>
    </Moldura>
  )
}

/** Link de convite: mostra a empresa e o papel e entra nela. */
export function Convite({ token }: { token: string }) {
  const [info, setInfo] = useState<{ empresa: string; papel: Papel; valido: boolean } | null | undefined>(undefined)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    supabase.rpc('ver_convite', { p_token: token }).then(({ data }) => setInfo(data ?? null))
  }, [token])

  async function entrar() {
    const { error } = await supabase.rpc('aceitar_convite', { p_token: token })
    if (error) return setErro(erroMsg(error))
    guardarConvite(null)
    window.location.assign('/')
  }
  const descartar = () => { guardarConvite(null); window.location.assign('/') }

  return (
    <Moldura sub="Convite para participar de uma empresa no Lucrei.">
      <div className="flex flex-col gap-4 rounded-box border border-line bg-panel p-5 text-sm">
        {info === undefined ? <p className="text-muted">Carregando convite…</p>
          : !info || !info.valido ? (
            <>
              <p>Este convite não vale mais: ele já foi usado, venceu ou o endereço está incompleto. Peça um novo link ao dono da empresa.</p>
              <Button onClick={descartar}>Continuar</Button>
            </>
          ) : (
            <>
              <p>Você foi convidado para <b>{info.empresa}</b> como <b>{PAPEL[info.papel].nome}</b>: {PAPEL[info.papel].descricao.toLowerCase()}.</p>
              <ErrorBox msg={erro} />
              <Button variant="primary" onClick={entrar}>Entrar na empresa</Button>
              <button className="text-muted underline-offset-4 hover:text-ink hover:underline" onClick={descartar}>Agora não</button>
            </>
          )}
      </div>
    </Moldura>
  )
}
