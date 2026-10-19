#!/bin/bash
# recompila o site de teste a partir do código atual (inclui mudanças ainda não commitadas)
cd /tmp/claude-0/e2e && . ./env.sh
rm -rf app/src app/supabase && cp -r /home/claude/lucrei/src /home/claude/lucrei/supabase /home/claude/lucrei/index.html /home/claude/lucrei/public app/ 2>/dev/null; cp /home/claude/lucrei/*.json /home/claude/lucrei/*.js /home/claude/lucrei/*.ts app/ 2>/dev/null; true
cd app && ln -sfn /home/claude/src/web/node_modules node_modules
printf "VITE_SUPABASE_URL=http://localhost:54321\nVITE_SUPABASE_ANON_KEY=%s\nVITE_SITE_URL=http://localhost:4173\n" "$ANON_KEY" > .env
npx vite build --outDir dist > ../logs/build.log 2>&1 && echo built || tail -5 ../logs/build.log
# funções com URLs dos simuladores
cd .. && rm -rf fn && cp -r /home/claude/lucrei/supabase/functions fn
grep -rl "mercadolibre.com\|mercadopago.com\|auth.mercadolivre\|asaas.com" fn | xargs sed -i \
 -e "s#https://api.mercadolibre.com#http://localhost:54321/__sim/ml#g" -e "s#https://api.mercadopago.com#http://localhost:54321/__sim/mp#g" \
 -e "s#https://auth.mercadolivre.com.br/authorization#http://localhost:54321/__sim/ml-auth#g" \
 -e "s#https://api-sandbox.asaas.com/v3#http://localhost:54321/__sim/asaas#g" -e "s#https://api.asaas.com/v3#http://localhost:54321/__sim/asaas#g"
