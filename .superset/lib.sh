#!/usr/bin/env bash
# Shared helpers for the Superset lifecycle scripts (setup, teardown, run).
#
# Each Superset workspace is its own git worktree, and runs its dev stack in
# Boxel's environment mode (see "Environment mode: parallel environments" in
# README.md): services bind dynamic ports and register with the shared Traefik
# under `*.<slug>.localhost`, with a database of their own. The slug is derived
# from the workspace directory rather than the branch, so it stays stable when
# an agent checks out a ticket branch inside the workspace, and teardown stops
# exactly what run started.

WORKSPACE_PATH="${SUPERSET_WORKSPACE_PATH:-$(git rev-parse --show-toplevel)}"
ROOT_PATH="${SUPERSET_ROOT_PATH:-$(git -C "$WORKSPACE_PATH" worktree list --porcelain | sed -n '1s/^worktree //p')}"

. "$WORKSPACE_PATH/scripts/env-slug.sh"
BOXEL_ENVIRONMENT="${BOXEL_ENVIRONMENT:-$(compute_env_slug "$(basename "$WORKSPACE_PATH")")}"
export BOXEL_ENVIRONMENT

# Per-workspace state that must not be committed lives in the worktree's own
# git dir, which git never tracks and which goes away with the worktree.
STATE_DIR="$(git -C "$WORKSPACE_PATH" rev-parse --absolute-git-dir)/superset"
mkdir -p "$STATE_DIR"

is_root_checkout() {
  [ "$(cd "$WORKSPACE_PATH" && pwd -P)" = "$(cd "$ROOT_PATH" && pwd -P)" ]
}

log() {
  echo "[superset] $*"
}
