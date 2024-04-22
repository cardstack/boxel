#! /bin/sh
shard_flag=${1:+--shard}
echo "running tests: ${1}"
start-server-and-test \
  'pnpm run wait' \
  'http-get://localhost:4201/base/fields/boolean-field?acceptHeader=application%2Fvnd.card%2Bjson|http-get://localhost:4202/test/hassan?acceptHeader=application%2Fvnd.card%2Bjson' \
  'pnpm run start:host-pre-built' \
  'http://127.0.0.1:4200' \
  "pnpm playwright test ${shard_flag} ${1} --repeat-each=9"
  # FIXME remove repetitions
