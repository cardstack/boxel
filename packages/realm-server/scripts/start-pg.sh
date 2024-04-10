#! /bin/sh
if [ -z "$(docker ps -f name=boxel-pg --all --format '{{.Names}}')" ]; then
  # running postgres on port 5435 so it doesn't collide with native postgres
  # that may be running on your system
  docker run --name boxel-pg -e POSTGRES_PASSWORD=postgres -p 5435:5432 -d postgres >/dev/null
else
  docker start boxel-pg >/dev/null
fi
