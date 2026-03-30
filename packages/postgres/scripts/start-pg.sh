#! /bin/sh
# Start the boxel-pg container. Tolerates concurrent invocations (e.g. when
# run-p and mise ensure-pg both try to start postgres at the same time).
if [ -z "$(docker ps -f name=boxel-pg --all --format '{{.Names}}')" ]; then
  # running postgres on port 5435 so it doesn't collide with native postgres
  # that may be running on your system
  docker run --name boxel-pg -e POSTGRES_HOST_AUTH_METHOD=trust -p "${PGPORT:-5435}":5432 -d postgres:16.3 >/dev/null 2>&1 || true
fi
docker start boxel-pg >/dev/null 2>&1 || true
