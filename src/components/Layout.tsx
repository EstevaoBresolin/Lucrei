import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LayoutDashboard, ShoppingCart, Boxes, Package, Hammer, Truck, Settings, LogOut, Plus, Wallet, Users, MoreHorizontal, Layers, UserCircle, Landmark } from 'lucide-react'
import MinhaConta from './MinhaConta'
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, type Modulo } from '../lib/auth'
import EmpresaSeletor from './EmpresaSeletor'

type Item = { to: string; label: string; icon: typeof Boxes; end?: boolean; admin?: boolean; modulo?: Modulo | Modulo[] }
const nav: Item[] = [
  { to: '/', label: 'Painel', icon: LayoutDashboard, end: true },
  { to: '/vendas', label: 'Vendas', icon: ShoppingCart },
  { to: '/estoque', label: 'Estoque', icon: Boxes },
  { to: '/produtos', label: 'Produtos', icon: Package },
  { to: '/producao', label: 'Produção', icon: Hammer, modulo: 'producao' },
  { to: '/insumos', label: 'Insumos', icon: Layers, modulo: 'producao' },
  { to: '/compras', label: 'Compras', icon: Truck, modulo: 'compras' },
  { to: '/cadastros', label: 'Clientes e fornecedores', icon: Users, modulo: ['clientes', 'fornecedores'] },
  { to: '/financas', label: 'Finanças', icon: Landmark, admin: true, modulo: 'financas' },
  { to: '/financeiro', label: 'Despesas', icon: Wallet, admin: true, modulo: 'financas' },
  { to: '/config', label: 'Configurações', icon: Settings, admin: true },
]

export default function Layout() {
  const { nome, isAdmin, podeEditar, modulo } = useAuth()
  const navigate = useNavigate()
  const [mais, setMais] = useState(false)
  const [conta, setConta] = useState(false)
  const itens = nav.filter((n) => (!n.admin || isAdmin) && (!n.modulo || [n.modulo].flat().some(modulo)))

  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      {/* Barra lateral */}
      <aside className="hidden border-r border-line bg-panel md:flex md:flex-col">
        <div className="led-strip flex h-14 items-center gap-2.5 border-b border-line px-5">
          <img src="/icon.svg" alt="" className="h-7 w-7" />
          <span className="wide font-bold tracking-tight">Lucrei</span>
        </div>
        <EmpresaSeletor />
        <div className="p-3 pt-0">
          {podeEditar && <button onClick={() => navigate('/vendas/nova')} className="flex h-10 w-full items-center justify-center gap-2 rounded-box bg-ink font-medium text-base hover:bg-ink/90">
            <Plus size={18} /> Nova venda
          </button>}
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {itens.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => `flex items-center gap-3 rounded-box px-3 py-2 text-[15px] ${isActive ? 'bg-led/15 font-semibold text-ink' : 'text-muted hover:bg-line/40 hover:text-ink'}`}>
              {({ isActive }) => (<><Icon size={18} className={isActive ? 'text-ledink' : ''} />{label}</>)}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
          <button onClick={() => setConta(true)} className="flex min-w-0 items-center gap-1.5 text-muted hover:text-ink" title="Minha conta"><UserCircle size={16} className="shrink-0" /><span className="truncate">{nome || 'Minha conta'}</span></button>
          <button onClick={() => supabase.auth.signOut()} className="flex items-center gap-1.5 text-muted hover:text-ink"><LogOut size={16} /> Sair</button>
        </div>
      </aside>

      {/* Topo no celular */}
      <header className="led-strip sticky top-0 z-30 flex h-14 items-center gap-2.5 border-b border-line bg-panel px-4 md:hidden">
        <img src="/icon.svg" alt="" className="h-7 w-7" />
        <span className="wide font-bold tracking-tight">Lucrei</span>
        <div className="ml-auto min-w-0"><EmpresaSeletor compacto /></div>
      </header>

      <main className="mx-auto w-full min-w-0 max-w-6xl px-4 pb-28 pt-6 sm:px-6 md:pb-10 md:pt-8">
        {!podeEditar && <p className="mb-4 rounded-box bg-line/50 px-3 py-2 text-sm text-muted">Seu acesso nesta empresa é <b>só leitura</b>: você vê tudo, mas não pode lançar nem alterar.</p>}
        <Outlet />
      </main>

      {/* Barra inferior no celular */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:hidden">
        {[itens[0], itens[1]].map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'text-ink font-semibold' : 'text-muted'}`}>
            <Icon size={20} />{label}
          </NavLink>
        ))}
        <button onClick={() => podeEditar && navigate('/vendas/nova')} className="flex flex-col items-center justify-center" aria-label="Nova venda">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-base shadow-[0_0_14px_rgb(var(--led)/.6)]"><Plus size={22} /></span>
        </button>
        <NavLink to="/estoque" className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'text-ink font-semibold' : 'text-muted'}`}>
          <Boxes size={20} />Estoque
        </NavLink>
        <button onClick={() => setMais(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted"><MoreHorizontal size={20} />Mais</button>
      </nav>

      <MinhaConta open={conta} onClose={() => setConta(false)} />

      {mais && (
        <div className="fixed inset-0 z-50 bg-ink/40 md:hidden" onClick={() => setMais(false)}>
          <div className="absolute inset-x-0 bottom-0 rounded-t-xl bg-panel p-3 pb-[calc(env(safe-area-inset-bottom)+12px)]" onClick={(e) => e.stopPropagation()}>
            {itens.slice(3).filter((i) => i.to !== '/estoque').map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} onClick={() => setMais(false)} className="flex items-center gap-3 rounded-box px-3 py-3 text-[15px] hover:bg-line/40"><Icon size={18} />{label}</NavLink>
            ))}
            <button onClick={() => { setMais(false); setConta(true) }} className="flex w-full items-center gap-3 rounded-box px-3 py-3 text-[15px] hover:bg-line/40"><UserCircle size={18} />Minha conta</button>
            <button onClick={() => supabase.auth.signOut()} className="flex w-full items-center gap-3 rounded-box px-3 py-3 text-[15px] text-muted"><LogOut size={18} />Sair</button>
          </div>
        </div>
      )}
    </div>
  )
}
