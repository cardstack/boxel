#! /bin/sh

AUTH_HEADER="Authorization: Bearer shhh! it's a secret"

echo "Starting full reindex of all realms on 4201..."
response=$(curl -s -X POST -H "$AUTH_HEADER" "http://localhost:4201/_grafana-full-reindex")
echo "Indexing started for realms:"
echo "$response" | grep -o '"http://[^"]*"' | sed 's/"//g'

echo "Starting full reindex of all realms on 4202..."
response=$(curl -s -X POST -H "$AUTH_HEADER" "http://localhost:4202/_grafana-full-reindex")
echo "Indexing started for realms:"
echo "$response" | grep -o '"http://[^"]*"' | sed 's/"//g'
