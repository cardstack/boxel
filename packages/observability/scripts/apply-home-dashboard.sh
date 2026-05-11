#!/usr/bin/env bash
# Set the org-wide default home dashboard to the Overview dashboard.
#
# Grafana has no file-provisioning shape for org preferences (data sources,
# dashboards, alerting, plugins are provisionable; preferences are not), so
# we PATCH /api/org/preferences directly. Org preferences are the default
# for users who haven't set a personal home dashboard — individual users
# can still override via their own user preferences.
#
# Usage:
#   ./scripts/apply-home-dashboard.sh --env <local|staging|production>
#
# Required env vars (staging / production only):
#   GRAFANA_TOKEN — service-account token (SecureString); the same token
#                   already used by grafanactl push and apply-datasources.sh.
#                   For local, basic-auth admin/admin from grafanactl/config.yaml
#                   is used (matches the docker-compose Grafana credentials).
#
# Idempotent: re-running pushes the same UID and Grafana 200s. Must run
# AFTER apply.sh's grafanactl push so the dashboard UID exists when this
# script references it — otherwise Grafana 400s on an unknown UID.
set -eo pipefail

usage_error() { echo "error: $1" >&2; exit 2; }
fail() { echo "error: $1" >&2; exit 1; }

# Hardcoded — the Overview dashboard's metadata.name (which is the UID
# under the App Platform shape) in grafanactl/resources/dashboards/
# boxel-status/overview.json. If that file's metadata.name ever changes,
# update this too. Lint's manifest-shape check ensures metadata.name is
# always present, so the value can't silently disappear.
HOME_DASHBOARD_UID="boxeloverview1"

env_name=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      [[ $# -ge 2 && "$2" != -* ]] || usage_error "--env requires a value"
      env_name="$2"
      shift 2
      ;;
    --env=*)
      env_name="${1#--env=}"
      [[ -n "$env_name" ]] || usage_error "--env requires a value"
      shift
      ;;
    *) usage_error "unknown option: $1";;
  esac
done

[[ -n "$env_name" ]] || usage_error "missing --env"

case "$env_name" in
  local | staging | production) ;;
  *) usage_error "--env must be local, staging, or production (got: $env_name)" ;;
esac

for cmd in yq jq curl; do
  command -v "$cmd" >/dev/null \
    || fail "missing dependency: ${cmd}. Install via brew (yq, jq) or apt (yq, jq)."
done

cd "$(dirname "$0")/.."

# Pull the per-env Grafana server URL from grafanactl's committed config so
# this script and grafanactl always agree on the target host. Same pattern
# as apply-datasources.sh / apply-alerting.sh.
grafana_server="$(yq -r ".contexts.${env_name}.grafana.server" grafanactl/config.yaml)"
[[ -n "$grafana_server" && "$grafana_server" != "null" ]] \
  || fail "couldn't resolve grafana server for context '${env_name}' from grafanactl/config.yaml"

# Auth: hosted envs use the SSM-sourced service-account token; local uses
# admin/admin basic auth from grafanactl/config.yaml (matches docker-compose).
auth_args=()
if [[ "$env_name" == "local" ]]; then
  user="$(yq -r ".contexts.local.grafana.user" grafanactl/config.yaml)"
  pass="$(yq -r ".contexts.local.grafana.password" grafanactl/config.yaml)"
  [[ -n "$user" && "$user" != "null" && -n "$pass" && "$pass" != "null" ]] \
    || fail "local context in grafanactl/config.yaml must define user + password"
  auth_args=(-u "${user}:${pass}")
else
  [[ -n "${GRAFANA_TOKEN:-}" ]] \
    || fail "GRAFANA_TOKEN not set; run \`source ./scripts/grafanactl-env.sh ${env_name}\` first"
  auth_args=(-H "Authorization: Bearer ${GRAFANA_TOKEN}")
fi

echo "apply-home-dashboard: env=${env_name} server=${grafana_server} uid=${HOME_DASHBOARD_UID}" >&2

# PATCH (not PUT) so any other org preferences set elsewhere — theme,
# timezone, weekStart, language — are preserved. Body is just the field
# we're changing.
body="$(jq -nc --arg uid "$HOME_DASHBOARD_UID" '{homeDashboardUID: $uid}')"

response="$(mktemp -t home-dashboard-response.XXXXXX)"
trap 'rm -f "$response"' EXIT
http_status="$(curl -sS -o "$response" -w '%{http_code}' -X PATCH \
  "${auth_args[@]}" \
  -H "Content-Type: application/json" \
  --data-binary "$body" \
  "${grafana_server}/api/org/preferences")"

case "$http_status" in
  2??)
    echo "  ↻ org home dashboard set to ${HOME_DASHBOARD_UID}" >&2
    ;;
  *)
    echo "  ✗ PATCH /api/org/preferences → HTTP ${http_status}" >&2
    sed 's/^/    /' "$response" >&2 || true
    fail "home-dashboard push failed"
    ;;
esac

echo "apply-home-dashboard: done" >&2
