#! /bin/sh

: ${REALM_SECRET_SEED:="shhh! it's a secret"}
export REALM_SECRET_SEED

node ./scripts/migrate-realm-user.ts @realm-server:localhost
node ./scripts/migrate-realm-user.ts @node-test_realm-server:localhost
node ./scripts/migrate-realm-user.ts @base_realm:localhost
node ./scripts/migrate-realm-user.ts @boxel_homepage_realm:localhost
node ./scripts/migrate-realm-user.ts @submission_realm:localhost
node ./scripts/migrate-realm-user.ts @experiments_realm:localhost
node ./scripts/migrate-realm-user.ts @software_factory_realm:localhost
node ./scripts/migrate-realm-user.ts @node-test_realm:localhost
node ./scripts/migrate-realm-user.ts @test_realm:localhost
