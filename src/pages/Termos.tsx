import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { TERMOS_VERSAO } from '../lib/auth'

// Dados do responsável pelo serviço. Troque quando houver CNPJ e e-mail próprios.
const RESPONSAVEL = 'Lucrei'
const DOCUMENTO = '' // ex.: 'CNPJ 00.000.000/0001-00'
const CONTATO = 'estevaobresolin@hotmail.com'
const ATUALIZADO = TERMOS_VERSAO.split('-').reverse().join('/')

function Pagina({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link to="/" className="mb-6 inline-flex items-center gap-2">
        <img src="/icon.svg" alt="" className="h-8 w-8" /><span className="wide text-lg font-bold">Lucrei</span>
      </Link>
      <h1 className="wide mb-1 text-2xl font-bold">{titulo}</h1>
      <p className="mb-8 text-sm text-muted">Última atualização: {ATUALIZADO}</p>
      <div className="flex flex-col gap-5 text-[15px] leading-relaxed [&_h2]:wide [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
        {children}
      </div>
      <p className="mt-10 text-sm text-muted"><Link to="/termos" className="underline">Termos de uso</Link> · <Link to="/privacidade" className="underline">Política de privacidade</Link> · <Link to="/" className="underline">Voltar ao Lucrei</Link></p>
    </div>
  )
}

const quem = `${RESPONSAVEL}${DOCUMENTO ? `, ${DOCUMENTO}` : ''}`

export function Termos() {
  return (
    <Pagina titulo="Termos de uso">
      <p>Estes termos regem o uso do Lucrei, um sistema on-line de gestão de vendas, estoque, custos e finanças para quem vende em marketplaces e em outros canais, oferecido por {quem} ("nós"). Ao criar uma conta ou usar o sistema, você ("usuário") concorda com estes termos. Se não concordar, não use o serviço.</p>

      <h2>1. O serviço</h2>
      <p>O Lucrei permite cadastrar produtos, insumos, compras, vendas e despesas, acompanhar estoque e calcular o lucro de cada venda, além de se conectar, por sua autorização, a contas de marketplaces (como o Mercado Livre) para importar anúncios, pedidos, pagamentos e perguntas.</p>
      <p>O serviço está em fase inicial (MVP). Funcionalidades podem mudar, ser incluídas ou retiradas. Faremos o possível para avisar mudanças relevantes com antecedência.</p>

      <h2>2. Conta, empresa e usuários</h2>
      <ul>
        <li>Você deve informar dados verdadeiros e manter sua senha em segredo. Atividades feitas com seu login são de sua responsabilidade.</li>
        <li>Cada conta pode criar uma ou mais empresas. Quem cria a empresa é o <b>dono</b> e pode convidar outras pessoas com os papéis de dono, operador ou só leitura. O dono é responsável por quem convida e pelos acessos que concede.</li>
        <li>Os dados de cada empresa ficam separados dos de outras empresas. Um usuário só vê os dados das empresas das quais participa.</li>
      </ul>

      <h2>3. Integrações com marketplaces</h2>
      <ul>
        <li>A conexão com o Mercado Livre (e outros canais no futuro) só acontece quando o dono da empresa autoriza, e pode ser desfeita a qualquer momento nas Configurações do Lucrei ou na própria conta do marketplace.</li>
        <li>Usamos o acesso apenas para as funções do sistema: ler anúncios, pedidos, envios, pagamentos e perguntas da conta conectada. Não publicamos, alteramos anúncios nem respondemos clientes em seu nome sem uma ação sua.</li>
        <li>Os marketplaces podem mudar regras, limites e dados disponíveis sem aviso. Não respondemos por indisponibilidades ou alterações dos serviços de terceiros.</li>
      </ul>

      <h2>4. Uso permitido</h2>
      <p>Você se compromete a não usar o Lucrei para atividades ilegais, a não tentar acessar dados de outras empresas, a não sobrecarregar ou atacar o sistema e a não copiar, revender ou fazer engenharia reversa do software.</p>

      <h2>5. Seus dados e responsabilidades</h2>
      <ul>
        <li>Os dados que você cadastra são seus. Você pode exportá-los e pedir a exclusão da empresa e da conta (veja a Política de privacidade).</li>
        <li>Os cálculos de custo, lucro, impostos e valores a receber dependem das informações cadastradas e dos dados enviados pelos marketplaces. Eles servem de apoio à gestão e <b>não substituem contador, nota fiscal ou obrigações fiscais</b>. Confira valores importantes antes de tomar decisões.</li>
      </ul>

      <h2>6. Disponibilidade e limitação de responsabilidade</h2>
      <p>Buscamos manter o sistema disponível e os dados protegidos, com cópias de segurança, mas não garantimos funcionamento ininterrupto ou livre de erros. Na máxima extensão permitida pela lei, não respondemos por lucros cessantes, perda de vendas ou danos indiretos decorrentes do uso ou da indisponibilidade do serviço.</p>

      <h2>7. Planos e pagamento</h2>
      <p>Toda empresa nova tem 30 dias de teste grátis, com todos os recursos e sem precisar de cartão. Depois disso, o uso continua mediante assinatura mensal de um dos planos exibidos no site, que variam conforme o número de vendas lançadas por mês (sem contar canceladas). Nenhuma cobrança é feita sem que você escolha e contrate um plano.</p>
      <p>A cobrança é feita pelo Asaas, por Pix, boleto ou cartão, e renova todo mês até ser cancelada. Você pode trocar de plano ou cancelar a qualquer momento na tela de Assinatura, sem multa; após o cancelamento, o acesso continua até o fim do período já pago.</p>
      <p>Se o teste acabar sem assinatura, ou se uma cobrança ficar em aberto por mais de 3 dias após o vencimento, a conta passa para o modo só leitura: os dados continuam guardados e visíveis, mas não é possível lançar nem alterar informações até o pagamento. Se o volume de vendas passar do limite do plano, avisaremos para que você troque de plano. Os preços podem ser reajustados com aviso prévio de pelo menos 30 dias.</p>

      <h2>8. Encerramento</h2>
      <p>Você pode parar de usar o serviço quando quiser. Podemos suspender contas que violem estes termos. Em caso de encerramento do serviço, avisaremos com antecedência razoável para que você possa exportar seus dados.</p>

      <h2>9. Alterações e lei aplicável</h2>
      <p>Podemos atualizar estes termos. Quando a mudança for relevante, pediremos que você aceite a nova versão ao entrar. Estes termos seguem as leis do Brasil, incluindo o Código de Defesa do Consumidor quando aplicável.</p>

      <h2>10. Contato</h2>
      <p>Dúvidas sobre estes termos: <a className="underline" href={`mailto:${CONTATO}`}>{CONTATO}</a>.</p>
    </Pagina>
  )
}

