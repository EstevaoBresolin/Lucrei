import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Boxes, Check, Landmark, Layers, PlugZap, ReceiptText, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Plano = { codigo: string; nome: string; preco: number; limite_vendas: number }
const PLANOS_PADRAO: Plano[] = [
  { codigo: 'inicial', nome: 'Inicial', preco: 59.9, limite_vendas: 100 },
  { codigo: 'crescimento', nome: 'Crescimento', preco: 99, limite_vendas: 300 },
  { codigo: 'profissional', nome: 'Profissional', preco: 159, limite_vendas: 1000 },
]
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function Cta({ children = 'Testar 30 dias grátis', grande }: { children?: ReactNode; grande?: boolean }) {
  return (
    <Link to="/cadastro" className={`inline-flex items-center justify-center gap-2 rounded-box bg-ink font-semibold text-base shadow-[0_0_22px_rgb(var(--led)/.45)] transition hover:bg-ink/90 ${grande ? 'h-12 px-6 text-[16px]' : 'h-10 px-4 text-sm'}`}>
      {children} <ArrowRight size={grande ? 18 : 16} />
    </Link>
  )
}

/** Exemplo ilustrativo de uma venda aberta no Apura (números de exemplo). */
function VendaExemplo() {
  const linhas: [string, string, string?][] = [
    ['Venda no Mercado Livre', 'R$ 189,90'],
    ['Tarifa do Mercado Livre', '− R$ 22,79', 'text-muted'],
    ['Frete pago por você', '− R$ 21,45', 'text-muted'],
    ['Custo do produto', '− R$ 64,30', 'text-muted'],
    ['Imposto', '− R$ 11,39', 'text-muted'],
  ]
  return (
    <div className="relative">
      <div aria-hidden className="absolute -inset-6 rounded-[28px] bg-led/20 blur-3xl" />
      <div className="relative rounded-xl border border-line bg-panel p-5 shadow-xl sm:p-6">
        <div className="mb-4 flex items-center justify-between text-xs text-muted">
          <span className="font-semibold uppercase tracking-wider">Venda #1284</span>
          <span className="rounded-full bg-led/15 px-2 py-0.5 font-medium text-ledink">entrou sozinha do ML</span>
        </div>
        <ul className="space-y-2.5 text-[15px]">
          {linhas.map(([l, v, c]) => (
            <li key={l} className="flex justify-between gap-4"><span className={c}>{l}</span><span className={`num ${c ?? 'font-medium'}`}>{v}</span></li>
          ))}
        </ul>
        <div className="led-strip mt-4 border-t border-line pt-4" />
        <div className="mt-5 flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Lucro de verdade</p>
            <p className="wide num text-3xl font-bold text-good">R$ 69,97</p>
          </div>
          <p className="num rounded-box bg-good/10 px-2.5 py-1 text-sm font-semibold text-good">36,8% de margem</p>
        </div>
      </div>
      <p className="relative mt-3 text-center text-xs text-muted">Exemplo ilustrativo</p>
    </div>
  )
}

const RECURSOS: { icon: typeof Boxes; titulo: string; texto: string }[] = [
  { icon: PlugZap, titulo: 'Mercado Livre no automático', texto: 'Conecte sua conta e cada venda entra sozinha, com tarifa, frete e status do envio. Importe seus anúncios e já saia com os produtos cadastrados.' },
  { icon: ReceiptText, titulo: 'Lucro real de cada venda', texto: 'Desconta taxa, frete, imposto e o custo do produto. Você vê o que sobrou de fato, por venda, por produto e por canal.' },
  { icon: Boxes, titulo: 'Estoque que se mexe sozinho', texto: 'Vendeu, baixou. Kits baixam cada item que vai dentro. Alerta de estoque baixo antes de faltar.' },
  { icon: Landmark, titulo: 'Caixa e contas a pagar', texto: 'Saldo das contas, despesas e o que falta pagar aos fornecedores, com adiantamento e pagamento em partes.' },
  { icon: Layers, titulo: 'Produção e insumos (se precisar)', texto: 'Fabrica o que vende? Monte a ficha técnica e o custo sai certo. Só revende? Desligue o módulo e pronto.' },
  { icon: Users, titulo: 'Equipe com permissões', texto: 'Convide quem ajuda: operador lança vendas e estoque, mas finanças ficam só com você.' },
]

