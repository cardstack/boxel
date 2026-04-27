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

api() {
  curl -sf -H "Authorization: Bearer $api_key" "$base_url$1"
}

slugify() {
  printf '%s' "$1" \
    | tr '[:upper:] _' '[:lower:]--' \
    | tr -cd 'a-z0-9-' \
    | sed -e 's/--*/-/g' -e 's/^-//' -e 's/-$//'
}

# ===== Folders =====
echo "Pulling folders..." >&2
api /api/folders | jq -c '.[]' | while IFS= read -r folder; do
  uid="$(jq -r '.uid' <<<"$folder")"
  title="$(jq -r '.title' <<<"$folder")"
  slug="$(slugify "$title")"
  out="$FOLDERS_DIR/$slug.json"
  echo "  folder: $title ($uid) → $out" >&2
  jq -n --arg uid "$uid" --arg title "$title" '{
    apiVersion: "folder.grafana.app/v1beta1",
    kind: "Folder",
    metadata: { name: $uid },
    spec: { title: $title }
  }' > "$out"
done

# ===== Dashboards =====
echo "Pulling dashboards..." >&2
api '/api/search?type=dash-db' | jq -c '.[]' | while IFS= read -r row; do
  uid="$(jq -r '.uid' <<<"$row")"
  title="$(jq -r '.title' <<<"$row")"
  slug="$(slugify "$title")"
  out="$DASHBOARDS_DIR/$slug.json"
  echo "  dashboard: $title ($uid) → $out" >&2
  api "/api/dashboards/uid/$uid" | jq --arg uid "$uid" '{
    apiVersion: "dashboard.grafana.app/v1beta1",
    kind: "Dashboard",
    metadata: { name: $uid },
    spec: .dashboard
  }' > "$out"
done

# Synapse dashboard is upstream-vendored (matrix-org/synapse, contrib/grafana/).
# Tag the file header for future archaeologists.
synapse_file="$DASHBOARDS_DIR/synapse.json"
if [[ -f "$synapse_file" ]]; then
  # Add a sibling .NOTE file rather than embedding a comment in JSON
  # (JSON has no comments). The .NOTE is informational, not consumed by tools.
  cat > "$DASHBOARDS_DIR/synapse.NOTE.md" <<'EOF'
# Vendored from upstream Synapse

`synapse.json` is the upstream Synapse project's monitoring dashboard
(published at https://github.com/matrix-org/synapse, contrib/grafana/).
We carry a copy because we run a Synapse server.

When Synapse upgrades add new metrics worth dashboarding, re-pull from
upstream and rebase any local edits. Treat as vendored third-party code:
do not modify locally unless we're willing to own the diff.
EOF
fi

# ===== Data sources =====
# Note: secureJsonData (passwords, API keys) is NEVER returned by Grafana's API.
# The committed provisioning file omits it; for secrets, the staging/production
# Grafana ECS task definition needs the right env vars set from SSM and the
# provisioning file should be edited to reference them via ${ENV_VAR}. Done as
# a follow-up when wiring Grafana provisioning delivery to ECS.
echo "Pulling data sources..." >&2
api /api/datasources | jq -c '.[]' | while IFS= read -r ds; do
  name="$(jq -r '.name' <<<"$ds")"
  slug="$(slugify "$name")"
  out="$DATASOURCES_DIR/$slug.json"
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
done

# ===== Alert rules =====
# Use Grafana's provisioning API endpoint (returns the format Grafana
# itself expects in /etc/grafana/provisioning/alerting/).
echo "Pulling alert rule groups..." >&2
if alerts_json="$(api /api/v1/provisioning/alert-rules 2>/dev/null)"; then
  echo "$alerts_json" | jq -c 'group_by([.folderUID, .ruleGroup])[]' | while IFS= read -r rules; do
    name="$(jq -r '.[0].ruleGroup' <<<"$rules")"
    folder_uid="$(jq -r '.[0].folderUID' <<<"$rules")"
    slug="$(slugify "$name")"
    out="$ALERTS_DIR/$slug.json"
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
  done
else
  echo "  (no alert rules — /api/v1/provisioning/alert-rules returned non-200)" >&2
fi

echo "" >&2
echo "=== Summary ===" >&2
printf '%-22s %3d files\n' "Dashboards:"   "$(find "$DASHBOARDS_DIR"   -type f -name '*.json' 2>/dev/null | wc -l | xargs)" >&2
printf '%-22s %3d files\n' "Folders:"      "$(find "$FOLDERS_DIR"      -type f -name '*.json' 2>/dev/null | wc -l | xargs)" >&2
printf '%-22s %3d files\n' "Data sources:" "$(find "$DATASOURCES_DIR"  -type f -name '*.json' 2>/dev/null | wc -l | xargs)" >&2
printf '%-22s %3d files\n' "Alert groups:" "$(find "$ALERTS_DIR"       -type f -name '*.json' 2>/dev/null | wc -l | xargs)" >&2

echo "" >&2
echo "Next steps:" >&2
echo "  1. git status  — confirm new files match expected counts (5 dashboards, 1 folder, 3 datasources, 1 alert group)" >&2
echo "  2. docker compose up -d grafana && ./scripts/apply.sh   # round-trip verify" >&2
echo "  3. Open Grafana at http://localhost:3001 and visually compare against AMG" >&2
echo "  4. Commit the extracted output as a follow-up commit on this branch" >&2
