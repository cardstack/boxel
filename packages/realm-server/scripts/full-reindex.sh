#! /bin/sh

# Local realm-server speaks HTTPS+HTTP/2 (see infra:ensure-dev-cert).
# `-k` skips cert verification — fine for a localhost script; in dev the
# cert is the mkcert leaf, and Node clients pick up trust via
# NODE_EXTRA_CA_CERTS but curl uses its own store.
echo "Starting full reindex of all realms on 4201..."
response=$(curl -sk "https://localhost:4201/_grafana-full-reindex?authHeader=shhh!%20it%27s%20a%20secret")
echo "Indexing started for realms:"
echo "$response" | grep -oE '"https?://[^"]*"' | sed 's/"//g'

echo "Starting full reindex of all realms on 4202..."
response=$(curl -sk "https://localhost:4202/_grafana-full-reindex?authHeader=shhh!%20it%27s%20a%20secret")
echo "Indexing started for realms:"
echo "$response" | grep -oE '"https?://[^"]*"' | sed 's/"//g'
