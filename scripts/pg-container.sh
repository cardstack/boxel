#!/bin/sh
# Shared definition of the local `boxel-pg` postgres container: the pinned
# image, the settings it has to run with, and the helpers that bring it up and
# keep those settings true of a container that already exists.
#
# Two entry points start boxel-pg — packages/postgres/scripts/start-pg.sh
# (`pnpm start:pg`, symlinked from packages/realm-server/scripts) and
# mise-tasks/infra/ensure-pg — and both source this file so there is one
# definition to change rather than two to keep in step.
#
# Usage:
#   . "$(cd "$(dirname "$0")/../../.." && pwd)/scripts/pg-container.sh"
#   boxel_pg_ensure_running

BOXEL_PG_CONTAINER=boxel-pg

# If you bump postgres, also update the GHCR mirror so CI keeps caching it (it
# must match the version pinned there): .github/workflows/mirror-test-images.yml
# and .github/actions/warm-test-images/action.yml.
BOXEL_PG_IMAGE=postgres:16.3

# max_connections is raised well above postgres's default of 100: a single
# boxel-pg backs every service in a stack at once — realm servers plus their
# worker pools, and the matrix suite adds a second isolated stack on top of the
# base one — and each process opens its own pg pool (up to PG_POOL_MAX=40).
# That already clears half a dozen pools, and a burst that crosses the ceiling
# fails callers with "sorry, too many clients already".
BOXEL_PG_MAX_CONNECTIONS=400

# Run psql inside the container over TCP. The postgres:16.3 image does not
# always create the /var/run/postgresql unix socket, so a bare `psql -U postgres`
# can fail on the socket path; postgres listens on *:5432 with trust auth, so
# TCP works regardless.
boxel_pg_psql() {
  docker exec "$BOXEL_PG_CONTAINER" psql -h 127.0.0.1 -p 5432 -U postgres -w "$@"
}

# Probe over TCP for the same reason, plus one of its own: while the image
# initializes a fresh data directory it runs a temporary server bound to the
# socket only, so a socket probe reports ready during init and the next command
# lands on "the database system is shutting down". Only the real server listens
# on TCP.
boxel_pg_is_ready() {
  docker exec "$BOXEL_PG_CONTAINER" pg_isready -h 127.0.0.1 -p 5432 -U postgres >/dev/null 2>&1
}

# Wait for the container to accept TCP connections, up to $1 seconds (default
# 60). Returns non-zero on timeout rather than exiting, so a caller can decide
# whether that is fatal.
boxel_pg_wait_ready() {
  _bpg_remaining="${1:-60}"
  while ! boxel_pg_is_ready; do
    _bpg_remaining=$((_bpg_remaining - 1))
    if [ "$_bpg_remaining" -le 0 ]; then
      return 1
    fi
    sleep 1
  done
  return 0
}

# Bring max_connections up to BOXEL_PG_MAX_CONNECTIONS on a container that
# already exists.
#
# `docker start` reuses the container's original command, and neither entry
# point recreates a container it finds, so a boxel-pg created before the
# `-c max_connections` flag was added keeps postgres's default of 100 forever.
# Nothing about that is visible from the symptom side — jobs fail with
# "sorry, too many clients already" and the realm-server exits while the rest
# of the stack stays up — so repair it here rather than wait for someone to
# diagnose it.
#
# The repair is in place: ALTER SYSTEM writes postgresql.auto.conf inside
# PGDATA, which lives on the container's volume, so it survives restarts and
# outlives the container itself. Recreating the container instead would strand
# that volume and cost every local realm database plus a full reindex.
#
# Best-effort throughout: a machine this cannot repair is no worse off than it
# was, so every failure path just returns non-zero for the caller to ignore.
boxel_pg_repair_max_connections() {
  boxel_pg_wait_ready || return 1

  _bpg_current=$(boxel_pg_psql -tAc 'show max_connections' 2>/dev/null | tr -d '[:space:]')
  case "$_bpg_current" in
    '' | *[!0-9]*) return 1 ;;
  esac
  [ "$_bpg_current" -ge "$BOXEL_PG_MAX_CONNECTIONS" ] && return 0

  echo "boxel-pg is running with max_connections=$_bpg_current; raising it to $BOXEL_PG_MAX_CONNECTIONS."
  boxel_pg_psql -c "ALTER SYSTEM SET max_connections = $BOXEL_PG_MAX_CONNECTIONS" >/dev/null 2>&1 || return 1

  # max_connections only takes effect on restart, which drops every open
  # connection. Skip the restart while another stack is using this postgres and
  # let the setting apply the next time it comes up — the alternative is killing
  # a colleague process mid-index to fix a ceiling it has not hit yet.
  _bpg_clients=$(boxel_pg_psql -tAc \
    "select count(*) from pg_stat_activity where pid <> pg_backend_pid() and backend_type = 'client backend'" \
    2>/dev/null | tr -d '[:space:]')
  case "$_bpg_clients" in
    '' | *[!0-9]*) _bpg_clients=1 ;;
  esac
  if [ "$_bpg_clients" -gt 0 ]; then
    echo "boxel-pg has $_bpg_clients client connection(s) open, so it was left running; the new ceiling applies once it restarts."
    return 0
  fi

  docker restart "$BOXEL_PG_CONTAINER" >/dev/null 2>&1 || return 1
  boxel_pg_wait_ready || return 1
  echo "boxel-pg restarted with max_connections=$(boxel_pg_psql -tAc 'show max_connections' 2>/dev/null | tr -d '[:space:]')."
}

# Create the container if it is missing, start it, and make sure an existing one
# is running the settings above. Tolerates concurrent invocations — run-p and
# mise infra:ensure-pg can both call this at once — so losing the creation race
# is fine: `docker start` covers it.
boxel_pg_ensure_running() {
  _bpg_created=
  if [ -z "$(docker ps -f "name=$BOXEL_PG_CONTAINER" --all --format '{{.Names}}')" ]; then
    echo "Starting new $BOXEL_PG_CONTAINER container on port ${PGPORT:-5435}..."
    # Running postgres on 5435 so it doesn't collide with a native postgres
    # that may already be running on the machine.
    if docker run --name "$BOXEL_PG_CONTAINER" \
      -e POSTGRES_HOST_AUTH_METHOD=trust \
      -p "${PGPORT:-5435}":5432 \
      -d "$BOXEL_PG_IMAGE" \
      -c max_connections="$BOXEL_PG_MAX_CONNECTIONS" >/dev/null 2>&1; then
      _bpg_created=yes
    fi
  fi
  docker start "$BOXEL_PG_CONTAINER" >/dev/null 2>&1 || true

  # A container this call created already has the flag; only an inherited one
  # can have drifted.
  [ -n "$_bpg_created" ] || boxel_pg_repair_max_connections || true
}
