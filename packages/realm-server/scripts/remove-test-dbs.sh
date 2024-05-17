#!/bin/sh

databases=$(docker exec boxel-pg psql -U postgres -w -lqt | cut -d \| -f 1 | grep -E 'test_db_' | tr -d ' ')

echo "cleaning up old test databases..."
for db in $databases; do
  docker exec boxel-pg dropdb -U postgres -w $db
done
