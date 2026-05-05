#!/usr/bin/env bash
# extract-amg.sh — One-shot migration tool that pulls AMG (AWS Managed Grafana)
# state into this package's target file layouts for self-host:
#
#   grafanactl/resources/dashboards/  ← dashboards (App Platform JSON manifests)
#   grafanactl/resources/folders/     ← folders (App Platform JSON manifests)
#   provisioning/datasources/         ← data sources (Grafana provisioning JSON)
#   provisioning/alerting/            ← alert rule groups (Grafana provisioning JSON)
#
# This script is one-shot: after Phase 6 cutover (CS-10922 + later phases),
# AMG goes away and this script becomes archival.
#
# Usage:
#   ./scripts/migrations/extract-amg.sh staging
#   ./scripts/migrations/extract-amg.sh production
#
# Prereqs:
#   - AWS credentials with ssm:GetParameter for /<env>/boxel/GRAFANA_*
#   - jq installed (brew install jq)
#   - curl
#
# After running, round-trip verify with:
#   docker compose up -d grafana
#   ./scripts/apply.sh        # local — pushes the extracted dashboards/folders
#                             # via grafanactl; data sources + alerts get
#                             # picked up by Grafana provisioning at boot.
#
# Idempotency: this script clears the extracted-output dirs at start, so each
# run produces a clean snapshot of AMG state (no stale files left behind from
# a previous run that pulled different content).
#
# Secret handling: the realm-server `authHeader` shared secret used by AMG-era
# operator-action dashboard buttons is REDACTED out of dashboard JSON before
# it reaches disk. The dashboard's `templating.list[].query` for any constant
# variable named `grafana_secret` is rewritten to "REPLACE_AT_APPLY_TIME". The
# real value must be substituted before pushing to staging/prod (mechanism is
# Phase 3.5 work — replacing GET-with-secret-in-querystring with POST-with-
# Authorization-header eliminates the pattern entirely).

set -eo pipefail

env_name="${1:?usage: $0 <staging|production>}"

case "$env_name" in
  staging|production) ;;
  *) echo "error: env must be staging or production" >&2; exit 2 ;;
esac

# Run from the package root (one level up from scripts/migrations/).
cd "$(dirname "$0")/../.."

echo "Fetching AMG credentials from SSM /${env_name}/boxel/..." >&2
api_key="$(aws ssm get-parameter \
  --name "/${env_name}/boxel/GRAFANA_API_KEY" \
  --with-decryption \
  --query 'Parameter.Value' --output text)"
endpoint="$(aws ssm get-parameter \
  --name "/${env_name}/boxel/GRAFANA_ENDPOINT" \
  --with-decryption \
  --query 'Parameter.Value' --output text)"

[[ -n "$api_key" && -n "$endpoint" ]] || {
  echo "error: GRAFANA_API_KEY or GRAFANA_ENDPOINT missing in SSM" >&2
  exit 1
}

# AMG endpoint may or may not include scheme — normalize to https://.
case "$endpoint" in
  http://*|https://*) base_url="$endpoint" ;;
  *) base_url="https://${endpoint}" ;;
esac

echo "AMG endpoint: $base_url" >&2

DASHBOARDS_DIR="grafanactl/resources/dashboards/boxel-status"
FOLDERS_DIR="grafanactl/resources/folders"
DATASOURCES_DIR="provisioning/datasources"
ALERTS_DIR="provisioning/alerting"

mkdir -p "$DASHBOARDS_DIR" "$FOLDERS_DIR" "$DATASOURCES_DIR" "$ALERTS_DIR"

