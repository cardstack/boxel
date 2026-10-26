#!/usr/bin/env bash
# prune-dashboards.sh — Delete dashboards that the repo no longer defines from
# the folders the repo owns.
#
# `grafanactl resources push` creates and updates, but never deletes, so a
# dashboard removed from grafanactl/resources/dashboards/ would otherwise stay
# in Grafana with its last content and nothing maintaining it. This runs after
# the push in apply.sh.
#
# Managed folders are the ones grafanactl/resources/folders/ defines. Every
# dashboard in a managed folder whose UID is not a dashboard in
# grafanactl/resources/dashboards/ is deleted. Thus a managed folder is owned
# by the repo: a dashboard made by hand in it is deleted by the next apply,
# so make those in another folder. Folders the repo does not define,
# including the per-PR preview folders, are never touched.
#
# Usage:
#   ./scripts/prune-dashboards.sh --env local|staging|production [--dry-run]
#
# --dry-run deletes nothing. It prints the dashboards an apply would delete to
# stdout, one `- dashboards/<uid>  "<title>"` line each after a `#` header, in
# the shape the observability-diff PR comment shows (a ```diff block). Without
# --dry-run, progress goes to stderr.
#
# Auth is the same as apply-home-dashboard.sh: the local context's user and
# password from grafanactl/config.yaml, or GRAFANA_TOKEN for hosted envs.
set -eo pipefail

usage_error() { echo "error: $1" >&2; exit 2; }
fail() { echo "error: $1" >&2; exit 1; }

env_name=""
dry_run=false
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
    --dry-run)
      dry_run=true
      shift
      ;;
    *) usage_error "unknown option: $1" ;;
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

grafana_server="$(yq -r ".contexts.${env_name}.grafana.server" grafanactl/config.yaml)"
[[ -n "$grafana_server" && "$grafana_server" != "null" ]] \
  || fail "couldn't resolve grafana server for context '${env_name}' from grafanactl/config.yaml"

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

# The folders and dashboards the repo defines, by UID (`metadata.name`).
managed_folders="$(
  find grafanactl/resources/folders -type f -name '*.json' -print0 \
    | xargs -0 jq -r '.metadata.name' | sort -u
)"
[[ -n "$managed_folders" ]] || fail "no folders found in grafanactl/resources/folders"
repo_dashboards="$(
  find grafanactl/resources/dashboards -type f -name '*.json' -print0 \
    | xargs -0 jq -r '.metadata.name' | sort -u
)"
# An empty list would make every dashboard in the managed folders look
# removed. Refuse rather than delete them all.
[[ -n "$repo_dashboards" ]] \
  || fail "no dashboards found in grafanactl/resources/dashboards; refusing to prune"

response="$(mktemp -t prune-dashboards-response.XXXXXX)"
trap 'rm -f "$response"' EXIT

# Prints "<uid>\t<title>" for each dashboard in the folder.
live_dashboards() {
  local folder="$1" http_status
  http_status="$(curl -sS -o "$response" -w '%{http_code}' -G \
    "${auth_args[@]}" \
    --data-urlencode "folderUIDs=${folder}" \
    --data-urlencode "type=dash-db" \
    --data-urlencode "limit=5000" \
    "${grafana_server}/api/search")"
  [[ "$http_status" == 2?? ]] \
    || fail "GET /api/search?folderUIDs=${folder} → HTTP ${http_status}: $(head -c 300 "$response")"
  jq -r '.[] | [.uid, .title] | @tsv' "$response"
}

stale=()
while IFS= read -r folder; do
  while IFS=$'\t' read -r uid title; do
    [[ -n "$uid" ]] || continue
    if ! grep -qxF "$uid" <<<"$repo_dashboards"; then
      stale+=("${uid}"$'\t'"${title}")
    fi
  done < <(live_dashboards "$folder")
done <<<"$managed_folders"

echo "prune-dashboards: env=${env_name} server=${grafana_server} managed folders=$(wc -l <<<"$managed_folders" | tr -d ' ') stale dashboards=${#stale[@]}" >&2

if [[ ${#stale[@]} -eq 0 ]]; then
  exit 0
fi

if [[ "$dry_run" == true ]]; then
  echo "# Dashboards an apply deletes (in a folder the repo owns, but not in the repo):"
  for entry in "${stale[@]}"; do
    IFS=$'\t' read -r uid title <<<"$entry"
    echo "- dashboards/${uid}  \"${title}\""
  done
  exit 0
fi

failed=0
for entry in "${stale[@]}"; do
  IFS=$'\t' read -r uid title <<<"$entry"
  http_status="$(curl -sS -o "$response" -w '%{http_code}' -X DELETE \
    "${auth_args[@]}" \
    "${grafana_server}/api/dashboards/uid/${uid}")"
  case "$http_status" in
    2??) echo "  − deleted dashboard ${uid} \"${title}\" (not in the repo)" >&2 ;;
    *)
      echo "  ✗ DELETE /api/dashboards/uid/${uid} → HTTP ${http_status}: $(head -c 300 "$response")" >&2
      failed=1
      ;;
  esac
done
[[ "$failed" -eq 0 ]] || fail "some stale dashboards could not be deleted"
