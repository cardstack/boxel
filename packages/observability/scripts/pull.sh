#!/usr/bin/env bash
# Pull grafanactl resource manifests FROM a Grafana environment.
#
# Usage:
#   ./scripts/pull.sh --env <name> --path <dir> [grafanactl pull flags...]
#
# Examples:
#   ./scripts/pull.sh --env staging --path /tmp/staging-snapshot
#   ./scripts/pull.sh --env local   --path /tmp/local-snapshot --output yaml
#
# `--path` is required so a stray pull does not silently overwrite the
# committed `./grafanactl/resources/` source of truth. The CS-10933 diff
# workflow uses this against a tempdir.
#
# Prereqs:
#   - grafanactl installed (brew install --formula grafanactl)
#   - For staging/production: AWS credentials with ssm:GetParameter
set -euo pipefail

env_name=local
out_path=""
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
    --path | -p)
      out_path="$2"
      shift 2
      ;;
    --path=*)
      out_path="${1#--path=}"
      shift
      ;;
    *)
      forwarded_args+=("$1")
      shift
      ;;
  esac
done

if [[ -z "$out_path" ]]; then
  echo "error: --path <dir> is required (refusing to default to ./resources to avoid overwriting committed manifests)" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

# shellcheck source=./grafanactl-env.sh
source ./scripts/grafanactl-env.sh "$env_name"

exec grafanactl \
  --config ./grafanactl/config.yaml \
  --context "$env_name" \
  resources pull \
  --path "$out_path" \
  "${forwarded_args[@]}"
