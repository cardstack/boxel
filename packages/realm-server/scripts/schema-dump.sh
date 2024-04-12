#!/bin/sh

tmpFile='./schema_tmp.sql'

docker exec boxel-pg pg_dump \
  -U postgres -w --schema-only \
  --exclude-table-and-children=job_statuses \
  --exclude-table-and-children=pgmigrations \
  --exclude-table-and-children=jobs \
  --no-tablespaces \
  --no-table-access-method \
  --no-owner \
  --no-acl \
  boxel >$tmpFile

ts-node --transpileOnly ./scripts/convert-to-sqlite.ts $tmpFile
rm $tmpFile
