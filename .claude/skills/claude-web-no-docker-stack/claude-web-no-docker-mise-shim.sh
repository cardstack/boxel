#!/usr/bin/env bash
# Stand-in for the real `mise` binary, for a session that cannot install one.
#
# The repo's tooling is file-based: every task under mise-tasks/ is a plain
# shell script whose only mise-specific parts are the `#MISE dir=` and
# `#MISE depends=` headers, plus the `[env] _.source` hook in .mise.toml. This
# reproduces those three behaviours and passes everything else through, so
# `mise run services:realm-server`, `mise run build:ui` and friends work as
# written.
#
# MISE_SHIM_SKIP is a space-separated list of task names to treat as no-ops.
# Set it to "infra:ensure-pg" when postgres runs natively rather than in the
# boxel-pg container.
#
# Install with: cp claude-web-no-docker-mise-shim.sh /usr/local/bin/mise && chmod +x /usr/local/bin/mise
set -uo pipefail

find_repo_root() {
  d="$PWD"
  while [ "$d" != "/" ]; do
    if [ -f "$d/.mise.toml" ]; then echo "$d"; return 0; fi
    d="$(dirname "$d")"
  done
  echo "${MISE_REPO_ROOT:-$PWD}"
}

REPO_ROOT="$(find_repo_root)"

load_env() {
  if [ -z "${MISE_SHIM_ENV_LOADED:-}" ]; then
    # shellcheck disable=SC1090
    . "$REPO_ROOT/mise-tasks/lib/env-vars.sh"
    export NODE_NO_WARNINGS=1
    export MISE_SHIM_ENV_LOADED=1
  fi
}

task_file() {
  echo "$REPO_ROOT/mise-tasks/$(echo "$1" | tr ':' '/')"
}

run_task() {
  # Locals, not globals: run_task recurses through `depends`, and a shared
  # `file` would leave the parent running its dependency a second time.
  local task file deps dir dep skipped
  task="$1"; shift
  for skipped in ${MISE_SHIM_SKIP:-}; do
    if [ "$task" = "$skipped" ]; then
      echo "[mise-shim] skipping $task"
      return 0
    fi
  done
  file="$(task_file "$task")"
  if [ ! -f "$file" ]; then
    echo "[mise-shim] no such task: $task" >&2
    return 127
  fi

  deps="$(grep -m1 '^#MISE depends=' "$file" | sed -E 's/^#MISE depends=\[(.*)\]$/\1/' | tr -d '"' | tr ',' ' ')"
  for dep in $deps; do
    run_task "$dep" || return $?
  done

  dir="$(grep -m1 '^#MISE dir=' "$file" | sed -E 's/^#MISE dir="?([^"]*)"?$/\1/')"
  (
    load_env
    cd "$REPO_ROOT"
    if [ -n "$dir" ]; then cd "$dir"; fi
    "$file" "$@"
  )
}

cmd="${1:-}"; shift || true
case "$cmd" in
  run)
    task="${1:-}"; shift || true
    if [ "${1:-}" = "--" ]; then shift; fi
    run_task "$task" "$@"
    ;;
  exec|x)
    while [ $# -gt 0 ] && [ "$1" != "--" ]; do shift; done
    [ "${1:-}" = "--" ] && shift
    load_env
    exec "$@"
    ;;
  activate)
    # `eval "$(mise activate bash)"` — no shell hook is needed, but the env
    # vars mise would export have to land in the calling shell.
    echo ". \"$REPO_ROOT/mise-tasks/lib/env-vars.sh\"; export NODE_NO_WARNINGS=1"
    ;;
  trust|install|reshim|settings|use)
    exit 0
    ;;
  --version|version)
    echo "mise-shim 0.0.0"
    ;;
  *)
    echo "[mise-shim] unsupported command: $cmd $*" >&2
    exit 1
    ;;
esac
