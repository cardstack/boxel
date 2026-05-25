#! /bin/sh

# Local realm-server speaks HTTPS+HTTP/2 (see infra:ensure-dev-cert).
# `-k` skips cert verification — fine for a localhost script; in dev the
# cert is the mkcert leaf, and Node clients pick up trust via
# NODE_EXTRA_CA_CERTS but curl uses its own store.
AUTH_HEADER="Authorization: Bearer shhh! it's a secret"

echo "Starting full reindex of all realms on 4201..."
response=$(curl -sk -X POST -H "$AUTH_HEADER" "https://localhost:4201/_grafana-full-reindex")
echo "Indexing started for realms:"
echo "$response" | grep -oE '"https?://[^"]*"' | sed 's/"//g'

echo "Starting full reindex of all realms on 4202..."
response=$(curl -sk -X POST -H "$AUTH_HEADER" "https://localhost:4202/_grafana-full-reindex")
echo "Indexing started for realms:"
echo "$response" | grep -oE '"https?://[^"]*"' | sed 's/"//g'
