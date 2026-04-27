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
set -euo pipefail

env_name=local
forwarded_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      env_name="$2"
      shift 2
      ;;
    --env=*)
      env_name="${1#--env=}"
      shift
      ;;
    *)
      forwarded_args+=("$1")
      shift
      ;;
  esac
done

cd "$(dirname "$0")/.."

# shellcheck source=./grafanactl-env.sh
source ./scripts/grafanactl-env.sh "$env_name"

exec grafanactl \
  --config ./grafanactl/config.yaml \
  --context "$env_name" \
  resources push \
  --path ./grafanactl/resources \
  "${forwarded_args[@]}"
