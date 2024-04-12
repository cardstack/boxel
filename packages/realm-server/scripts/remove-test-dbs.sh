#!/bin/sh

databases=$(docker exec boxel-pg psql -U postgres -w -lqt | cut -d \| -f 1 | grep -E 'test_db_' | tr -d ' ')

for db in $databases; do
  docker exec boxel-pg dropdb -U postgres -w $db
done
