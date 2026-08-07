#! /bin/sh
# Shared settings and helpers for the local boxel-pg container. Sourced, not
# executed. Every script that starts postgres pulls the connection ceiling from
# here so the value can't drift between them.

# One boxel-pg backs every service in a stack at once — realm servers plus
# their worker pools, prerender, prerender-manager — and each process opens its
# own pg pool (up to PG_POOL_MAX, default 40). Two worktrees running stacks
# together clear postgres's default ceiling of 100 as soon as anything fans out,
# and the caller only sees "sorry, too many clients already".
PG_MAX_CONNECTIONS=400

# The container these helpers act on. Overridable so the repair path can be
# exercised against a scratch container without touching a real stack's data.
PG_CONTAINER="${PG_CONTAINER:-boxel-pg}"

# Wait for postgres to accept queries.
#
# Probe over TCP rather than the unix socket: the postgres image runs a
# temporary init server on the socket while it sets the cluster up, so a socket
# probe can report ready and the very next query then fails with "database
# system is shutting down".
pg_wait_ready() {
  _pg_attempts=0
  while ! docker exec "$PG_CONTAINER" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do
    _pg_attempts=$((_pg_attempts + 1))
    if [ "$_pg_attempts" -ge 60 ]; then
      echo "$PG_CONTAINER: still not accepting connections after $_pg_attempts attempts" >&2
      return 1
    fi
    sleep 1
  done
  return 0
}

# Bring the running container's connection ceiling up to PG_MAX_CONNECTIONS.
#
# This is applied after start rather than with `docker run -c max_connections`,
# because a command-line setting is fixed for the life of the container and
# outranks everything else. Both callers create the container only when it is
# absent and otherwise just `docker start` it, which reuses the original Cmd, so
# a `-c` value can never be revised: raising the target later would leave every
# existing container on the old number with no way to notice. Postgres reports
# `source = command line` for such a setting and ignores postgresql.auto.conf
# entirely, so even an explicit ALTER SYSTEM is silently overridden.
#
# Applying it here instead keeps the ceiling in one place and adjustable. ALTER
# SYSTEM writes postgresql.auto.conf inside PGDATA, which lives on a volume, so
# it persists across restarts and costs no data — recreating the container would
# strand that volume and take every local realm database with it.
#
# The cost is one extra restart the first time a container is seen (a fresh one
# boots at postgres's default of 100), which is once per machine, or once per
# job in CI.
#
# Also repairs containers created before any of this existed, where the
# shortfall surfaces only under load: job rows failing with SQLSTATE 53300, and
# a realm-server that exits while the rest of the stack stays up.
#
# Best-effort throughout: postgres not being up yet, or a docker command
# failing, leaves the ceiling as-is rather than blocking the stack from booting.
pg_ensure_max_connections() {
  _pg_current=$(docker exec "$PG_CONTAINER" psql -U postgres -h 127.0.0.1 -tAc 'show max_connections;' 2>/dev/null | tr -d '[:space:]')
  case "$_pg_current" in
    '' | *[!0-9]*) return 0 ;;
  esac
  [ "$_pg_current" -ge "$PG_MAX_CONNECTIONS" ] && return 0

  echo "$PG_CONTAINER: max_connections is $_pg_current; raising to $PG_MAX_CONNECTIONS and restarting" >&2
  docker exec "$PG_CONTAINER" psql -U postgres -h 127.0.0.1 -q \
    -c "ALTER SYSTEM SET max_connections = $PG_MAX_CONNECTIONS;" >/dev/null 2>&1 || return 0
  docker restart "$PG_CONTAINER" >/dev/null 2>&1 || return 0
  pg_wait_ready
}
