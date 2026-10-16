# Lucrei

Gestão para quem vende em marketplace: produtos, estoque, compras, vendas com o lucro real de cada uma
(taxa, frete, imposto e custo), finanças e integração com o Mercado Livre.

Serve para quem **revende** (compra pronto) e para quem **fabrica** (ficha técnica de insumos e ordens de produção).
Cada empresa liga só os módulos que usa (Configurações → Empresa → Módulos).

## Arquitetura

- **Frontend:** React + Vite + Tailwind (`src/`), publicado na Vercel.
- **Banco:** Supabase/Postgres, **multi-empresa**: toda tabela tem `empresa_id` e o RLS só mostra
  linhas da empresa atual do usuário (`usuario.empresa_atual`, validada contra `membro`).
  Ligações entre tabelas usam `(empresa_id, id)`, então o banco recusa misturar registros de empresas diferentes.
- **Papéis:** `dono` (tudo), `operador` (lança e altera), `leitura` (só vê). Convites por link (`/convite/:token`).
- **Mercado Livre:** funções em `supabase/functions` (`ml-oauth`, `ml-webhook`, `ml-sync`).
  Cada empresa conecta a própria conta; o webhook direciona pelo `user_id` do vendedor.
  Uma conta do ML só pode estar em uma empresa.

## Banco de dados

Rode em ordem no SQL Editor de um projeto Supabase novo:

1. `supabase/01_base.sql` – empresas, usuários, papéis, convites, auditoria
2. `supabase/02_negocio.sql` – tabelas do negócio
3. `supabase/03_funcoes.sql` – regras (vendas, compras, produção, kits, finanças, cadastro de empresa)
4. `supabase/04_ml_rls.sql` – Mercado Livre, importação de anúncios, RLS e permissões
5. `supabase/05_exclusoes.sql` – funções de exclusão

`supabase/teste_isolamento.sql` cria duas empresas e confere que uma não enxerga nem altera a outra
(rodar num banco de teste).

## Variáveis

Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL`.

Segredos das Edge Functions (Supabase → Edge Functions → Secrets):
`ML_APP_ID`, `ML_SECRET`, `APP_URL` (endereço do site), `RESEND_API_KEY` e, opcional, `EMAIL_REMETENTE`.

No aplicativo do Mercado Livre (developers.mercadolivre.com.br):
- Redirect URI: `https://<projeto>.supabase.co/functions/v1/ml-oauth`
- URL de notificações: `https://<projeto>.supabase.co/functions/v1/ml-webhook`
- Tópicos: `orders_v2`, `shipments`, `questions`

## Desenvolvimento

```
npm install
cp .env.example .env
npm run dev
```
