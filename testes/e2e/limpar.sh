#!/bin/bash
psql -h /var/tmp/pgtest -p 54329 -U postgres -d e2e -qc "truncate empresa, auditoria, asaas_evento restart identity cascade; truncate auth.users cascade;" 2>&1 | grep -v NOTICE
true
