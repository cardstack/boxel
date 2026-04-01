#!/bin/sh
set -eu

mkdir -p /var/lib/postgresql
tar -xf /seed/pgdata.tar -C /var/lib/postgresql
chown -R postgres:postgres /var/lib/postgresql/data

exec docker-entrypoint.sh postgres \
  -c fsync=off \
  -c full_page_writes=off \
  -c synchronous_commit=off \
  -c shared_buffers=16MB \
  -c max_connections=50 \
  -c wal_level=minimal \
  -c max_wal_senders=0 \
  -c max_replication_slots=0 \
  -c autovacuum=off \
  -c track_counts=off \
  -c track_activities=off \
  -c jit=off \
  -c huge_pages=off \
  -c unix_socket_directories='' \
  -c listen_addresses='0.0.0.0'