# Idempotency sweep: clear prior extracted output and any stale scaffolding
# placeholders so each run produces a clean snapshot. Preserves the dirs.
rm -f \
  "$DASHBOARDS_DIR"/*.json \
  "$DASHBOARDS_DIR"/*.NOTE.md \
  "$FOLDERS_DIR"/*.json \
  "$DATASOURCES_DIR"/*.json \
  "$ALERTS_DIR"/*.json \
  2>/dev/null || true
find grafanactl/resources provisioning -name '.gitkeep' -type f -delete 2>/dev/null || true
# CS-10918 moved alerts to provisioning/alerting/; the old grafanactl/resources/alerts/
# dir is dead.
rm -rf grafanactl/resources/alerts 2>/dev/null || true

# Internal: GET $path, return body on 2xx, exit non-zero on other codes —
# except codes listed in $allow_empty_codes (space-separated), which return
# 0 with empty body. Includes timeouts and retries so a flaky network or
# stalled connection doesn't hang or fail silently.
_api() {
  local path="$1"
  local allow_empty_codes="${2:-}"
  local response http body
  response="$(curl -sS \
    --connect-timeout 10 \
    --max-time 60 \
    --retry 3 \
    --retry-all-errors \
    --retry-connrefused \
    -H "Authorization: Bearer $api_key" \
    -w '__HTTP_CODE__%{http_code}' \
    "$base_url$path")"
  http="${response##*__HTTP_CODE__}"
  body="${response%__HTTP_CODE__*}"
  case " $allow_empty_codes " in
    *" $http "*) return 0 ;;
  esac
  if [[ "$http" -lt 200 || "$http" -ge 300 ]]; then
    echo "" >&2
    echo "error: GET $path returned HTTP $http" >&2
    echo "  response body:" >&2
    printf '%s\n' "$body" | head -c 800 | sed 's/^/    /' >&2
    echo "" >&2
    if [[ "$http" == "401" ]]; then
      echo "  hint: AMG API keys expire after 30 days. Rotate via:" >&2
      echo "    cardstack/infra: /terraform-plan workspace=boxel-grafana-api-key/${env_name}" >&2
      echo "    then apply, then re-run this script." >&2
    fi
    return 22
  fi
  printf '%s' "$body"
}

api()           { _api "$1" "" ; }
api_or_empty()  { _api "$1" "404" ; }   # returns empty body on 404 (e.g., when alerting endpoint isn't enabled)

slugify() {
  printf '%s' "$1" \
    | tr '[:upper:] _' '[:lower:]--' \
    | tr -cd 'a-z0-9-' \
    | sed -e 's/--*/-/g' -e 's/^-//' -e 's/-$//'
}

# fail_on_collision <out_path> <kind> <current_uid> <title>
fail_on_collision() {
  local out="$1" kind="$2" current_uid="$3" title="$4"
  if [[ -e "$out" ]]; then
    echo "" >&2
    echo "error: ${kind} filename collision: $out" >&2
    echo "  current uid:  $current_uid (title: '$title')" >&2
    echo "  fix: rename one resource in AMG, or extend the script to disambiguate (e.g., append uid)" >&2
    exit 1
  fi
}

# ===== Folders =====
echo "Pulling folders..." >&2
while IFS= read -r folder; do
  uid="$(jq -r '.uid' <<<"$folder")"
  title="$(jq -r '.title' <<<"$folder")"
  slug="$(slugify "$title")"
  out="$FOLDERS_DIR/$slug.json"
  fail_on_collision "$out" folder "$uid" "$title"
  echo "  folder: $title ($uid) → $out" >&2
  jq -n --arg uid "$uid" --arg title "$title" '{
    apiVersion: "folder.grafana.app/v1beta1",
    kind: "Folder",
    metadata: { name: $uid },
    spec: { title: $title }
  }' > "$out"
done < <(api /api/folders | jq -c '.[]')

# ===== Dashboards =====
# Each dashboard's `templating.list[]` is sanitized:
#   constant variable named `grafana_secret` → query rewritten to placeholder
# (avoids committing the realm-server admin-action shared secret to git).
echo "Pulling dashboards..." >&2
while IFS= read -r row; do
  uid="$(jq -r '.uid' <<<"$row")"
  title="$(jq -r '.title' <<<"$row")"
  slug="$(slugify "$title")"
  out="$DASHBOARDS_DIR/$slug.json"
  fail_on_collision "$out" dashboard "$uid" "$title"
  echo "  dashboard: $title ($uid) → $out" >&2
  api "/api/dashboards/uid/$uid" | jq --arg uid "$uid" '
    .dashboard as $d |
    {
      apiVersion: "dashboard.grafana.app/v1beta1",
      kind: "Dashboard",
      metadata: { name: $uid },
      spec: (
        $d
        | (.templating.list //= [])
        | .templating.list |= map(
            if .type == "constant" and .name == "grafana_secret" then
              .query = "REPLACE_AT_APPLY_TIME"
            else . end
          )
      )
    }
  ' > "$out"
done < <(api '/api/search?type=dash-db' | jq -c '.[]')

# ===== Data sources =====
# Note: secureJsonData (passwords, API keys) is NEVER returned by Grafana's API.
# The committed provisioning file omits it; for secrets, the staging/production
# Grafana ECS task definition needs the right env vars set from SSM and the
# provisioning file should be edited to reference them via ${ENV_VAR}. Done as
# a follow-up when wiring Grafana provisioning delivery to ECS.
echo "Pulling data sources..." >&2
while IFS= read -r ds; do
  name="$(jq -r '.name' <<<"$ds")"
  slug="$(slugify "$name")"
  out="$DATASOURCES_DIR/$slug.json"
  fail_on_collision "$out" datasource "" "$name"
  echo "  datasource: $name → $out" >&2
  jq -n --argjson ds "$ds" '{
    apiVersion: 1,
    datasources: [{
      name: $ds.name,
      uid: $ds.uid,
      type: $ds.type,
      access: $ds.access,
      url: $ds.url,
      isDefault: $ds.isDefault,
      editable: false,
      jsonData: $ds.jsonData
    }]
  }' > "$out"
