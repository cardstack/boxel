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

# Where the repair serializes itself. run-p starts three callers at once —
# start:pg, plus an infra:ensure-pg from each of start:development and
# start:worker-development — and without a lock each would restart postgres out
# from under the stack all three are booting.
BOXEL_PG_REPAIR_LOCK="${TMPDIR:-/tmp}/boxel-pg-max-connections.lock"

# The running ceiling, or empty if it can't be read.
boxel_pg_current_max_connections() {
  boxel_pg_psql -tAc 'show max_connections' 2>/dev/null | tr -d '[:space:]'
}

boxel_pg_max_connections_ok() {
  _bpg_current=$(boxel_pg_current_max_connections)
  case "$_bpg_current" in
    '' | *[!0-9]*) return 1 ;;
  esac
  [ "$_bpg_current" -ge "$BOXEL_PG_MAX_CONNECTIONS" ]
}

# The ceiling postgresql.conf / postgresql.auto.conf would produce on the next
# restart, or 0 when it can't be read. This is read from the files themselves
# on every call, so it reflects an ALTER SYSTEM immediately, with no reload.
# Highest seqno wins, the way postgres resolves the files; a row that is
# unparseable lands in the 0 case below, which asks for the ALTER anyway.
#
# Asked instead of pg_settings.pending_restart, which only says that *some*
# restart-requiring change is outstanding: a pending change to any other value
# looks identical to this repair's own, and gets restarted into. Note that a
# row awaiting a restart carries error = "setting could not be applied" and
# applied = f, so neither column can be used to filter for valid entries.
boxel_pg_configured_max_connections() {
  _bpg_configured=$(boxel_pg_psql -tAc \
    "select setting from pg_file_settings where name = 'max_connections' order by seqno desc limit 1" \
    2>/dev/null | tr -d '[:space:]')
  case "$_bpg_configured" in
    '' | *[!0-9]*) echo 0 ;;
    *) echo "$_bpg_configured" ;;
  esac
}

# True when max_connections is pinned on the container's command line. That
# beats postgresql.auto.conf, so for such a container a restart just brings the
# same value back and no in-place repair can raise it.
boxel_pg_max_connections_is_command_line() {
  [ "$(boxel_pg_psql -tAc \
    "select source = 'command line' from pg_settings where name = 'max_connections'" \
    2>/dev/null | tr -d '[:space:]')" = t ]
}

# Client backends other than the one asking.
boxel_pg_client_count() {
  _bpg_clients=$(boxel_pg_psql -tAc \
    "select count(*) from pg_stat_activity where pid <> pg_backend_pid() and backend_type = 'client backend'" \
    2>/dev/null | tr -d '[:space:]')
  case "$_bpg_clients" in
    '' | *[!0-9]*) return 1 ;;
  esac
  echo "$_bpg_clients"
}

# The repair proper. Only ever called with the lock held.
_boxel_pg_apply_max_connections() {
  # A caller that queued behind the winner arrives here with the work already
  # done: its wait-loop check could not see the new ceiling because postgres
  # was mid-restart and unreachable at the time.
  boxel_pg_max_connections_ok && return 0

  # A container whose command line pins the ceiling can only be raised by
  # recreating it, which would discard the data volume — every local realm
  # database plus a full reindex. Say so and leave it alone; restarting would
  # bring the same value back every time this ran.
  if boxel_pg_max_connections_is_command_line; then
    echo "boxel-pg has max_connections=$(boxel_pg_current_max_connections) pinned on its container command line, which overrides postgresql.auto.conf. Raising it to $BOXEL_PG_MAX_CONNECTIONS means recreating the container, discarding its databases, so it was left as it is." >&2
    return 1
  fi

  _bpg_altered=
  if [ "$(boxel_pg_configured_max_connections)" -lt "$BOXEL_PG_MAX_CONNECTIONS" ]; then
    echo "boxel-pg is running with max_connections=$(boxel_pg_current_max_connections); raising it to $BOXEL_PG_MAX_CONNECTIONS."
    boxel_pg_psql -c "ALTER SYSTEM SET max_connections = $BOXEL_PG_MAX_CONNECTIONS" >/dev/null 2>&1 || return 1
    _bpg_altered=yes
  fi

  _bpg_clients=$(boxel_pg_client_count) || return 1
  if [ "$_bpg_clients" -gt 0 ]; then
    # The new ceiling needs a restart, which drops every open connection. Leave
    # postgres alone while another stack is using it and let the setting apply
    # the next time it comes up, rather than killing a colleague process
    # mid-index over a ceiling it has not hit yet. Said once, when the drift is
    # found — every stack start until then would repeat it unprompted.
    [ -n "$_bpg_altered" ] && echo "boxel-pg has $_bpg_clients client connection(s) open, so it was left running; max_connections=$BOXEL_PG_MAX_CONNECTIONS applies once nothing is using it."
    return 0
  fi

  docker restart "$BOXEL_PG_CONTAINER" >/dev/null 2>&1 || return 1
  boxel_pg_wait_ready || return 1
  # Report what it actually came up with, and fail if that is not the target,
  # rather than assume the restart did what was asked.
  echo "boxel-pg restarted with max_connections=$(boxel_pg_current_max_connections)."
  boxel_pg_max_connections_ok
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

  # The check every already-correct machine pays, and nothing more.
  boxel_pg_max_connections_ok && return 0

  _bpg_waited=0
  while ! mkdir "$BOXEL_PG_REPAIR_LOCK" 2>/dev/null; do
    # Another caller is repairing; leave as soon as its restart lands.
    boxel_pg_max_connections_ok && return 0
    _bpg_waited=$((_bpg_waited + 1))
    if [ "$_bpg_waited" -ge 120 ]; then
      # A killed holder leaves the directory behind. Clear it so the next stack
      # start gets a turn instead of being blocked for good.
      rm -rf "$BOXEL_PG_REPAIR_LOCK" 2>/dev/null || true
      return 1
    fi
    sleep 1
  done

  _bpg_status=0
  _boxel_pg_apply_max_connections || _bpg_status=1
  rmdir "$BOXEL_PG_REPAIR_LOCK" 2>/dev/null || true
  return "$_bpg_status"
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
