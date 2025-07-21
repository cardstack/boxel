#!/bin/sh

tmpFile='./schema_tmp.sql'

docker exec boxel-pg pg_dump \
  -U postgres -w --schema-only \
  --exclude-table-and-children=pgmigrations \
  --exclude-table-and-children=migrations \
  --exclude-table-and-children=job_statuses \
  --exclude-table-and-children=jobs \
  --exclude-table-and-children=queues \
  --exclude-table-and-children=job_reservations \
  --exclude-table-and-children=subscription_cycles \
  --exclude-table-and-children=subscriptions \
  --exclude-table-and-children=ai_actions \
  --exclude-table-and-children=users \
  --exclude-table-and-children=plans \
  --exclude-table-and-children=credits_ledger \
  --exclude-table-and-children=stripe_events \
  --exclude-table-and-children=ai_bot_event_processing \
  --no-tablespaces \
  --no-table-access-method \
  --no-owner \
  --no-acl \
  boxel >$tmpFile

ts-node --transpileOnly ./scripts/convert-to-sqlite.ts $tmpFile
rm $tmpFile
