#!/usr/bin/env bash
# Apply grafanactl resource manifests to a Grafana environment.
#
# Usage:
#   ./scripts/apply.sh [--env local|staging|production] [grafanactl push flags...]
#
# Examples:
#   ./scripts/apply.sh                          # local (default)
#   ./scripts/apply.sh --env staging --dry-run  # preview against staging
#   ./scripts/apply.sh --env staging            # apply to staging (CI does this on merge)
#
# Prereqs:
#   - grafanactl installed (brew install --formula grafanactl)
#   - For local: docker compose up -d grafana
#   - For staging/production: AWS credentials with ssm:GetParameter
set -eo pipefail

usage_error() { echo "error: $1" >&2; exit 2; }

env_name=local
forwarded_args=()
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
      # Anything else is forwarded to grafanactl push (e.g., --dry-run).
      forwarded_args+=("$1")
      shift
      ;;
  esac
done

cd "$(dirname "$0")/.."

# shellcheck source=./grafanactl-env.sh
source ./scripts/grafanactl-env.sh "$env_name"

cfg="$(./scripts/render-config.sh "$env_name")"
trap 'rm -f "$cfg"' EXIT

grafanactl \
  --config "$cfg" \
  --context "$env_name" \
  resources push \
  --path ./grafanactl/resources \
  "${forwarded_args[@]}"

# Data sources — grafanactl doesn't manage them, so push via HTTP API.
# Local skips this (docker-compose handles file provisioning).
./scripts/apply-datasources.sh --env "$env_name"
