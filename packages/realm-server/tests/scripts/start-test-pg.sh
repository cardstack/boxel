#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/test-pg-config.sh"

if [ ! -f "$TEST_PG_SEED_TAR" ]; then
  echo "Seed tar not found at $TEST_PG_SEED_TAR. Run ./tests/scripts/create_seeded_db.sh first." >&2
  exit 1
fi

docker rm -f "$TEST_PG_CONTAINER" >/dev/null 2>&1 || true

start_container() {
  docker run -d \
    --name "$TEST_PG_CONTAINER" \
    -p "127.0.0.1:${TEST_PG_PORT}:5432" \
    --tmpfs /var/lib/postgresql/data:rw \
    -e POSTGRES_HOST_AUTH_METHOD=trust \
    -v "${TEST_PG_SEED_TAR}:/seed/pgdata.tar:ro" \
    -v "${SCRIPT_DIR}/boot_preseeded.sh:/usr/local/bin/pg-seeded-tmpfs-entrypoint.sh:ro" \
    --entrypoint /bin/sh \
    postgres:16.3-alpine \
    -c /usr/local/bin/pg-seeded-tmpfs-entrypoint.sh
}

print_start_diagnostics() {
  echo "=== Docker containers ===" >&2
  docker ps -a >&2 || true

  echo "=== Matching test containers ===" >&2
  docker ps -a \
    --filter "name=${TEST_PG_CONTAINER}" \
    --filter "name=${TEST_PG_SEED_CONTAINER}" >&2 || true

  # Show sockets in ANY state on the port, not just LISTEN: when the bind fails
  # with "address already in use" but nothing is LISTENing, the port is not held
  # by a userland socket at all — it is Docker's own docker-proxy / NAT state
  # from a just-removed container that has not finished tearing down.
  echo "=== Port ${TEST_PG_PORT} sockets (all states) ===" >&2
  if command -v ss >/dev/null 2>&1; then
    ss -tanp "( sport = :${TEST_PG_PORT} or dport = :${TEST_PG_PORT} )" >&2 || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${TEST_PG_PORT}" >&2 || true
  else
    echo "Neither ss nor lsof is available for port diagnostics" >&2
  fi

  # A lingering DNAT rule for the port is the fingerprint of the teardown race:
  # docker-proxy is gone but the netfilter rule that reserves the host port has
  # not been reaped yet. Surface it so a future failure is diagnosable at a glance.
  # Match the port as a whole word (grep -w) so it catches every rendering
  # (`--dport 55436` from iptables -S, `dpt:55436` from -L, bare `55436` from
  # nft) without matching 554360 — and stays portable, since \b as a word
  # boundary is a GNU-grep extension, not POSIX ERE.
  echo "=== Docker NAT rules for :${TEST_PG_PORT} ===" >&2
  if command -v iptables >/dev/null 2>&1; then
    { iptables -t nat -S 2>/dev/null || sudo -n iptables -t nat -S 2>/dev/null; } \
      | grep -w "${TEST_PG_PORT}" >&2 \
      || echo "(no matching iptables NAT rule)" >&2
  fi
  if command -v nft >/dev/null 2>&1; then
    { nft list ruleset 2>/dev/null || sudo -n nft list ruleset 2>/dev/null; } \
      | grep -w "${TEST_PG_PORT}" >&2 || true
  fi

  echo "=== ${TEST_PG_CONTAINER} logs (if present) ===" >&2
  docker logs "$TEST_PG_CONTAINER" >&2 || true
}

