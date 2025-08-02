#!/bin/sh

echo "Active PostgreSQL connections:"
docker exec boxel-pg psql -U postgres -c "
SELECT 
  COUNT(*) as total_connections,
  COUNT(CASE WHEN state = 'active' THEN 1 END) as active,
  COUNT(CASE WHEN state = 'idle' THEN 1 END) as idle,
  COUNT(CASE WHEN state = 'idle in transaction' THEN 1 END) as idle_in_transaction
FROM pg_stat_activity 
WHERE pid <> pg_backend_pid() AND datname IS NOT NULL;
"

echo ""
echo "Connections by database:"
docker exec boxel-pg psql -U postgres -c "
SELECT 
  datname,
  COUNT(*) as connections,
  string_agg(DISTINCT state, ', ') as states
FROM pg_stat_activity 
WHERE pid <> pg_backend_pid() AND datname IS NOT NULL
GROUP BY datname 
ORDER BY connections DESC;
"