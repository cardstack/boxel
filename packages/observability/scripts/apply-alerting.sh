#!/usr/bin/env bash
# Push alert rule groups in `provisioning/alerting/` to a hosted Grafana
# via the provisioning HTTP API. grafanactl doesn't manage alert rules
# (its `resources list` covers App Platform kinds only — dashboards,
# folders, playlists, etc.), and locally docker-compose mounts
# `provisioning/alerting/` into the container so Grafana provisions from
# the file directly. This script only runs against staging / production.
#
# Usage:
#   ./scripts/apply-alerting.sh --env <local|staging|production>
#
# Required env vars (staging / production only). The CI apply workflow
# (.github/workflows/observability-apply-{staging,production}.yml) fetches
# GRAFANA_TOKEN from SSM and exports it to $GITHUB_ENV. For a local hosted
# run, source ./scripts/grafanactl-env.sh first.
#
#   GRAFANA_TOKEN — service-account token (SecureString)
#
# What it pushes:
#   - Each `.json` in `provisioning/alerting/` is read as the standard
#     Grafana file-provisioning shape (`apiVersion: 1` + `groups: [...]`).
#   - For each group, env-var references like `${VAR}` are substituted
#     from the current shell environment (no placeholders today, but the
#     pattern matches apply-datasources.sh so future log-group / RDS
#     instance / datasource-uid parameterization slots in cleanly).
#   - The result is upserted via PUT
#     `/api/v1/provisioning/folder/{folderUID}/rule-groups/{group}` with
#     header `X-Disable-Provenance: true` so each rule stays UI-editable
#     between pushes (file is canonical; UI edits get overwritten on the
#     next apply — same trade-off as apply-datasources.sh).
#
# Caveats:
#   - The Grafana provisioning API expects an AlertRuleGroup body of
#     `{title, folderUid, interval, rules}` with `interval` as integer
#     seconds. The file format uses `name`, `folder`, and a duration
#     string like "60s" — this script normalizes those.
#   - rules[].uid in the file is preserved on PUT, so re-applies are
#     idempotent (same uid → in-place update, not a duplicate rule).
set -eo pipefail

usage_error() { echo "error: $1" >&2; exit 2; }
fail() { echo "error: $1" >&2; exit 1; }

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
  local)
    echo "apply-alerting: local — skipped (file provisioning handles it)" >&2
    exit 0
    ;;
  staging | production)
    ;;
  *)
    usage_error "--env must be local, staging, or production (got: $env_name)"
    ;;
esac

for cmd in yq jq curl envsubst; do
  command -v "$cmd" >/dev/null \
    || fail "missing dependency: ${cmd}. Install via brew (yq, jq, gettext for envsubst) or apt (yq, jq, gettext-base)."
done

[[ -n "${GRAFANA_TOKEN:-}" ]] || fail "GRAFANA_TOKEN not set; run \`source ./scripts/grafanactl-env.sh ${env_name}\` first"

cd "$(dirname "$0")/.."

# Pull the per-env Grafana server URL from grafanactl's committed config so
# this script and grafanactl always agree on the target host.
grafana_server="$(yq -r ".contexts.${env_name}.grafana.server" grafanactl/config.yaml)"
[[ -n "$grafana_server" && "$grafana_server" != "null" ]] \
  || fail "couldn't resolve grafana server for context '${env_name}' from grafanactl/config.yaml"

# Convert a file-provisioning duration string ("60s", "5m", "1h") to
# integer seconds for the AlertRuleGroup API body. A bare integer passes
# through unchanged so future files using `interval: 60` still work.
interval_seconds() {
  local raw="$1"
  case "$raw" in
    "" | null) fail "interval missing on rule group" ;;
    *s) echo "${raw%s}" ;;
    *m) echo "$(( ${raw%m} * 60 ))" ;;
    *h) echo "$(( ${raw%h} * 3600 ))" ;;
    *)  echo "$raw" ;;
  esac
}

