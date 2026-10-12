#!/usr/bin/env bash
# Push alert rule groups in `provisioning/alerting/`, plus the contact
# points and rule groups in `provisioning/alerting-hosted/<env>/`, to a hosted
# Grafana via the provisioning HTTP API. grafanactl doesn't manage alert rules
# (its `resources list` covers App Platform kinds only — dashboards,
# folders, playlists, etc.), and locally docker-compose mounts
# `provisioning/alerting/` into the container so Grafana provisions from
# the file directly. This script only runs against staging / production.
#
# Usage:
#   ./scripts/apply-alerting.sh --env <local|staging|production> [--preflight]
#
#   --preflight  only check that every ${VAR} the env's files reference is
#                set, then exit without contacting Grafana. apply.sh runs this
#                before it pushes anything, so a missing secret cannot leave
#                a partial apply. A normal run makes the same check first too.
#
# Required env vars (staging / production only). The CI apply workflow
# (.github/workflows/observability-apply-{staging,production}.yml) fetches
# GRAFANA_TOKEN from SSM and exports it to $GITHUB_ENV. For a local hosted
# run, source ./scripts/grafanactl-env.sh first.
#
#   GRAFANA_TOKEN — service-account token (SecureString)
#   Plus every ${VAR} the env's files reference, e.g. DISCORD_ALARMS_WEBHOOK
#   for provisioning/alerting-hosted/staging/contact-points/.
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
preflight=""
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
    --preflight)
      preflight=1
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

cd "$(dirname "$0")/.."

shopt -s nullglob
# provisioning/alerting/ applies to every environment, and docker-compose
# mounts it for local Grafana too. provisioning/alerting-hosted/<env>/ holds
# what exists in one hosted environment only: rules for a service that runs
# there alone, and contact points whose secrets come from that
# environment's SSM. Contact points go first, so a rule that routes to one
# can find it.
hosted_dir="provisioning/alerting-hosted/${env_name}"
contact_point_files=("${hosted_dir}"/contact-points/*.json)
rule_files=(provisioning/alerting/*.json "${hosted_dir}"/rules/*.json)

# Fail before any push when a file this run would push references a ${VAR}
# that is not set, naming every missing one at once. resolve_placeholders
# below makes the same check per group, but only when it reaches that group,
# after earlier files have been pushed.
check_placeholders() {
  local f name missing=()
  for f in "${contact_point_files[@]}" "${rule_files[@]}"; do
    while IFS= read -r name; do
      [[ -z "$name" ]] && continue
      [[ -n "${!name:-}" ]] || missing+=("\${${name}} (${f})")
    done < <(grep -oE '\$\{[A-Z_][A-Z0-9_]*\}' "$f" | sed -E 's/^\$\{(.*)\}$/\1/' | sort -u)
  done
  if [[ "${#missing[@]}" -gt 0 ]]; then
    printf 'error: not set (or empty) in environment; CI fetches these from SSM in observability-apply-%s.yml:\n' "$env_name" >&2
    printf '  %s\n' "${missing[@]}" >&2
    exit 1
  fi
}

check_placeholders
if [[ -n "$preflight" ]]; then
  echo "apply-alerting: preflight ok (env=${env_name})" >&2
  exit 0
fi

for cmd in yq jq curl envsubst; do
  command -v "$cmd" >/dev/null \
    || fail "missing dependency: ${cmd}. Install via brew (yq, jq, gettext for envsubst) or apt (yq, jq, gettext-base)."
done

[[ -n "${GRAFANA_TOKEN:-}" ]] || fail "GRAFANA_TOKEN not set; run \`source ./scripts/grafanactl-env.sh ${env_name}\` first"

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

# A contact point is created when its uid is new and replaced otherwise.
# The provisioning API has no single upsert call for contact points, so look
# the uid up first.
upsert_contact_point() {
  local uid="$1" body="$2"
  local method url http_status response existing
  existing="$(curl -sS --fail-with-body \
    -H "Authorization: Bearer ${GRAFANA_TOKEN}" \
    "${grafana_server}/api/v1/provisioning/contact-points")" \
    || fail "listing contact points failed: ${existing}"
  if jq -e --arg uid "$uid" 'any(.[]; .uid == $uid)' <<<"$existing" >/dev/null; then
    method=PUT
    url="${grafana_server}/api/v1/provisioning/contact-points/${uid}"
  else
    method=POST
    url="${grafana_server}/api/v1/provisioning/contact-points"
  fi

  response="$(mktemp -t alerting-response.XXXXXX)"
  http_status="$(curl -sS -o "$response" -w '%{http_code}' -X "$method" \
    -H "Authorization: Bearer ${GRAFANA_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "X-Disable-Provenance: true" \
    --data-binary "$body" \
    "$url")"

  case "$http_status" in
    2??)
      echo "  ↻ contact point ${uid} (${method})" >&2
      rm -f "$response"
      ;;
    *)
      # The body carries the webhook URL, so print only the server's message.
      echo "  ✗ contact point ${uid} → HTTP ${http_status}" >&2
      jq -r '.message // empty' "$response" 2>/dev/null | sed 's/^/    /' >&2 || true
      rm -f "$response"
      fail "contact point push failed"
      ;;
  esac
}

push_rule_groups() {
  local f="$1" raw resolved folder_uid group_name interval_raw interval_secs body
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
}

push_contact_points() {
  local f="$1" raw resolved uid body
  echo "→ ${f}" >&2
  # Same file shape as Grafana file provisioning: `contactPoints[].receivers[]`.
  # The API takes one receiver at a time, named after its contact point.
  jq -c '.contactPoints[] | .name as $name | .receivers[] | . + {name: $name}' "$f" \
    | while IFS= read -r raw; do
      resolved="$(resolve_placeholders "$raw" "$f")"
      uid="$(jq -r '.uid' <<<"$resolved")"
      [[ -n "$uid" && "$uid" != "null" ]] || fail "${f}: receiver missing 'uid'"
      body="$(jq -c '{uid, name, type, settings, disableResolveMessage}' <<<"$resolved")"
      upsert_contact_point "$uid" "$body"
    done
}

echo "apply-alerting: env=${env_name} server=${grafana_server} contact-point files=${#contact_point_files[@]} rule files=${#rule_files[@]}" >&2

for f in "${contact_point_files[@]}"; do
  push_contact_points "$f"
done

for f in "${rule_files[@]}"; do
  push_rule_groups "$f"
done

echo "apply-alerting: done" >&2
