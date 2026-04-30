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

# Pre-flight prereqs for hosted envs BEFORE grafanactl pushes anything.
# Otherwise a missing env var or absent yq would surface only after
# dashboards/folders had already been re-pushed, leaving a partial apply.
if [[ "$env_name" != "local" ]]; then
  for cmd in yq jq curl envsubst; do
    command -v "$cmd" >/dev/null \
      || { echo "error: missing dependency: ${cmd}" >&2; exit 1; }
  done
  required_env_vars=(
    GRAFANA_TOKEN
    # Loki — CS-10968
    LOKI_URL
    # Boxel-db postgres + synapse-prometheus — CS-10978
    BOXEL_DB_HOST
    BOXEL_DB_NAME
    BOXEL_DB_USER
    BOXEL_DB_PASSWORD
    SYNAPSE_PROMETHEUS_URL
    # Per-env realm-server base URL substituted into dashboards' realm_server
    # constant template variable — CS-10923
    REALM_SERVER_URL
  )
  for v in "${required_env_vars[@]}"; do
    [[ -n "${!v:-}" ]] \
      || { echo "error: ${v} not set; CI fetches it from SSM in observability-apply-${env_name}.yml — for a local hosted run, export it manually first (see apply-datasources.sh header for the SSM path)" >&2; exit 1; }
  done
fi

cfg="$(./scripts/render-config.sh "$env_name")"

# Render dashboards: copy the committed grafanactl/resources/ tree to a
# tempdir and substitute env-specific values into each dashboard's
# `templating.list[].query` for matching constant variables. Currently
# substitutes:
#   __REALM_SERVER_URL__  → REALM_SERVER_URL  (CS-10923)
# Local mode uses a hardcoded http://localhost:4201/ default so devs
# don't need any extra setup.
rendered="$(mktemp -d -t grafanactl-render.XXXXXX)"
trap 'rm -f "$cfg"; rm -rf "$rendered"' EXIT
cp -R ./grafanactl/resources/. "$rendered/"

case "$env_name" in
  local) realm_server_url="${REALM_SERVER_URL:-http://localhost:4201/}" ;;
  *)     realm_server_url="$REALM_SERVER_URL" ;;
esac

shopt -s globstar nullglob
for f in "$rendered"/dashboards/**/*.json; do
  [[ -f "$f" ]] || continue
  jq --arg url "$realm_server_url" '
    walk(
      if type == "object"
         and .name? == "realm_server"
         and .type? == "constant"
      then
        .query = $url
        | (if .current then .current.value = $url | .current.text = $url else . end)
      else . end
    )
  ' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done
shopt -u globstar nullglob

grafanactl \
  --config "$cfg" \
  --context "$env_name" \
  resources push \
  --path "$rendered" \
  "${forwarded_args[@]}"

# Data sources — grafanactl doesn't manage them, so push via HTTP API.
# Local skips this (docker-compose handles file provisioning).
./scripts/apply-datasources.sh --env "$env_name"
