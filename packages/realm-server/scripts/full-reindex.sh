#! /bin/sh

echo "Starting full reindex of all realms..."
response=$(curl -s "http://localhost:4201/_grafana-full-reindex?authHeader=shhh!%20it%27s%20a%20secret")
echo "Indexing started for realms:"
echo "$response" | grep -o '"http://[^"]*"' | sed 's/"//g'
