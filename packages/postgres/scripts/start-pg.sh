#! /bin/sh
# Start the boxel-pg container. Tolerates concurrent invocations (e.g. when
# run-p and mise ensure-pg both try to start postgres at the same time).
if [ -z "$(docker ps -f name=boxel-pg --all --format '{{.Names}}')" ]; then
  # running postgres on port 5435 so it doesn't collide with native postgres
  # that may be running on your system.
  # If you bump postgres, also update mise-tasks/infra/ensure-pg and the GHCR
  # mirror so CI keeps caching it (it must match the version pinned there):
  # .github/workflows/mirror-test-images.yml and
  # .github/actions/warm-test-images/action.yml.
  #
  # max_connections is raised well above postgres's default of 100: a single
  # boxel-pg backs every service in a test stack at once — realm servers plus
  # their worker pools, and the matrix suite adds a second isolated stack on
  # top of the base one — and each process opens its own pg pool (up to
  # PG_POOL_MAX=40). Six such pools already exceed the default ceiling, and a
  # burst that crosses it fails callers with "sorry, too many clients
  # already". Keep this in sync with mise-tasks/infra/ensure-pg.
  docker run --name boxel-pg -e POSTGRES_HOST_AUTH_METHOD=trust -p "${PGPORT:-5435}":5432 -d postgres:16.3 -c max_connections=300 >/dev/null 2>&1 || true
fi
docker start boxel-pg >/dev/null 2>&1 || true
