#!/bin/sh
set -euo pipefail

tmpFile='./schema_tmp.sql'
# Directory where SQLite schema files are written (relative to this script's location)
SCHEMA_DIR="../host/config/schema"

# Remove previously generated schema files so we only keep the latest one
if [ -d "$SCHEMA_DIR" ]; then
  # Match only files that end with _schema.sql to avoid deleting unrelated files
  rm -f "$SCHEMA_DIR"/*_schema.sql 2>/dev/null || true
fi

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
  --exclude-table-and-children=proxy_endpoints \
  --exclude-table-and-children=claimed_domains_for_sites \
  --exclude-table-and-children=session_rooms \
  --no-tablespaces \
  --no-table-access-method \
  --no-owner \
  --no-acl \
  boxel >$tmpFile

ts-node --transpileOnly ./scripts/convert-to-sqlite.ts $tmpFile
rm $tmpFile
