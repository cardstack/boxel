#!/bin/sh
# Stop all processes for a given environment and clean up Traefik configs.
#
# Usage:
#   ./scripts/stop-branch.sh [environment-name]
#
# If no environment is given, uses $BOXEL_ENVIRONMENT or the current git branch.
# Pass --drop-db to also drop the per-environment databases.
# Pass --dry-run to preview what would be killed without taking action.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TRAEFIK_DIR="$REPO_ROOT/traefik/dynamic"

DROP_DB=false
DRY_RUN=false
BRANCH=""

for arg in "$@"; do
  case "$arg" in
    --drop-db) DROP_DB=true ;;
    --dry-run) DRY_RUN=true ;;
    -*) echo "Unknown option: $arg" >&2; exit 1 ;;
    *) BRANCH="$arg" ;;
  esac
done

if [ -z "$BRANCH" ]; then
  BRANCH="${BOXEL_ENVIRONMENT:-$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo '')}"
fi

if [ -z "$BRANCH" ]; then
  echo "Error: no environment specified and could not detect current environment." >&2
  echo "Usage: $0 [environment-name]" >&2
  exit 1
fi

SLUG=$(echo "$BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')

echo "Stopping all services for environment: $BRANCH (slug: $SLUG)"

# --- 1. Find and kill processes by environment slug in their arguments ---
# Match any process whose command line contains the environment slug followed by
# .localhost (Traefik hostnames) or as a path segment (realm paths).
# Then walk the process tree to also find child processes (prerender, icons,
# host app, etc.) that don't have the slug in their own arguments.
# Exclude this script itself and grep.
ROOT_PIDS=$(ps ax -o pid,command 2>/dev/null \
  | grep -E "(${SLUG}\.localhost|realms/${SLUG}|boxel_${SLUG}|BOXEL_ENVIRONMENT=${BRANCH})" \
  | grep -v "grep" \
  | grep -v "stop-branch" \
  | grep -v "shell-snapshots" `# exclude Claude Code shell wrappers` \
  | awk '{print $1}' \
  | sort -u)

# Collect all descendant PIDs iteratively using pgrep
ALL_PIDS="$ROOT_PIDS"
QUEUE="$ROOT_PIDS"
DEPTH=0
while [ -n "$QUEUE" ] && [ "$DEPTH" -lt 20 ]; do
  DEPTH=$((DEPTH + 1))
  NEXT_QUEUE=""
  for pid in $QUEUE; do
    CHILDREN=$(pgrep -P "$pid" 2>/dev/null || true)
    if [ -n "$CHILDREN" ]; then
      ALL_PIDS="$ALL_PIDS
$CHILDREN"
      NEXT_QUEUE="$NEXT_QUEUE
$CHILDREN"
    fi
  done
  QUEUE=$(echo "$NEXT_QUEUE" | sed '/^$/d')
done

# Deduplicate
PIDS=$(echo "$ALL_PIDS" | grep -v '^$' | sort -un | tr '\n' ' ')

if [ -n "$PIDS" ]; then
  COUNT=$(echo "$PIDS" | wc -w | tr -d ' ')

  if [ "$DRY_RUN" = true ]; then
    echo "Would kill $COUNT process(es):"
    for pid in $PIDS; do
      CMD=$(ps -o command= -p "$pid" 2>/dev/null | head -c 120)
      echo "  $pid: $CMD"
    done
  else
    echo "Found $COUNT process(es) (including children). Sending SIGTERM..."
    echo "$PIDS" | xargs kill 2>/dev/null || true

    # Give processes a moment to shut down gracefully
    sleep 2

    # Check for survivors and force kill
    SURVIVORS=""
    for pid in $PIDS; do
      if kill -0 "$pid" 2>/dev/null; then
        SURVIVORS="$SURVIVORS $pid"
      fi
    done

    if [ -n "$SURVIVORS" ]; then
      echo "Force killing remaining processes:$SURVIVORS"
      echo "$SURVIVORS" | xargs kill -9 2>/dev/null || true
    fi

    echo "All processes stopped."
  fi
else
  echo "No running processes found for environment $SLUG."
fi

# --- 2. Stop per-environment Synapse container ---
SYNAPSE_CONTAINER="boxel-synapse-${SLUG}"
if docker ps -a --format '{{.Names}}' | grep -qx "$SYNAPSE_CONTAINER"; then
  if [ "$DRY_RUN" = true ]; then
    echo "Would stop Synapse container: $SYNAPSE_CONTAINER"
  else
    echo "Stopping Synapse container: $SYNAPSE_CONTAINER"
    docker stop "$SYNAPSE_CONTAINER" 2>/dev/null || true
  fi
else
  echo "No Synapse container found for environment $SLUG."
fi

# --- 3. Clean up Traefik dynamic config files ---
if [ -d "$TRAEFIK_DIR" ]; then
  REMOVED=0
  for f in "$TRAEFIK_DIR/${SLUG}"-*.yml; do
    [ -f "$f" ] || continue
    if [ "$DRY_RUN" = true ]; then
      echo "  Would remove $(basename "$f")"
    else
      rm -f "$f"
      echo "  Removed $(basename "$f")"
    fi
    REMOVED=$((REMOVED + 1))
  done
  if [ "$REMOVED" -gt 0 ]; then
    [ "$DRY_RUN" = true ] && echo "Would remove $REMOVED Traefik config file(s)." || echo "Removed $REMOVED Traefik config file(s)."
  else
    echo "No Traefik configs found for environment $SLUG."
  fi
fi

# --- 4. Optionally drop per-environment databases ---
if [ "$DROP_DB" = true ]; then
  for DB_NAME in "boxel_${SLUG}" "boxel_test_${SLUG}"; do
    if docker exec boxel-pg psql -U postgres -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
      if [ "$DRY_RUN" = true ]; then
        echo "Would drop database $DB_NAME"
      else
        echo "Dropping database $DB_NAME..."
        docker exec boxel-pg dropdb -U postgres "$DB_NAME"
      fi
    fi
  done
fi

echo "Done."
