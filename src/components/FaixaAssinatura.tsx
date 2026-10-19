import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const dataBR = (d: string | null) => (d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('pt-BR') : '')

/** Faixa no topo: dias de teste, cobrança atrasada, modo só leitura ou limite do plano estourado. */
export default function FaixaAssinatura() {
  const { assinatura: a, ehDono } = useAuth()
  if (!a || a.situacao === 'cortesia') return null

  const acao = (texto: string) => ehDono
    ? <Link to="/assinatura" className="ml-auto shrink-0 rounded-box bg-ink px-3 py-1.5 text-xs font-semibold text-base hover:bg-ink/90">{texto}</Link>
    : <span className="ml-auto shrink-0 text-xs opacity-80">Fale com o dono da empresa.</span>

  let tom = 'bg-led/10 text-ink border-led/30', msg: React.ReactNode = null, botao: React.ReactNode = null

  if (a.situacao === 'bloqueada') {
    tom = 'bg-bad/10 text-bad border-bad/30'
    msg = <><b>Modo só leitura.</b> {a.assinada ? 'A assinatura não foi paga.' : 'Seu teste grátis acabou.'} Seus dados estão guardados: você vê tudo, mas não lança nada novo.</>
    botao = acao(a.assinada ? 'Pagar agora' : 'Assinar e liberar')
  } else if (a.situacao === 'atrasada') {
    tom = 'bg-warn/10 text-warn border-warn/30'
    msg = <><b>Pagamento atrasado</b>{a.cobranca_vencimento ? ` desde ${dataBR(a.cobranca_vencimento)}` : ''}. Pague para não ficar em modo só leitura.</>
    botao = acao('Pagar agora')
  } else if (a.situacao === 'teste') {
    if (a.assinada) {
      msg = <><b>Assinatura feita.</b> Você segue no teste grátis até {dataBR(a.teste_ate)}; a 1ª cobrança vence nesse dia.</>
    } else {
      const fim = a.dias_teste <= 5
      if (fim) tom = 'bg-warn/10 text-warn border-warn/30'
      msg = <><b>Teste grátis:</b> {a.dias_teste <= 1 ? 'último dia' : `faltam ${a.dias_teste} dias`}. Assine para continuar lançando depois de {dataBR(a.teste_ate)}.</>
      botao = acao('Ver planos')
    }
  } else if (a.situacao === 'cancelada') {
    tom = 'bg-line/50 text-ink border-line'
    msg = <><b>Assinatura cancelada.</b> Você usa normalmente até {dataBR(a.pago_ate)}; depois a conta fica só leitura.</>
    botao = acao('Assinar de novo')
  } else if (a.situacao === 'ativa' && a.limite_vendas && a.vendas_mes > a.limite_vendas) {
    tom = 'bg-warn/10 text-warn border-warn/30'
    msg = <><b>{a.vendas_mes} vendas este mês</b>, acima do limite do plano {a.plano_nome} ({a.limite_vendas}).</>
    botao = acao('Trocar de plano')
  } else return null

  return (
    <div className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-box border px-3 py-2 text-sm ${tom}`}>
      <span className="min-w-0">{msg}</span>
      {botao}
    </div>
  )
}
