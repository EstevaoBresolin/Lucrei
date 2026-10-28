import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Papel = 'dono' | 'operador' | 'leitura'
export type Modulo = 'compras' | 'financas' | 'mercado_livre' | 'clientes' | 'fornecedores' | 'kits' | 'producao'
export type TipoNegocio = 'revenda' | 'fabricacao' | 'misto'
export type Empresa = {
  id: string; nome: string; tipo_negocio: TipoNegocio; modulos: Partial<Record<Modulo, boolean>>
  imposto_perc: number; email_avisos: string | null; status: string; plano: string
}
type Vinculo = { papel: Papel; empresa: Empresa }

/** Situação da assinatura da empresa atual (função minha_assinatura no banco). */
export type Assinatura = {
  status: string; situacao: 'teste' | 'ativa' | 'atrasada' | 'cancelada' | 'bloqueada' | 'cortesia'; liberada: boolean
  plano: string; plano_nome: string | null; preco: number | null; limite_vendas: number | null
  teste_ate: string | null; dias_teste: number; pago_ate: string | null; assinada: boolean
  cobranca_url: string | null; cobranca_vencimento: string | null; documento: string | null; vendas_mes: number
}

/** Versão dos termos de uso e da política de privacidade. Mudou o texto? Aumente aqui: todos aceitam de novo. */
export const TERMOS_VERSAO = '2026-10-28'

type Ctx = {
  session: Session | null; carregando: boolean; nome: string
  /** Empresas das quais o usuário participa */
  empresas: Vinculo[]
  empresa: Empresa | null; papel: Papel | null
  /** Dono (vê finanças, configurações e assinatura, mesmo com a empresa bloqueada) */
  ehDono: boolean
  /** Dono com a empresa liberada: altera finanças, configurações, usuários e exclui */
  isAdmin: boolean
  assinatura: Assinatura | null
  /** Teste acabou ou assinatura não paga: vê tudo, não lança nada */
  bloqueada: boolean
  recarregarAssinatura: () => Promise<void>
  /** Dono ou operador: lançar e alterar */
  podeEditar: boolean
  modulo: (m: Modulo) => boolean
  termosOk: boolean
  recarregar: () => Promise<void>
  trocarEmpresa: (id: string) => Promise<void>
  /** true quando o usuário chegou pelo link de "esqueci minha senha" e precisa definir uma nova. */
  recuperando: boolean; fimRecuperacao: () => void
}
const AuthCtx = createContext<Ctx>({
  session: null, carregando: true, nome: '', empresas: [], empresa: null, papel: null, ehDono: false, isAdmin: false, podeEditar: false,
  assinatura: null, bloqueada: false, recarregarAssinatura: async () => {},
  modulo: () => false, termosOk: false, recarregar: async () => {}, trocarEmpresa: async () => {}, recuperando: false, fimRecuperacao: () => {},
})

/** Endereço público do sistema, usado nos links enviados por e-mail e nos convites. */
export const URL_APP = (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, '') || window.location.origin

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [nome, setNome] = useState('')
  const [empresas, setEmpresas] = useState<Vinculo[]>([])
  const [atual, setAtual] = useState<string | null>(null)
  const [termos, setTermos] = useState<string | null>(null)
  const [assinatura, setAssinatura] = useState<Assinatura | null>(null)
  const [recuperando, setRecuperando] = useState(() => /type=recovery/.test(window.location.hash))

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setCarregando(false) })
    const { data } = supabase.auth.onAuthStateChange((evento, s) => {
      if (evento === 'PASSWORD_RECOVERY') setRecuperando(true)
      setSession(s)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null
  const carregar = useCallback(async () => {
    if (!userId) return
    const [u, m] = await Promise.all([
      supabase.from('usuario').select('nome, empresa_atual, termos_versao').eq('id', userId).maybeSingle(),
      supabase.from('membro').select('papel, empresa:empresa_id(id, nome, tipo_negocio, modulos, imposto_perc, email_avisos, status, plano)').eq('user_id', userId),
    ])
    const lista = ((m.data ?? []) as unknown as Vinculo[]).filter((v) => v.empresa).sort((a, b) => a.empresa.nome.localeCompare(b.empresa.nome))
    setNome(u.data?.nome ?? '')
    setTermos(u.data?.termos_versao ?? null)
    setEmpresas(lista)
    let escolhida = u.data?.empresa_atual ?? null
    if (lista.length && !lista.some((v) => v.empresa.id === escolhida)) {
      // Empresa salva não existe mais (ou nunca foi escolhida): usa a primeira da lista
      escolhida = lista[0].empresa.id
      await supabase.rpc('trocar_empresa', { p_empresa: escolhida })
    }
    setAtual(lista.length ? escolhida : null)
    if (lista.length) setAssinatura((await supabase.rpc('minha_assinatura')).data as Assinatura | null)
  }, [userId])

  const recarregarAssinatura = useCallback(async () => {
    setAssinatura((await supabase.rpc('minha_assinatura')).data as Assinatura | null)
  }, [])

  // Ao voltar para a aba o Supabase renova o token e entrega um objeto de sessão novo.
  // Só recarregamos quando o usuário muda; senão a tela inteira era desmontada e modais perdiam o que foi digitado.
  useEffect(() => {
    if (!userId) { setEmpresas([]); setAtual(null); return }
    setCarregando(true)
    carregar().finally(() => setCarregando(false))
  }, [userId, carregar])

  const trocarEmpresa = async (id: string) => {
    const { error } = await supabase.rpc('trocar_empresa', { p_empresa: id })
    if (error) throw error
    // Recarrega a página inteira: nenhum dado da empresa anterior fica na tela
    window.location.assign('/')
  }

  const fimRecuperacao = () => {
    setRecuperando(false)
    if (window.location.hash) history.replaceState(null, '', window.location.pathname)
  }

  const vinc = empresas.find((v) => v.empresa.id === atual) ?? null
  const papel = vinc?.papel ?? null
  const empresa = vinc?.empresa ?? null
  const modulo = (m: Modulo) => !!empresa?.modulos?.[m]
  const bloqueada = !!assinatura && !assinatura.liberada

  return (
    <AuthCtx.Provider value={{
      session, carregando, nome, empresas, empresa, papel,
      ehDono: papel === 'dono', isAdmin: papel === 'dono' && !bloqueada, podeEditar: (papel === 'dono' || papel === 'operador') && !bloqueada,
      assinatura, bloqueada, recarregarAssinatura,
      modulo, termosOk: termos === TERMOS_VERSAO, recarregar: carregar, trocarEmpresa, recuperando, fimRecuperacao,
    }}>
      {children}
    </AuthCtx.Provider>
  )
}
export const useAuth = () => useContext(AuthCtx)

export const PAPEL: Record<Papel, { nome: string; descricao: string }> = {
  dono: { nome: 'Dono', descricao: 'Tudo, inclusive finanças, configurações e usuários' },
  operador: { nome: 'Operador', descricao: 'Lança vendas, compras, estoque e produção' },
  leitura: { nome: 'Só leitura', descricao: 'Vê tudo, mas não altera nada' },
}