done < <(api /api/datasources | jq -c '.[]')

# ===== Alert rule groups =====
# Use Grafana's provisioning API (returns the format Grafana itself expects in
# /etc/grafana/provisioning/alerting/). Filenames include the folder slug to
# disambiguate same-named rule groups across folders.
echo "Pulling alert rule groups..." >&2
alerts_json="$(api_or_empty /api/v1/provisioning/alert-rules)"
if [[ -n "$alerts_json" && "$alerts_json" != "null" && "$alerts_json" != "[]" ]]; then
  while IFS= read -r rules; do
    name="$(jq -r '.[0].ruleGroup' <<<"$rules")"
    folder_uid="$(jq -r '.[0].folderUID' <<<"$rules")"
    rule_slug="$(slugify "$name")"
    folder_slug="$(slugify "$folder_uid")"
    out="$ALERTS_DIR/${folder_slug}--${rule_slug}.json"
    fail_on_collision "$out" "alert group" "$folder_uid/$name" "$name"
    echo "  alert group: $name (folder=$folder_uid) → $out" >&2
    jq -n --argjson rules "$rules" --arg name "$name" --arg folder "$folder_uid" '{
      apiVersion: 1,
      groups: [{
        orgId: 1,
        name: $name,
        folder: $folder,
        interval: "60s",
        rules: $rules
      }]
    }' > "$out"
  done < <(echo "$alerts_json" | jq -c 'group_by([.folderUID, .ruleGroup])[]')
else
  echo "  (no alert rules — endpoint returned 404 or empty array)" >&2
fi

echo "" >&2
echo "=== Summary ===" >&2
printf '%-22s %3d files\n' "Dashboards:"   "$(find "$DASHBOARDS_DIR"   -type f -name '*.json' 2>/dev/null | wc -l | xargs)" >&2
printf '%-22s %3d files\n' "Folders:"      "$(find "$FOLDERS_DIR"      -type f -name '*.json' 2>/dev/null | wc -l | xargs)" >&2
printf '%-22s %3d files\n' "Data sources:" "$(find "$DATASOURCES_DIR"  -type f -name '*.json' 2>/dev/null | wc -l | xargs)" >&2
printf '%-22s %3d files\n' "Alert groups:" "$(find "$ALERTS_DIR"       -type f -name '*.json' 2>/dev/null | wc -l | xargs)" >&2

# Sanity: surface any remaining occurrences of likely-secret-shaped values so
# the operator notices before committing. Currently checks only the known
# shared-secret value pattern (UUID assigned to grafana_secret); extend the
# pattern list if other secrets surface in extracted JSON.
echo "" >&2
echo "=== Secret scan ===" >&2
if grep -RInE '"query"\s*:\s*"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"' "$DASHBOARDS_DIR" 2>/dev/null; then
  echo "" >&2
  echo "WARNING: a UUID-shaped value remains in a 'query' field above. If it's" >&2
  echo "a constant template variable holding a shared secret, extend the" >&2
  echo "redaction in the dashboards section of this script." >&2
else
  echo "no UUID-shaped values found in dashboard 'query' fields." >&2
fi

echo "" >&2
echo "Next steps:" >&2
echo "  1. git status  — confirm new files match expected counts (5 dashboards, 1 folder, 3 datasources, 1 alert group)" >&2
echo "  2. docker compose up -d grafana && ./scripts/apply.sh   # round-trip verify" >&2
echo "  3. Open Grafana at http://localhost:3001 and visually compare against AMG" >&2
echo "  4. Commit the extracted output as a follow-up commit on this branch" >&2