export function Privacidade() {
  return (
    <Pagina titulo="Política de privacidade">
      <p>Esta política explica como o Lucrei, oferecido por {quem}, trata dados pessoais, de acordo com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018, LGPD).</p>

      <h2>1. Papéis na LGPD</h2>
      <ul>
        <li><b>Dados da sua conta</b> (nome, e-mail, senha protegida, registros de acesso): nós somos o controlador.</li>
        <li><b>Dados que sua empresa cadastra ou importa</b> (clientes, compradores do marketplace, fornecedores, vendas): sua empresa é a controladora e nós atuamos como operador, tratando esses dados apenas para prestar o serviço e conforme suas instruções.</li>
      </ul>

      <h2>2. Que dados tratamos</h2>
      <ul>
        <li>Cadastro: nome, e-mail e senha (guardada de forma criptografada pelo provedor de autenticação).</li>
        <li>Assinatura: CPF ou CNPJ de quem paga, plano contratado e situação dos pagamentos. Os dados do cartão são digitados diretamente na página do Asaas e não passam pelo Lucrei.</li>
        <li>Dados de negócio: produtos, insumos, compras, vendas, despesas, saldos e demais informações que você lança.</li>
        <li>Dados vindos do marketplace conectado: anúncios, pedidos, apelido do comprador, envios, valores e datas de liberação de pagamentos e perguntas de clientes.</li>
        <li>Dados técnicos: data e hora de acesso, registros de alterações feitas no sistema (auditoria) e informações necessárias para segurança.</li>
      </ul>

      <h2>3. Para que usamos (finalidades e bases legais)</h2>
      <ul>
        <li>Prestar o serviço contratado: execução de contrato (art. 7º, V).</li>
        <li>Segurança, prevenção a fraudes e registros de acesso: legítimo interesse e obrigação legal (Marco Civil da Internet).</li>
        <li>Comunicações sobre a conta, como avisos de perguntas e redefinição de senha: execução de contrato.</li>
      </ul>
      <p>Não vendemos dados pessoais e não os usamos para publicidade de terceiros.</p>

      <h2>4. Com quem compartilhamos</h2>
      <p>Apenas com fornecedores necessários para o funcionamento do serviço, que seguem obrigações de segurança: hospedagem e banco de dados (Supabase), publicação do site (Vercel), envio de e-mails (Resend), cobrança das assinaturas (Asaas) e o marketplace que você conectar (Mercado Livre). Alguns desses fornecedores podem armazenar dados fora do Brasil, com as garantias previstas na LGPD. Também podemos compartilhar dados quando exigido por lei ou ordem judicial.</p>

      <h2>5. Por quanto tempo guardamos</h2>
      <p>Enquanto a conta e a empresa estiverem ativas. Após pedido de exclusão, apagamos os dados em até 30 dias, exceto o que a lei obrigar a manter (por exemplo, registros de acesso por 6 meses). Cópias de segurança são sobrescritas no ciclo normal de backup.</p>

      <h2>6. Segurança</h2>
      <p>Usamos conexão criptografada (HTTPS), separação dos dados de cada empresa no banco de dados, controle de acesso por papéis e guardamos as autorizações dos marketplaces apenas no servidor. Nenhum sistema é 100% invulnerável; se houver incidente relevante, comunicaremos os afetados e a ANPD conforme a lei.</p>

      <h2>7. Seus direitos</h2>
      <p>Você pode pedir confirmação de tratamento, acesso, correção, portabilidade, anonimização ou exclusão dos seus dados, além de informações sobre compartilhamento e revogação de consentimento. Para dados de clientes cadastrados por uma empresa, o pedido deve ser feito à própria empresa, e nós a apoiaremos no atendimento.</p>

      <h2>8. Cookies e armazenamento no navegador</h2>
      <p>Usamos apenas o armazenamento necessário para manter você conectado e lembrar preferências simples. Não usamos cookies de publicidade.</p>

      <h2>9. Contato do encarregado (DPO)</h2>
      <p>Pedidos e dúvidas sobre privacidade: <a className="underline" href={`mailto:${CONTATO}`}>{CONTATO}</a>.</p>

      <h2>10. Alterações</h2>
      <p>Esta política pode ser atualizada. Mudanças relevantes serão avisadas no sistema e, quando necessário, pediremos um novo aceite.</p>
    </Pagina>
  )
}
