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

CHANGED="$(git diff --name-only --diff-filter=AM "$BASE_SHA" "$TARGET_SHA" -- 'packages/postgres/migrations/*.js' 'packages/postgres/migrations/*.ts')"
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

EARLIEST_CHANGED="$(printf '%s\n' "$SORTED" | head -n 1)"
if [[ -z "$EARLIEST_CHANGED" ]]; then
  echo "Could not determine earliest changed migration" >&2
  exit 1
fi

EARLIEST_BASENAME="$(basename "$EARLIEST_CHANGED")"

ALL_MIGRATIONS="$(find packages/postgres/migrations -maxdepth 1 -type f \( -name '*.js' -o -name '*.ts' \) | sort)"
if [[ -z "$ALL_MIGRATIONS" ]]; then
  echo "No migrations found in packages/postgres/migrations" >&2
  exit 1
fi

TOTAL=0
EARLIEST_INDEX=0
while IFS= read -r FILE; do
  [[ -z "$FILE" ]] && continue
  TOTAL=$((TOTAL + 1))
  if [[ "$EARLIEST_INDEX" -eq 0 && "$(basename "$FILE")" == "$EARLIEST_BASENAME" ]]; then
    EARLIEST_INDEX=$TOTAL
  fi
done <<< "$ALL_MIGRATIONS"

if [[ "$EARLIEST_INDEX" -eq 0 ]]; then
  echo "Unable to locate changed migration $EARLIEST_BASENAME in migration list" >&2
  exit 1
fi

DOWN_COUNT=$((TOTAL - EARLIEST_INDEX + 1))
echo "down_count=$DOWN_COUNT" >> "$GITHUB_OUTPUT"
echo "Will migrate down $DOWN_COUNT migration(s) to cover earliest changed migration"
