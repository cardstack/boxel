#!/usr/bin/env bash
# Verify connectivity to a Grafana environment via `grafanactl config check`.
#
# Usage:
#   ./scripts/check.sh [--env local|staging|production]
#
# Wraps `grafanactl config check` so it picks up the rendered per-env config
# (with token substituted and current-context set correctly).
set -euo pipefail

env_name=local
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) env_name="$2"; shift 2 ;;
    --env=*) env_name="${1#--env=}"; shift ;;
    *) shift ;;
  esac
done

cd "$(dirname "$0")/.."

# shellcheck source=./grafanactl-env.sh
source ./scripts/grafanactl-env.sh "$env_name"

cfg="$(./scripts/render-config.sh "$env_name")"
trap 'rm -f "$cfg"' EXIT

grafanactl --config "$cfg" --context "$env_name" config check
