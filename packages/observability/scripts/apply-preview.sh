#!/usr/bin/env bash
# apply-preview.sh — Push the per-PR preview tree to a Grafana environment.
#
# Wraps render-preview.sh (changed-dashboard filtering + UID rewriting) and
# `grafanactl resources push`. Used by the observability-preview.yml workflow
# on PR open/synchronize/reopen.
#
# Usage:
#   ./scripts/apply-preview.sh --pr <n> --base-ref <ref> [--env staging|local|production]
#
# Output (stdout) is a structured summary suitable for the workflow's
# comment-posting step:
#
#   FOLDER:<uid>:<title>
#   DASHBOARD:<uid>:<title>
#   DASHBOARD:<uid>:<title>
#   ...
#
# Exits 0 with no stdout when the PR didn't change any dashboards (caller
# treats this as "no preview to apply" and updates the sticky comment
# accordingly).
#
# Prereqs (staging/production): AWS creds with ssm:GetParameter on
# /<env>/grafana/grafanactl_token plus the same SSM paths apply.sh reads
# (REALM_SERVER_URL, GRAFANA_SECRET). Local mode uses admin/admin against
# the docker-compose Grafana — no AWS creds needed.
set -eo pipefail

usage_error() { echo "error: $1" >&2; exit 2; }

pr_number=""
base_ref=""
env_name="staging"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr)
      [[ $# -ge 2 && "$2" != --* ]] || usage_error "missing value for --pr"
      pr_number="$2"; shift 2 ;;
    --pr=*)
      pr_number="${1#--pr=}"; shift ;;
    --base-ref)
      [[ $# -ge 2 && "$2" != --* ]] || usage_error "missing value for --base-ref"
      base_ref="$2"; shift 2 ;;
    --base-ref=*)
      base_ref="${1#--base-ref=}"; shift ;;
    --env)
      [[ $# -ge 2 && "$2" != --* ]] || usage_error "missing value for --env"
      env_name="$2"; shift 2 ;;
    --env=*)
      env_name="${1#--env=}"; shift ;;
    *)
      usage_error "unknown option: $1" ;;
  esac
done

[[ -n "$pr_number" ]] || usage_error "--pr <n> is required"
[[ -n "$base_ref" ]] || usage_error "--base-ref <ref> is required"

cd "$(dirname "$0")/.."

# shellcheck source=./grafanactl-env.sh
source ./scripts/grafanactl-env.sh "$env_name"

command -v jq >/dev/null || { echo "error: missing dependency: jq" >&2; exit 1; }
command -v grafanactl >/dev/null \
  || { echo "error: missing dependency: grafanactl" >&2; exit 1; }

# Render to a tempdir. render-preview.sh emits the tempdir path on stdout
# (and exits 0 with empty stdout if there are no changed dashboards).
rendered="$(./scripts/render-preview.sh \
  --pr "$pr_number" --base-ref "$base_ref" --env "$env_name")"

if [[ -z "$rendered" ]]; then
  # No-op: signal the caller via empty stdout. Sticky-comment step will
  # render the "no dashboard changes" body.
  exit 0
fi
trap 'rm -rf "$rendered"' EXIT

cfg="$(./scripts/render-config.sh "$env_name")"
trap 'rm -rf "$rendered"; rm -f "$cfg"' EXIT

# Clean up any pr<n>-* resources from a previous apply BEFORE pushing the
# new set. `resources push` is upsert-only — it won't delete a dashboard
# that was in the prior render but isn't in this one. So if a PR push
# reduces the changed-dashboard set (e.g. a later commit reverts one of
# two earlier dashboard edits), the dropped dashboard would otherwise
# linger in staging until PR close. cleanup-preview.sh is idempotent on
# an empty preview state — first-time applies pay the cost of one extra
# `grafanactl resources pull` for a no-op delete.
./scripts/cleanup-preview.sh --pr "$pr_number" --env "$env_name" >&2

# Push the preview tree. `resources push` is upsert-only, which combined
# with the cleanup above gives us full state replacement: the only
# pr<n>-* resources in Grafana after this step are exactly those in the
# rendered tree.
#
# Suppress stdout so the workflow comment captures only our structured
# summary below; stderr still surfaces in the run log on failure.
grafanactl \
  --config "$cfg" \
  --context "$env_name" \
  resources push \
  --path "$rendered" \
  >/dev/null

# Emit the structured summary. Order: folder first, then dashboards (by UID
# for stability — the workflow comment renders them as a bullet list).
# Use a single-pass jq invocation per resource type to avoid a per-file
# subshell on the typical hot path.
while IFS= read -r -d '' f; do
  jq -r '"FOLDER:" + .metadata.name + ":" + (.spec.title // "")' "$f"
done < <(find "$rendered/folders" -type f -name '*.json' -print0 2>/dev/null)

while IFS= read -r -d '' f; do
  jq -r '"DASHBOARD:" + .metadata.name + ":" + (.spec.title // "")' "$f"
done < <(find "$rendered/dashboards" -type f -name '*.json' -print0 2>/dev/null | sort -z)