# Clear whatever a failed `docker run` left behind before the next attempt.
reap_port_holder() {
  # The failed run leaves the container in "Created" state (it never got its
  # network sandbox), so remove it to start the next attempt clean.
  docker rm -f "$TEST_PG_CONTAINER" >/dev/null 2>&1 || true

  # Almost always the port is held by Docker's netfilter/proxy state rather than
  # a live process, so this rarely fires. When something IS bound to the port,
  # only reap it if it is unambiguously a stale docker-proxy for THIS port — a
  # developer's unrelated service (or another test Postgres) must be left alone
  # to surface as diagnostics, never killed.
  if command -v ss >/dev/null 2>&1; then
    local holder_pid holder_cmd holder_args
    holder_pid="$(ss -H -tanp "( sport = :${TEST_PG_PORT} )" 2>/dev/null \
      | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true)"
    if [ -n "${holder_pid:-}" ]; then
      holder_cmd="$(ps -o comm= -p "$holder_pid" 2>/dev/null || true)"
      holder_args="$(tr '\0' ' ' < "/proc/${holder_pid}/cmdline" 2>/dev/null || true)"
      if [ "$holder_cmd" = "docker-proxy" ] \
        && printf '%s' "$holder_args" | grep -q -- "-host-port ${TEST_PG_PORT}"; then
        echo "Reaping stale docker-proxy (pid ${holder_pid}) for 127.0.0.1:${TEST_PG_PORT}" >&2
        kill "$holder_pid" 2>/dev/null || true
      else
        echo "Port ${TEST_PG_PORT} held by non-docker-proxy pid ${holder_pid} (${holder_cmd:-unknown}); leaving it alone" >&2
      fi
    fi
  fi
}

# On "address already in use" with no listener, the port is pinned by Docker's
# own docker-proxy / iptables-DNAT teardown lagging behind a just-removed
# container (the seed-build container is torn down immediately before this bind).
# There is nothing to reap in userland — dockerd just needs a quiet window to
# finish reconciling. A fixed 1s retry keeps the daemon churning and never lets
# it settle, so back off with escalating waits and give it real room.
cid=""
start_err=""
container_ref="$TEST_PG_CONTAINER"
max_attempts=6
attempt=1
while [ "$attempt" -le "$max_attempts" ]; do
  start_err_file="$(mktemp)"
  if cid="$(start_container 2>"$start_err_file")"; then
    start_err="$(cat "$start_err_file")"
    rm -f "$start_err_file"
    if printf '%s' "$cid" | grep -Eq '^[0-9a-f]{12,64}$'; then
      container_ref="$cid"
    fi
    break
  fi
  start_err="$(cat "$start_err_file")"
  rm -f "$start_err_file"

  if printf '%s' "$start_err" | grep -qi 'address already in use'; then
    if [ "$attempt" -lt "$max_attempts" ]; then
      backoff=$((attempt * 2))
      [ "$backoff" -gt 8 ] && backoff=8
      echo "Port ${TEST_PG_PORT} reported in use (no listener = Docker teardown race), reaping and waiting ${backoff}s before retry (${attempt}/${max_attempts})..." >&2
      reap_port_holder
      sleep "$backoff"
      attempt=$((attempt + 1))
      continue
    fi
  fi

  print_start_diagnostics
  echo "$start_err" >&2
  exit 1
done

if [ -z "$cid" ]; then
  echo "Failed to start $TEST_PG_CONTAINER after ${max_attempts} attempts" >&2
  print_start_diagnostics
  exit 1
fi

"${SCRIPT_DIR}/wait-for-container-pg.sh" "$TEST_PG_CONTAINER" "$container_ref"

# Sanity check the migrated DB exists in the seeded cluster.
seed_db_present="$(docker exec "$TEST_PG_CONTAINER" psql -h 127.0.0.1 -U postgres -d postgres -Atqc \
  "select datname from pg_database where datname = '${TEST_PG_SEED_DB}'")"
if [ "$seed_db_present" != "$TEST_PG_SEED_DB" ]; then
  echo "Expected seeded DB '${TEST_PG_SEED_DB}' to exist in $TEST_PG_CONTAINER" >&2
  docker logs "$container_ref" >&2 || true
  exit 1
fi

echo "Started $TEST_PG_CONTAINER on 127.0.0.1:${TEST_PG_PORT}"
