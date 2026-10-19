import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Layout from './components/Layout'
import Login, { NovaSenha } from './pages/Login'
import Dashboard from './pages/Dashboard'
import Vendas from './pages/Vendas'
import NovaVenda from './pages/NovaVenda'
import VendaDetalhe from './pages/VendaDetalhe'
import Produtos from './pages/Produtos'
import ProdutoDetalhe from './pages/ProdutoDetalhe'
import Materiais from './pages/Materiais'
import Estoque from './pages/Estoque'
import Producao from './pages/Producao'
import Compras from './pages/Compras'
import Cadastros from './pages/Cadastros'
import Financeiro from './pages/Financeiro'
import Financas from './pages/Financas'
import Config from './pages/Config'
import Assinatura from './pages/Assinatura'
import Landing from './pages/Landing'
import { Privacidade, Termos } from './pages/Termos'
import { AceitarTermos, Convite, CriarEmpresa, conviteGuardado } from './pages/Onboarding'

export default function App() {
  const { session, carregando, ehDono, recuperando, empresa, termosOk, modulo } = useAuth()
  const { pathname } = useLocation()

  // Páginas públicas
  if (pathname === '/termos') return <Termos />
  if (pathname === '/privacidade') return <Privacidade />

  if (carregando) return <div className="flex min-h-screen items-center justify-center text-sm text-muted">Carregando…</div>
  if (recuperando && session) return <NovaSenha />
  const convite = pathname.startsWith('/convite/') ? pathname.split('/')[2] : null
  if (!session) {
    if (convite) return <Login convite={convite} />
    if (pathname === '/entrar') return <Login />
    if (pathname === '/cadastro') return <Login inicio="criar" />
    return <Landing />
  }
  if (!termosOk) return <AceitarTermos />
  if (convite || (!empresa && conviteGuardado())) return <Convite token={convite ?? conviteGuardado()!} />
  if (!empresa) return <CriarEmpresa />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="vendas" element={<Vendas />} />
        <Route path="vendas/nova" element={<NovaVenda />} />
        <Route path="vendas/:id" element={<VendaDetalhe />} />
        <Route path="produtos" element={<Produtos />} />
        <Route path="produtos/:id" element={<ProdutoDetalhe />} />
        <Route path="estoque" element={<Estoque />} />
        {modulo('producao') && <Route path="insumos" element={<Materiais />} />}
        {modulo('producao') && <Route path="producao" element={<Producao />} />}
        {modulo('compras') && <Route path="compras" element={<Compras />} />}
        {(modulo('clientes') || modulo('fornecedores')) && <Route path="cadastros" element={<Cadastros />} />}
        {ehDono && modulo('financas') && <Route path="financeiro" element={<Financeiro />} />}
        {ehDono && modulo('financas') && <Route path="financas" element={<Financas />} />}
        {ehDono && <Route path="config" element={<Config />} />}
        <Route path="assinatura" element={<Assinatura />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
