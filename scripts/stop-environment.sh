#!/bin/sh
# Stop all processes for a given environment and clean up Traefik configs.
#
# Usage:
#   mise run stop-environment [environment-name]
#
# If no environment is given, uses $BOXEL_ENVIRONMENT or the current git branch.
# Pass --drop-db to also drop the per-environment databases.
# Pass --dry-run to preview what would be killed without taking action.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/env-slug.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Scan this worktree's `traefik/dynamic` plus whatever directory the
# running Traefik container actually bind-mounts (when start-traefik.sh
# reuses a container from another worktree, this env's services
# registered into that worktree's dir, not ours). Union, not either-or:
# the same slug can have files in both places if Traefik was bounced
# between registrations.
TRAEFIK_DIRS="$REPO_ROOT/traefik/dynamic"
MOUNTED="$(docker inspect boxel-traefik --format '{{range .Mounts}}{{if eq .Destination "/etc/traefik/dynamic"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
if [ -n "$MOUNTED" ] && [ -d "$MOUNTED" ] && [ "$MOUNTED" != "$REPO_ROOT/traefik/dynamic" ]; then
  TRAEFIK_DIRS="$TRAEFIK_DIRS
$MOUNTED"
fi

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

SLUG=$(compute_env_slug "$BRANCH")
DB_SLUG=$(pg_db_slug "$SLUG")

echo "Stopping all services for environment: $BRANCH (slug: $SLUG)"

# --- 1. Find and kill processes by environment slug in their arguments ---
# Match any process whose command line contains the environment slug followed by
# .localhost (Traefik hostnames) or as a path segment (realm paths).
# Also look up dynamic ports from Traefik configs to find processes (like the
# host app) that don't have the slug in their own arguments.
# Then walk the process tree to find child processes.
# Exclude this script itself and grep.

# Build a pattern that matches the slug in various contexts
MATCH_PATTERN="${SLUG}\.localhost|realms/${SLUG}|boxel_${DB_SLUG}|BOXEL_ENVIRONMENT=${BRANCH}"

# Extract dynamic ports from Traefik configs so we can match processes by port.
# Iterate via IFS=newline rather than `echo | while`, so MATCH_PATTERN updates
# stay in this shell (a piped `while` body runs in a subshell).
OLD_IFS="$IFS"
IFS='
'
for DIR in $TRAEFIK_DIRS; do
  [ -d "$DIR" ] || continue
  for f in "$DIR/${SLUG}"-*.yml; do
    [ -f "$f" ] || continue
    PORT=$(grep -oE 'host\.docker\.internal:[0-9]+' "$f" 2>/dev/null | head -1 | sed 's/.*://')
    if [ -n "$PORT" ]; then
      MATCH_PATTERN="${MATCH_PATTERN}|--port ${PORT}([^0-9]|$)"
    fi
  done
done
IFS="$OLD_IFS"

ROOT_PIDS=$(ps ax -o pid,command 2>/dev/null \
  | grep -E "($MATCH_PATTERN)" \
  | grep -v "grep" \
  | grep -v "stop-environment" \
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
REMOVED=0
OLD_IFS="$IFS"
IFS='
'
for DIR in $TRAEFIK_DIRS; do
  [ -d "$DIR" ] || continue
  for f in "$DIR/${SLUG}"-*.yml; do
    [ -f "$f" ] || continue
    if [ "$DRY_RUN" = true ]; then
      echo "  Would remove $f"
    else
      rm -f "$f"
      echo "  Removed $f"
    fi
    REMOVED=$((REMOVED + 1))
  done
done
IFS="$OLD_IFS"
if [ "$REMOVED" -gt 0 ]; then
  [ "$DRY_RUN" = true ] && echo "Would remove $REMOVED Traefik config file(s)." || echo "Removed $REMOVED Traefik config file(s)."
else
  echo "No Traefik configs found for environment $SLUG."
fi

# --- 4. Optionally drop per-environment databases ---
if [ "$DROP_DB" = true ]; then
  for DB_NAME in "boxel_${DB_SLUG}" "boxel_test_${DB_SLUG}"; do
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
