#!/usr/bin/env bash
# Push data source manifests in `provisioning/datasources/` to a hosted
# Grafana via the legacy HTTP API. grafanactl doesn't manage data sources
# (its `resources list` covers App Platform kinds only — dashboards,
# folders, playlists, etc.), so we go straight to /api/datasources.
#
# Local mode is a no-op: docker-compose mounts `provisioning/datasources/`
# into the container and Grafana provisions from the file directly. This
# script only runs against staging / production.
#
# Usage:
#   ./scripts/apply-datasources.sh --env <local|staging|production>
#
# Required env vars (staging / production only). The CI apply workflow
# (.github/workflows/observability-apply-{staging,production}.yml) fetches
# these from SSM and exports them to $GITHUB_ENV. For a local hosted run,
# export them manually first.
#
#   GRAFANA_TOKEN          — service-account token (SecureString, also
#                            populated by grafanactl-env.sh)
#   LOKI_URL               — internal Loki NLB URL, e.g. http://<nlb>:3100
#                            (from /<env>/loki/internal_url, CS-10968)
#   BOXEL_DB_HOST          — boxel RDS endpoint
#                            (from /<env>/boxel-grafana/db_host, CS-10978)
#   BOXEL_DB_NAME          — Postgres database name
#                            (from /<env>/boxel/PGDATABASE)
#   BOXEL_DB_USER          — Postgres user
#                            (from /<env>/boxel/GRAFANA_DB_USER)
#   BOXEL_DB_PASSWORD      — Postgres password (SecureString)
#                            (from /<env>/boxel/GRAFANA_DB_PASSWORD)
#   SYNAPSE_PROMETHEUS_URL — Synapse AMP workspace URL
#                            (from /<env>/boxel-grafana/prometheus_url)
#
# What it pushes:
#   - Each `.yaml` in `provisioning/datasources/` is read as the standard
#     Grafana provisioning shape (`apiVersion: 1` + `datasources: [...]`).
#   - For each datasource entry, env-var references like `${LOKI_URL}`
#     are substituted from the current shell environment. `secureJsonData`
#     (passwords, API keys) flows through unchanged — Grafana's HTTP API
#     accepts the file-provisioning shape on POST/PUT.
#   - The result is upserted: PUT `/api/datasources/uid/<uid>` if it
#     exists, POST `/api/datasources` otherwise.
#
# Caveats:
#   - The file-provisioning `editable: false` field doesn't have a direct
#     HTTP-API equivalent. Hosted data sources created here remain
#     UI-editable; re-running this script overwrites any UI edits, so
#     git stays the source of truth in practice.
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
    echo "apply-datasources: local — skipped (file provisioning handles it)" >&2
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
[[ -n "${LOKI_URL:-}" ]]      || fail "LOKI_URL not set; expected /\${env}/loki/internal_url to be sourced into the environment"

cd "$(dirname "$0")/.."

# Pull the per-env Grafana server URL from grafanactl's committed config so
# this script and grafanactl always agree on the target host.
grafana_server="$(yq -r ".contexts.${env_name}.grafana.server" grafanactl/config.yaml)"
[[ -n "$grafana_server" && "$grafana_server" != "null" ]] \
  || fail "couldn't resolve grafana server for context '${env_name}' from grafanactl/config.yaml"

upsert() {
  local payload="$1"
  local uid http_status
  uid="$(jq -r '.uid' <<<"$payload")"
  [[ -n "$uid" && "$uid" != "null" ]] || fail "datasource entry missing uid: $payload"

  # Probe whether this uid already exists.
  http_status="$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${GRAFANA_TOKEN}" \
    "${grafana_server}/api/datasources/uid/${uid}")"

  # `--fail-with-body` makes curl exit non-zero on 4xx/5xx and still print
  # the response body, so a 401/403/500 on the upsert fails the script
  # instead of silently logging a "successful" no-op.
  case "$http_status" in
    200)
      echo "  ↻ updating ${uid}" >&2
      curl -sS --fail-with-body -X PUT \
        -H "Authorization: Bearer ${GRAFANA_TOKEN}" \
        -H "Content-Type: application/json" \
        --data-binary "$payload" \
        "${grafana_server}/api/datasources/uid/${uid}" \
        | jq -r '.message // .name // .'
      ;;
    404)
      echo "  + creating ${uid}" >&2
      curl -sS --fail-with-body -X POST \
        -H "Authorization: Bearer ${GRAFANA_TOKEN}" \
        -H "Content-Type: application/json" \
        --data-binary "$payload" \
        "${grafana_server}/api/datasources" \
        | jq -r '.message // .name // .'
      ;;
    *)
      fail "probe for ${uid} returned HTTP ${http_status} (expected 200 or 404)"
      ;;
  esac
}

shopt -s nullglob
files=(provisioning/datasources/*.yaml)
[[ "${#files[@]}" -gt 0 ]] || { echo "no datasource yaml files found" >&2; exit 0; }

echo "apply-datasources: env=${env_name} server=${grafana_server} files=${#files[@]}" >&2

# Validate that every ${VAR} the YAML references is set to a non-empty
# value, then envsubst ONLY those refs. Two reasons we pass an explicit
# allowlist to envsubst rather than letting it substitute everything:
#
#   1. envsubst with no args also expands bare `$VAR` (no braces). If a
#      datasource entry ever embeds shell-meta or Grafana template syntax,
#      an empty allowlist would silently empty-substitute it. Pinning to
#      the discovered ${UPPER_VAR} refs keeps everything else literal.
#   2. envsubst substitutes unset / empty vars with empty strings, so a
#      typo in a placeholder name OR an empty SSM value would silently
#      push e.g. `url: ""` / `password: ""` to Grafana. The validate step
#      catches that before envsubst runs.
#
# Same shape as apply-alerting.sh and render-config.sh.
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

for f in "${files[@]}"; do
  echo "→ ${f}" >&2
  # Each file is `apiVersion: 1` + `datasources: [...]`. Pull the entries
  # out as JSON one per line, envsubst them so ${VAR} placeholders resolve,
  # then upsert each one. secureJsonData (passwords, API keys) flows
  # through the same path — Grafana's HTTP API accepts it on POST/PUT
  # exactly as it appears in the file-provisioning shape.
  yq -o json -I0 '.datasources[]' "$f" | while IFS= read -r raw; do
    payload="$(resolve_placeholders "$raw" "$f")"
    upsert "$payload"
  done
done

echo "apply-datasources: done" >&2
