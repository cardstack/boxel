#!/bin/sh

# forcibly stop any isolated realm processes
isolated_realm_processes=$(ps -ef | grep ts-node | grep '\-\-port=4205' | awk '{print $2}')
for pid in $isolated_realm_processes; do
  kill -9 $pid
done

databases=$(docker exec boxel-pg psql -U postgres -w -lqt | cut -d \| -f 1 | grep -E 'test_db_' | tr -d ' ')
echo "cleaning up old test databases..."
for db in $databases; do
  docker exec boxel-pg dropdb -U postgres -w $db
done
