#!/bin/sh

# forcibly stop any isolated realm processes
isolated_realm_processes=$(ps -ef | grep ts-node | grep '\-\-port=4205' | awk '{print $2}')
for pid in $isolated_realm_processes; do
  kill -9 $pid
done
isolated_realm_processes=$(ps -ef | grep ts-node | grep '\-\-port=4212' | awk '{print $2}')
for pid in $isolated_realm_processes; do
  kill -9 $pid
done

echo "cleaning up old test databases..."
exit 0
docker exec -i boxel-pg psql -X -U postgres -d postgres -v ON_ERROR_STOP=0 <<'SQL'
\set AUTOCOMMIT on
COMMIT;

-- (optional) kick anyone out first (as separate statements)
SELECT format(
  'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %L AND pid <> pg_backend_pid();',
  datname
)
FROM pg_database
WHERE datname ~ '^test_db_'
  AND datname <> current_database()
ORDER BY datname
\gexec

-- now drop (ONE statement per row)
SELECT format('DROP DATABASE %I;', datname)
FROM pg_database
WHERE datname ~ '^test_db_'
  AND datname <> current_database()
ORDER BY datname
\gexec
SQL
echo "Cleaned up old test databases."