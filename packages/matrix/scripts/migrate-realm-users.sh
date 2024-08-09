#! /bin/sh

: ${REALM_SECRET_SEED:="shhh! it's a secret"}
export REALM_SECRET_SEED

ts-node --transpileOnly ./scripts/migrate-realm-user @base_realm:localhost
ts-node --transpileOnly ./scripts/migrate-realm-user @experiments_realm:localhost
ts-node --transpileOnly ./scripts/migrate-realm-user @node-test_realm:localhost
ts-node --transpileOnly ./scripts/migrate-realm-user @test_realm:localhost
