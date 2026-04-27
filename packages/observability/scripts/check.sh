#!/usr/bin/env bash
# Verify connectivity to a Grafana environment via `grafanactl config check`.
#
# Usage:
#   ./scripts/check.sh [--env local|staging|production]
#
# Wraps `grafanactl config check` so it picks up the rendered per-env config
# (with token substituted and current-context set correctly).
set -eo pipefail

usage_error() { echo "error: $1" >&2; exit 2; }

env_name=local
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      [[ $# -ge 2 && "$2" != --* ]] || usage_error "missing value for --env"
      env_name="$2"
      shift 2
      ;;
    --env=*)
      env_name="${1#--env=}"
      [[ -n "$env_name" ]] || usage_error "missing value for --env"
      shift
      ;;
    *)
      # No forwarding for check.sh — `grafanactl config check` takes no args.
      usage_error "unknown option: $1"
      ;;
  esac
done

cd "$(dirname "$0")/.."

# shellcheck source=./grafanactl-env.sh
source ./scripts/grafanactl-env.sh "$env_name"

cfg="$(./scripts/render-config.sh "$env_name")"
trap 'rm -f "$cfg"' EXIT

grafanactl --config "$cfg" --context "$env_name" config check
