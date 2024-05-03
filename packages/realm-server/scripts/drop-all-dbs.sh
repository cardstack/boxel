#! /bin/sh

pnpm run drop-db boxel_dev
pnpm run drop-db boxel_test
pnpm run drop-db boxel_dev_base
pnpm run drop-db boxel_test_base_root
