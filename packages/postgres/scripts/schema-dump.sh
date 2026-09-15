#!/usr/bin/env bash
set -euo pipefail

tmpFile='./schema_tmp.sql'
dumpConnectionArgs=()
if [ -n "${BOXEL_SCHEMA_PG_HOST:-}" ]; then
  dumpConnectionArgs=(-h "$BOXEL_SCHEMA_PG_HOST")
fi
docker exec "${BOXEL_SCHEMA_PG_CONTAINER:-boxel-pg}" pg_dump \
  "${dumpConnectionArgs[@]}" \
  -U postgres -w --schema-only \
  --exclude-table-and-children=pgmigrations \
  --exclude-table-and-children=migrations \
  --exclude-table-and-children=migrations_removal \
  --exclude-table-and-children=job_statuses \
  --exclude-table-and-children=jobs \
  --exclude-table-and-children=queues \
  --exclude-table-and-children=job_reservations \
  --exclude-table-and-children=job_progress \
  --exclude-table-and-children=job_scoped_search_cache \
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
  --exclude-table-and-children=host_shell_generation \
  --exclude-table-and-children=lattice_publication_events \
  --exclude-table-and-children=lattice_publication_deliveries \
  --no-tablespaces \
  --no-table-access-method \
  --no-owner \
  --no-acl \
  "${BOXEL_SCHEMA_PG_DATABASE:-boxel}" >$tmpFile

node ./scripts/convert-to-sqlite.ts $tmpFile
rm $tmpFile
