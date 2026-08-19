#!/usr/bin/env bash

set -euo pipefail

BASE_SHA=""
EVENT_NAME="${GITHUB_EVENT_NAME:-}"
if [[ -z "${GITHUB_OUTPUT:-}" ]]; then
  echo "GITHUB_OUTPUT is not set" >&2
  exit 1
fi

if [[ "$EVENT_NAME" == "pull_request" ]]; then
  if [[ -n "${PULL_REQUEST_BASE_SHA:-}" ]]; then
    BASE_SHA="$PULL_REQUEST_BASE_SHA"
  else
    echo "PULL_REQUEST_BASE_SHA is not set for pull_request event" >&2
    exit 1
  fi
elif [[ "$EVENT_NAME" == "push" && -n "${GITHUB_EVENT_BEFORE:-}" ]]; then
  BASE_SHA="$GITHUB_EVENT_BEFORE"
fi

if [[ -z "$BASE_SHA" ]]; then
  if git rev-parse HEAD^ >/dev/null 2>&1; then
    BASE_SHA="$(git rev-parse HEAD^)"
  else
    BASE_SHA="$(git rev-parse HEAD)"
  fi
fi

TARGET_SHA="${GITHUB_SHA:-}"
if [[ -z "$TARGET_SHA" ]]; then
  TARGET_SHA="$(git rev-parse HEAD)"
fi

echo "Using base SHA $BASE_SHA"

CHANGED="$(git diff --name-only --diff-filter=AM "$BASE_SHA" "$TARGET_SHA" -- 'packages/postgres/migrations/*.js' 'packages/postgres/migrations/*.ts' 'packages/postgres/migrations-removal/*.js' 'packages/postgres/migrations-removal/*.ts')"
echo "$CHANGED"

COUNT="$(printf '%s\n' "$CHANGED" | awk 'NF' | wc -l | tr -d ' ')"
echo "count=$COUNT" >> "$GITHUB_OUTPUT"
if [[ "$COUNT" -eq 0 ]]; then
  exit 0
fi

SORTED="$(printf '%s\n' "$CHANGED" | sort)"
echo "Changed migration files:"
printf '%s\n' "$SORTED"
{
  echo "files<<EOF"
  printf '%s\n' "$SORTED"
  echo "EOF"
} >> "$GITHUB_OUTPUT"

# Always roll back the full chain when any migration file changes, not
# just down to the earliest-changed migration. The narrower window left
# cross-migration interaction bugs latent — a non-idempotent DOWN in
# migration X only fails when a PR happens to edit a migration older
# than X, which could be months between triggers. Full rollback costs a
# few extra seconds per CI run but exercises every DOWN/UP cycle on
# every migration-touching PR.
# Match node-pg-migrate's own discovery: only timestamp-prefixed files
# count as migrations (excludes .eslintrc.js, README, etc.). Count BOTH phases
# (migrations/ + migrations-removal/) so the count reverts the entire combined
# chain — `pnpm migrate down` reverts that many across both phases.
TOTAL="$(find packages/postgres/migrations packages/postgres/migrations-removal -maxdepth 1 -type f \( -name '[0-9]*.js' -o -name '[0-9]*.ts' \) | wc -l | tr -d ' ')"
if [[ "$TOTAL" -eq 0 ]]; then
  echo "No migrations found in packages/postgres/migrations or migrations-removal" >&2
  exit 1
fi

echo "down_count=$TOTAL" >> "$GITHUB_OUTPUT"
echo "Will migrate down all $TOTAL migration(s) to exercise the full down/up chain"