# Validate that every ${VAR} the JSON references is set to a non-empty
# value, then envsubst ONLY those refs. Two reasons we pass an explicit
# allowlist to envsubst rather than letting it substitute everything:
#
#   1. envsubst with no args also expands bare `$VAR` (no braces). Alert
#      rule queries can contain Grafana template tokens like $__interval,
#      $__rate_interval, $__range — without an allowlist, envsubst would
#      silently empty-substitute those (since `__interval` etc. aren't set
#      in env), corrupting the rule. The allowlist makes Grafana template
#      syntax pass through literally.
#   2. envsubst substitutes unset / empty vars with empty strings, so a
#      typo in a placeholder name OR an empty SSM value would silently
#      push e.g. an empty datasource uid into a rule. The validate step
#      catches that before envsubst runs.
#
# Same shape as apply-datasources.sh and render-config.sh.
resolve_placeholders() {
  local raw="$1" file="$2"
  local refs ref name
  refs="$(grep -oE '\$\{[A-Z_][A-Z0-9_]*\}' <<<"$raw" | sort -u || true)"
  while IFS= read -r ref; do
    [[ -z "$ref" ]] && continue
    name="${ref#\$\{}"; name="${name%\}}"
    [[ -n "${!name:-}" ]] || fail "${file}: \${${name}} referenced but not set (or empty) in environment"
  done <<<"$refs"
  if [[ -n "$refs" ]]; then
    envsubst "$(tr '\n' ' ' <<<"$refs")" <<<"$raw"
  else
    printf '%s\n' "$raw"
  fi
}

upsert_group() {
  local folder_uid="$1" group_name="$2" body="$3"
  local http_status response
  # Capture body and status separately so a non-2xx prints the server's
  # error message (e.g., "rule X is invalid: ..."). curl --fail-with-body
  # would also do this, but using -w lets us include the status code in
  # the failure line uniformly.
  response="$(mktemp -t alerting-response.XXXXXX)"
  http_status="$(curl -sS -o "$response" -w '%{http_code}' -X PUT \
    -H "Authorization: Bearer ${GRAFANA_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "X-Disable-Provenance: true" \
    --data-binary "$body" \
    "${grafana_server}/api/v1/provisioning/folder/${folder_uid}/rule-groups/${group_name}")"

  case "$http_status" in
    2??)
      echo "  ↻ ${folder_uid}/${group_name}" >&2
      rm -f "$response"
      ;;
    *)
      echo "  ✗ ${folder_uid}/${group_name} → HTTP ${http_status}" >&2
      sed 's/^/    /' "$response" >&2 || true
      rm -f "$response"
      fail "alert rule push failed"
      ;;
  esac
}

shopt -s nullglob
files=(provisioning/alerting/*.json)
[[ "${#files[@]}" -gt 0 ]] || { echo "no alert-rule-group json files found" >&2; exit 0; }

echo "apply-alerting: env=${env_name} server=${grafana_server} files=${#files[@]}" >&2

for f in "${files[@]}"; do
  echo "→ ${f}" >&2
  # Each file is `apiVersion: 1` + `groups: [...]`. Pull groups out as
  # JSON one per line, envsubst them so ${VAR} placeholders resolve, then
  # transform into the AlertRuleGroup body the provisioning API expects.
  jq -c '.groups[]' "$f" | while IFS= read -r raw; do
    resolved="$(resolve_placeholders "$raw" "$f")"

    folder_uid="$(jq -r '.folder' <<<"$resolved")"
    group_name="$(jq -r '.name' <<<"$resolved")"
    interval_raw="$(jq -r '.interval' <<<"$resolved")"
    interval_secs="$(interval_seconds "$interval_raw")"

    [[ -n "$folder_uid" && "$folder_uid" != "null" ]] \
      || fail "${f}: group '${group_name}' missing 'folder' uid"
    [[ -n "$group_name" && "$group_name" != "null" ]] \
      || fail "${f}: group missing 'name'"

    body="$(jq -c \
      --arg title "$group_name" \
      --arg folderUid "$folder_uid" \
      --argjson interval "$interval_secs" \
      '{title: $title, folderUid: $folderUid, interval: $interval, rules: .rules}' \
      <<<"$resolved")"

    upsert_group "$folder_uid" "$group_name" "$body"
  done
done

echo "apply-alerting: done" >&2
