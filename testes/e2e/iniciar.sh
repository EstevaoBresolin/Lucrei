#!/bin/bash
cd /tmp/claude-0/e2e && . ./env.sh
export SUPABASE_URL=http://localhost:54321 SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY
export ML_APP_ID=123456 ML_SECRET=segredo-teste APP_URL=http://localhost:4173 ASAAS_API_KEY=chave-teste ASAAS_AMBIENTE=sandbox
export ASAAS_WEBHOOK_TOKEN DENO_DIR=/tmp/claude-0/e2e/deno-cache
pkill -f run_fn.ts; pkill -f servidor.mjs; sleep 0.5
nohup node servidor.mjs > logs/gateway.log 2>&1 &
i=8101; for f in ml-sync ml-oauth ml-webhook assinatura asaas-webhook; do
  FN_PORT=$i nohup bin/deno run -A --no-lock --config /tmp/claude-0/e2e/deno.json run_fn.ts "file:///tmp/claude-0/e2e/fn/$f/index.ts" > logs/fn-$f.log 2>&1 &
  i=$((i+1)); done
