#!/bin/sh

if docker exec boxel-pg psql -U postgres -w -lqt | cut -d \| -f 1 | grep -qw "$PGDATABASE"; then
  echo "Database $PGDATABASE exists"
else
  docker exec boxel-pg psql -U postgres -w -c "CREATE DATABASE $PGDATABASE"
  echo "created database $PGDATABASE"
fi
