#!/bin/bash
# Drops an already-migrated Synapse database into this environment's data dir,
# so Synapse boots by opening it instead of applying its schema from scratch.
#
# Measured on a host shard: Synapse takes ~52s from container start to
# answering its healthcheck, and `create realm users` does nothing but wait for
# that. Nearly all of it is first-run migrations against an empty SQLite file.
#
# No `set -e`: everything here is an optimization. A miss — no artifact, an
# expired one, no gh CLI — must leave the shard booting Synapse exactly as it
# did before, so failures are reported and the script still exits 0.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/env-slug.sh"

REPO="cardstack/boxel"
# Which branch's runs to take the bake from. Defaults to main, where the
# producer runs; overridable so a branch iterating on this machinery can
# consume its own artifact without merging first.
BRANCH="${SYNAPSE_CACHE_BRANCH:-main}"

skip() {
  echo "[synapse-db-cache] $1 — Synapse will migrate from scratch"
  exit 0
}

if [ -n "${BOXEL_ENVIRONMENT:-}" ]; then
  DATA_DIR="$SCRIPT_DIR/../packages/matrix/synapse-data-$(resolve_env_slug)"
else
  DATA_DIR="$SCRIPT_DIR/../packages/matrix/synapse-data"
fi
DB_PATH="$DATA_DIR/db/homeserver.db"

# `start-synapse.sh` creates the data dir on its way up, so finding a database
# already here means Synapse has run in this workspace. Replacing it would
# throw away state the caller may be relying on.
if [ -s "$DB_PATH" ]; then
  skip "a database is already present at $DB_PATH"
fi

if ! command -v gh >/dev/null 2>&1; then
  skip "gh CLI not found"
fi

KEY=$("$SCRIPT_DIR/synapse-cache-key.sh") || skip "could not compute the cache key"
ARTIFACT="boxel-synapse-db-${KEY}"

# The key is in the artifact name, so a checkout whose Synapse config or image
# tag differs simply finds nothing — no separate staleness gate to keep in
# step with what actually affects the schema.
RUN_IDS=$(gh run list -w ci-host.yaml -b "$BRANCH" -L 10 \
  --json databaseId -q '.[].databaseId' -R "$REPO" 2>/dev/null) || RUN_IDS=""
[ -n "$RUN_IDS" ] || skip "no recent CI Host runs on $BRANCH"

DOWNLOAD_DIR="/tmp/synapse-db-cache-$$"
trap 'rm -rf "$DOWNLOAD_DIR"' EXIT

# Runs are walked rather than pinning to the newest, because the producer job
# is skipped on runs that did not need it, and because a run can be red for
# reasons that have nothing to do with whether it published this artifact.
START=$(date +%s)
FOUND=""
for RUN_ID in $RUN_IDS; do
  if gh run download "$RUN_ID" -n "$ARTIFACT" -D "$DOWNLOAD_DIR" -R "$REPO" 2>/dev/null; then
    FOUND="$RUN_ID"
    break
  fi
  rm -rf "$DOWNLOAD_DIR"
done
[ -n "$FOUND" ] || skip "no $ARTIFACT in the last 10 CI Host runs on $BRANCH"

GZ="$DOWNLOAD_DIR/homeserver.db.gz"
[ -f "$GZ" ] || skip "artifact $ARTIFACT did not contain homeserver.db.gz"

mkdir -p "$DATA_DIR/db"
if ! gunzip -c "$GZ" > "$DB_PATH"; then
  # A half-written database is worse than none: Synapse would open it and fail
  # in a way that reads as a Synapse bug rather than a bad cache.
  rm -f "$DB_PATH"
  skip "could not unpack the cached database"
fi

echo "[synapse-db-cache] restored $ARTIFACT from run $FOUND in $(( $(date +%s) - START ))s ($(du -h "$DB_PATH" | cut -f1))"
