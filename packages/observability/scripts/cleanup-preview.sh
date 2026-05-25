#!/usr/bin/env bash
# cleanup-preview.sh — Delete a PR's preview dashboards + folder from Grafana.
#
# Pulls the live state of `dashboards` and `folders` from the target Grafana,
# filters to resources whose UID begins with `pr<n>-` (the prefix render-
# preview.sh stamps), and deletes them in two `grafanactl resources delete`
# passes: dashboards first, then the folder containing them. The two-pass
# split is mandatory — Grafana refuses to delete a non-empty folder
# ("400 BadRequest: Folder cannot be deleted: folder is not empty"), and
# a single delete invocation processes selectors in argv order with no
# dependency awareness, so we'd hit that error every time.
#
# Usage:
#   ./scripts/cleanup-preview.sh --pr <n> [--env staging|local|production]
#
# Designed to be safe to re-run: deleting an already-absent resource exits
# 0 (the `on-error=ignore` setting below makes grafanactl tolerate missing
# selectors so we don't have to re-read live state and diff).
#
# Callers:
#   - apply-preview.sh runs this before every push, so a PR that shrinks
#     its changed-dashboard set (e.g. reverts one of two prior edits)
#     gets the old preview resources removed before the new tree lands.
#   - observability-preview.yml runs this on pull_request `closed`.
#   - observability-preview-sweep.yml runs this for PRs the daily sweep
#     has decided are stale.
set -eo pipefail

usage_error() { echo "error: $1" >&2; exit 2; }

pr_number=""
env_name="staging"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr)
      [[ $# -ge 2 && "$2" != --* ]] || usage_error "missing value for --pr"
      pr_number="$2"; shift 2 ;;
    --pr=*)
      pr_number="${1#--pr=}"; shift ;;
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
[[ "$pr_number" =~ ^[0-9]+$ ]] || usage_error "--pr must be a positive integer"

cd "$(dirname "$0")/.."

# shellcheck source=./grafanactl-env.sh
source ./scripts/grafanactl-env.sh "$env_name"

command -v jq >/dev/null || { echo "error: missing dependency: jq" >&2; exit 1; }
command -v grafanactl >/dev/null \
  || { echo "error: missing dependency: grafanactl" >&2; exit 1; }

cfg="$(./scripts/render-config.sh "$env_name")"
remote="$(mktemp -d -t grafanactl-cleanup.XXXXXX)"
trap 'rm -f "$cfg"; rm -rf "$remote"' EXIT

# Pull live dashboards + folders. Same explicit-kind argument as diff.sh —
# avoids the spurious 403/404 warnings grafanactl emits when scanning every
# resource kind.
grafanactl \
  --config "$cfg" \
  --context "$env_name" \
  resources pull \
  dashboards folders \
  --path "$remote" \
  >/dev/null

# Collect selectors for resources whose UID starts with `pr<n>-`, split by
# kind. The pulled tree groups manifests under `<remote>/Dashboard/<uid>.json`
# and `<remote>/Folder/<uid>.json` (kind in PascalCase), but we read kind from
# inside the file so layout changes in grafanactl wouldn't break this.
#
# We split by kind so dashboards can be deleted BEFORE the folder they live
# in: Grafana refuses to delete a non-empty folder ("400 BadRequest: Folder
# cannot be deleted: folder is not empty"), and a single
# `grafanactl resources delete dashboards/... folders/...` call processes
# selectors in argv order without dependency awareness.
dashboard_selectors=()
folder_selectors=()
while IFS= read -r -d '' f; do
  uid="$(jq -r '.metadata.name // ""' "$f")"
  [[ -n "$uid" ]] || continue
  [[ "$uid" == "pr${pr_number}-"* ]] || continue
  # grafanactl's resource-selector form is `<plural-lowercase-kind>/<uid>`.
  # Map Dashboard → dashboards, Folder → folders.
  case "$(jq -r '.kind // ""' "$f")" in
    Dashboard) dashboard_selectors+=("dashboards/${uid}") ;;
    Folder)    folder_selectors+=("folders/${uid}") ;;
    *)         echo "warning: unknown kind in $f — skipping" >&2 ;;
  esac
done < <(find "$remote" -type f -name '*.json' -print0)

total=$(( ${#dashboard_selectors[@]} + ${#folder_selectors[@]} ))
if [[ "$total" -eq 0 ]]; then
  echo "no preview resources found for PR #${pr_number}" >&2
  exit 0
fi

echo "deleting ${total} preview resource(s) for PR #${pr_number}:" >&2
printf '  %s\n' "${dashboard_selectors[@]}" "${folder_selectors[@]}" >&2

# Two passes: dashboards first, folders second. --on-error=ignore makes
# re-runs safe — if a sibling resource was already deleted manually
# between the pull and this delete, we don't want the rest of the
# cleanup to abort.
if [[ ${#dashboard_selectors[@]} -gt 0 ]]; then
  grafanactl \
    --config "$cfg" \
    --context "$env_name" \
    resources delete \
    --on-error ignore \
    "${dashboard_selectors[@]}"
fi

if [[ ${#folder_selectors[@]} -gt 0 ]]; then
  grafanactl \
    --config "$cfg" \
    --context "$env_name" \
    resources delete \
    --on-error ignore \
    "${folder_selectors[@]}"
fi
