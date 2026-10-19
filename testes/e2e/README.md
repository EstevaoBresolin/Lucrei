# Bateria de testes de ponta a ponta do Lucrei

Roda o Lucrei inteiro numa máquina local, sem tocar em produção:

- **Banco**: Postgres 16 com os arquivos `supabase/01..07`.
- **Login/cadastro**: servidor de autenticação do Supabase (GoTrue), com caixa de e-mail falsa (`smtp.py`) para pegar os links de confirmação e de nova senha.
- **API**: PostgREST, como no Supabase.
- **Funções**: as Edge Functions reais rodando no Deno (`run_fn.ts`), apontadas para simuladores.
- **Simuladores** (`servidor.mjs`): Mercado Livre, Mercado Pago e Asaas, incluindo a página de pagamento, que dispara o webhook.
- **Navegador**: Chromium via Playwright, clicando e digitando como um cliente.

Suítes:

| Arquivo | O que cobre |
|---|---|
| `01_cliente.mjs` | Página de vendas, cadastro com validações, confirmação por e-mail, criação da empresa, teste de 30 dias, assinatura no Asaas, pagamento, troca de plano, cancelamento, esqueci a senha |
| `02_cadastros.mjs` | Fornecedores, clientes, insumos, produtos (3 tipos), kit, ficha técnica, preço por canal, duplicar, excluir, máscaras e campos obrigatórios |
| `03_estoque.mjs` | Movimentações, inventário, exportações, compras (pedida/recebida/editar/excluir), produção |
| `04_vendas.mjs` | Nova venda (validações, cálculo de lucro, kit, prejuízo, venda direta, repetir), detalhe, status, edição, devolução, cancelamento, lista, filtros, painel |
| `05_financas.mjs` | Contas, lançamentos, transferência, conferência de saldo, despesas e recorrentes |
| `06_config.mjs` | Empresa, módulos, canais e taxas, categorias, conexão e importação do ML, vendas do ML, convites e papéis |
| `07_acesso.mjs` | Teste vencido (só leitura, inclusive pela API), isolamento entre empresas, segunda empresa, troca de senha |
| `08_celular.mjs` | Todas as telas no celular e no modo escuro |
| `09_api.mjs` | Webhooks do Asaas e do ML (segurança, repetição, efeitos) |

Os caminhos dentro dos scripts são os do ambiente onde os testes foram rodados (`/tmp/claude-0/e2e`). Para rodar de novo, ajuste esses caminhos e as versões dos binários, e depois execute `rodar.sh`.
