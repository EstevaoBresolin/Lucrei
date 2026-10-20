#!/bin/bash
# roda a bateria completa (02→08) do zero; 01 roda à parte (jornada do cliente)
cd /tmp/claude-0/e2e/t
/tmp/claude-0/e2e/limpar.sh
/tmp/claude-0/e2e/iniciar.sh
psql -h /var/tmp/pgtest -p 54329 -U postgres -d e2e -qAtc "notify pgrst, 'reload schema'" >/dev/null
for i in $(seq 1 60); do n=0; for p in 54321 8101 8102 8103 8104 8105; do curl -s -o /dev/null -m 2 -X OPTIONS http://127.0.0.1:$p/ && n=$((n+1)); done; [ $n = 6 ] && break; sleep 2; done
for t in 01_cliente 02_cadastros 03_estoque 04_vendas 05_financas 06_config 07_acesso 08_celular 09_api 12_pagamentos 10_seguranca; do
  echo "== $t"; timeout 600 node $t.mjs > ../logs/$t.log 2>&1; echo "exit $?"
  grep -c "^PASS" ../logs/$t.log; grep "^FAIL\|Error:" ../logs/$t.log | head -20
done
