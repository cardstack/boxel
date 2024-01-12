#! /bin/sh
USERNAME=base_realm PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
USERNAME=drafts_realm PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
USERNAME=published_realm PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
USERNAME=node-test_realm PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
USERNAME=test_realm PASSWORD=password ts-node --transpileOnly ./scripts/register-test-user.ts