const PERGUNTAS: [string, string][] = [
  ['Preciso de cartão para testar?', 'Não. Você cria a conta, usa tudo por 30 dias e só assina se fizer sentido.'],
  ['E depois dos 30 dias?', 'Você escolhe um plano e paga por Pix, boleto ou cartão. Se não assinar, a conta fica em modo só leitura: nada é apagado e você volta quando quiser.'],
  ['Como conta o limite de vendas?', 'É por mês: as vendas lançadas no mês, sem contar as canceladas. Cresceu? Troca de plano na hora.'],
  ['Funciona para quem só revende?', 'Sim. O Apura serve para quem revende e para quem fabrica. Você liga só os módulos que usa.'],
  ['Posso cancelar?', 'Quando quiser, pela própria tela de assinatura. Sem multa e sem ligação.'],
]

export default function Landing() {
  const [planos, setPlanos] = useState<Plano[]>(PLANOS_PADRAO)
  useEffect(() => {
    supabase.from('plano').select('codigo, nome, preco, limite_vendas').eq('ativo', true).order('ordem')
      .then(({ data }) => { if (data?.length) setPlanos(data as Plano[]) })
  }, [])

  return (
    <div className="min-h-screen overflow-x-hidden">
      {/* Topo */}
      <header className="sticky top-0 z-30 border-b border-line/70 bg-base/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <div className="led-strip flex items-center gap-2.5 pb-1">
            <img src="/icon.svg" alt="" className="h-8 w-8" />
            <span className="wide text-xl font-bold tracking-tight">Apura <span className="font-medium text-muted">Gestão</span></span>
          </div>
          <nav className="ml-auto flex items-center gap-1 sm:gap-3">
            <a href="#planos" className="hidden px-2 text-sm text-muted hover:text-ink sm:block">Planos</a>
            <a href="#perguntas" className="hidden px-2 text-sm text-muted hover:text-ink sm:block">Dúvidas</a>
            <Link to="/entrar" className="px-2 text-sm font-medium text-muted hover:text-ink">Entrar</Link>
            <Cta>Testar grátis</Cta>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 md:grid-cols-[1.1fr_1fr] md:pb-24 md:pt-20">
        <div>
          <h1 className="wide text-[38px] font-extrabold leading-[1.05] tracking-tight sm:text-5xl md:text-[56px]">
            Você vende bem.<br />Mas <span className="text-ledink">quanto sobra</span>?
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            O Apura junta vendas, taxas, frete, estoque e caixa e mostra o lucro de verdade de cada venda. Suas vendas do Mercado Livre entram sozinhas.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Cta grande />
            <span className="text-sm text-muted">Sem cartão de crédito · cancela quando quiser</span>
          </div>
        </div>
        <VendaExemplo />
      </section>

      {/* Vídeo */}
      <section className="mx-auto grid max-w-5xl items-center gap-10 px-4 pb-16 sm:px-6 md:grid-cols-[1fr_340px] md:pb-24">
        <div className="order-2 md:order-1">
          <h2 className="wide text-3xl font-bold tracking-tight">Veja em 40 segundos</h2>
          <p className="mt-3 max-w-lg text-muted">Uma venda de R$ 119,90 no Mercado Livre deixou R$ 29,45 de lucro. O vídeo mostra como o Apura chega nesse número e o que mais ele acompanha por você.</p>
          <ul className="mt-6 space-y-2.5 text-[15px]">
            {['Lucro real de cada venda, com taxa, frete, imposto e custo descontados', 'Painel do mês com lucro, margem e para onde vai o dinheiro', 'Estoque que baixa sozinho e avisa antes de faltar', 'Saldo das contas e o que falta pagar aos fornecedores'].map((t) => (
              <li key={t} className="flex gap-2.5"><Check size={18} className="mt-0.5 shrink-0 text-ledink" />{t}</li>
            ))}
          </ul>
          <div className="mt-8"><Cta /></div>
        </div>
        <div className="order-1 mx-auto w-full max-w-[300px] md:order-2">
          <video className="aspect-[9/16] w-full rounded-[28px] border-[6px] border-ink bg-ink shadow-xl" src="/video/apura-40s.mp4" poster="/video/apura-40s.jpg" controls playsInline preload="none" aria-label="Vídeo de 40 segundos mostrando o Apura Gestão" />
        </div>
      </section>

      {/* Recursos */}
      <section className="border-y border-line bg-panel">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
          <h2 className="wide max-w-2xl text-3xl font-bold tracking-tight">Tudo o que a planilha não faz sozinha</h2>
          <p className="mt-3 max-w-2xl text-muted">Pare de juntar extrato do Mercado Pago, relatório do ML e planilha de custo. O Apura faz a conta por você.</p>
          <div className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {RECURSOS.map(({ icon: Icon, titulo, texto }) => (
              <div key={titulo}>
                <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-box bg-led/15 text-ledink"><Icon size={20} /></span>
                <h3 className="text-[17px] font-semibold">{titulo}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{texto}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Como começar */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
        <h2 className="wide text-3xl font-bold tracking-tight">Comece em poucos minutos</h2>
        <ol className="mt-10 grid gap-6 md:grid-cols-3">
          {[
            ['Crie sua conta', 'Nome, e-mail e senha. Sem cartão.'],
            ['Conecte o Mercado Livre', 'Um clique. Importe os anúncios e informe o custo de cada produto.'],
            ['Acompanhe o painel', 'Faturamento, lucro, margem, estoque e o que falta pagar.'],
          ].map(([t, d], i) => (
            <li key={t} className="rounded-xl border border-line bg-panel p-6">
              <span className="wide num text-4xl font-extrabold text-led">{i + 1}</span>
              <h3 className="mt-3 text-[17px] font-semibold">{t}</h3>
              <p className="mt-1 text-[15px] text-muted">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Planos */}
      <section id="planos" className="scroll-mt-20 border-t border-line bg-panel">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
          <div className="text-center">
            <h2 className="wide text-3xl font-bold tracking-tight">Planos que crescem com suas vendas</h2>
            <p className="mt-3 text-muted">Todos com todos os recursos. <b className="text-ink">30 dias grátis</b> em qualquer um.</p>
          </div>
          <div className="mx-auto mt-10 grid max-w-5xl gap-5 md:grid-cols-3">
            {planos.map((p, i) => {
              const destaque = i === 1
              return (
                <div key={p.codigo} className={`relative flex flex-col rounded-xl border bg-base p-6 ${destaque ? 'border-led shadow-[0_0_0_1px_rgb(var(--led)),0_10px_40px_-10px_rgb(var(--led)/.45)]' : 'border-line'}`}>
                  {destaque && <span className="absolute -top-3 left-6 rounded-full bg-led px-2.5 py-0.5 text-xs font-semibold text-white">Recomendado</span>}
                  <h3 className="text-lg font-semibold">{p.nome}</h3>
                  <p className="mt-1 text-sm text-muted">Até <b className="text-ink">{p.limite_vendas.toLocaleString('pt-BR')} vendas</b> por mês</p>
                  <p className="mt-5"><span className="wide num text-4xl font-extrabold">{brl(Number(p.preco))}</span><span className="text-muted">/mês</span></p>
                  <ul className="mt-6 flex-1 space-y-2 text-[15px]">
                    {['Mercado Livre automático', 'Lucro por venda e por produto', 'Estoque, kits e compras', 'Finanças e contas a pagar', 'Usuários com permissões'].map((r) => (
                      <li key={r} className="flex gap-2"><Check size={18} className="mt-0.5 shrink-0 text-led" />{r}</li>
                    ))}
                  </ul>
                  <Link to="/cadastro" className={`mt-8 inline-flex h-11 items-center justify-center rounded-box font-semibold ${destaque ? 'bg-ink text-base hover:bg-ink/90' : 'border border-line hover:bg-line/40'}`}>Começar teste grátis</Link>
                </div>
              )
            })}
          </div>
          <p className="mt-6 text-center text-sm text-muted">Pague por Pix, boleto ou cartão. Mais de 1.000 vendas por mês? <a href="mailto:estevaobresolin@hotmail.com" className="underline hover:text-ink">Fale com a gente</a>.</p>
        </div>
      </section>

      {/* Dúvidas */}
      <section id="perguntas" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-16 sm:px-6 md:py-20">
        <h2 className="wide text-3xl font-bold tracking-tight">Dúvidas comuns</h2>
        <div className="mt-8 divide-y divide-line border-y border-line">
          {PERGUNTAS.map(([q, r]) => (
            <details key={q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-medium">
                {q}<span className="text-xl text-muted transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{r}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Chamada final */}
      <section className="px-4 pb-20 sm:px-6">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-2xl bg-ink px-6 py-14 text-center text-base sm:px-12">
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-led shadow-[0_0_30px_6px_rgb(var(--led)/.7)]" />
          <h2 className="wide text-3xl font-bold tracking-tight sm:text-4xl">Descubra seu lucro real ainda hoje</h2>
          <p className="mx-auto mt-3 max-w-xl opacity-80">30 dias grátis, sem cartão. Seus dados ficam guardados mesmo se você não assinar.</p>
          <Link to="/cadastro" className="mt-8 inline-flex h-12 items-center gap-2 rounded-box bg-led px-6 font-semibold text-white shadow-[0_0_24px_rgb(var(--led)/.6)] hover:brightness-110">
            Criar minha conta grátis <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted sm:px-6">
          <span>© {new Date().getFullYear()} Apura Gestão</span>
          <a href="/termos" className="hover:text-ink">Termos de uso</a>
          <a href="/privacidade" className="hover:text-ink">Privacidade</a>
          <Link to="/entrar" className="ml-auto hover:text-ink">Já tenho conta</Link>
        </div>
      </footer>
    </div>
  )
}
