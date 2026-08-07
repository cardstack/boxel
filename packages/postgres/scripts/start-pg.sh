#! /bin/sh
# Start the boxel-pg container. Tolerates concurrent invocations (e.g. when
# run-p and mise ensure-pg both try to start postgres at the same time).
. "$(dirname "$0")/pg-settings.sh"

if [ -z "$(docker ps -f name=boxel-pg --all --format '{{.Names}}')" ]; then
  # running postgres on port 5435 so it doesn't collide with native postgres
  # that may be running on your system.
  # If you bump postgres, also update mise-tasks/infra/ensure-pg and the GHCR
  # mirror so CI keeps caching it (it must match the version pinned there):
  # .github/workflows/mirror-test-images.yml and
  # .github/actions/warm-test-images/action.yml.
  #
  # The connection ceiling is applied after start by pg_ensure_max_connections
  # rather than with `-c` here; see the rationale in pg-settings.sh.
  docker run --name boxel-pg -e POSTGRES_HOST_AUTH_METHOD=trust -p "${PGPORT:-5435}":5432 -d postgres:16.3 >/dev/null 2>&1 || true
fi
docker start boxel-pg >/dev/null 2>&1 || true

# Repair a container created before max_connections was raised. A no-op both
# when the ceiling is already high enough and when postgres isn't accepting
# connections yet — this script deliberately doesn't wait for readiness, and
# infra:ensure-pg runs the same check after its own wait.
pg_ensure_max_connections
