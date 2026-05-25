#!/usr/bin/env bash
# render-preview.sh — Render a per-PR preview tree for staging Grafana.
#
# Output: prints a tempdir path on stdout. The tree contains only the
# dashboards the PR changed (vs --base-ref) plus the folder(s) they live in,
# with `metadata.name` (UID), `spec.title`, and each dashboard's
# `metadata.annotations["grafana.app/folder"]` rewritten so the resources
# can coexist with the canonical staging copies. Push or delete the result
# with `grafanactl resources push|delete --path <out>`.
#
# When the PR doesn't change any dashboards, exits 0 with no stdout.
#
# Usage:
#   ./scripts/render-preview.sh --pr <n> --base-ref <ref> [--env <name>]
#
# --env defaults to staging and only affects the apply-style template
# substitutions (REALM_SERVER_URL, GRAFANA_SECRET, __ENV__) — the preview
# rewrites are env-independent.
#
# Scope: dashboards + folders only. Data sources, alert rules, and the home-
# dashboard preference are file-provisioned at Grafana startup and can't be
# previewed per-PR; the existing observability-diff.yml comment already
# surfaces their changes.
#
# Cross-dashboard drill-through links inside the dashboard JSON (`/d/<uid>/`
# strings) are intentionally NOT rewritten — they stay pointing at the
# canonical staging dashboards (CS-11106 design call). UID references inside
# `datasource.uid` fields are data-source UIDs, not dashboard UIDs, and are
# also left alone.
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
[[ "$pr_number" =~ ^[0-9]+$ ]] || usage_error "--pr must be a positive integer"

command -v jq >/dev/null || { echo "error: missing dependency: jq" >&2; exit 1; }

# Validate base ref up front — mirrors diff.sh's check so a missing /
# unfetched ref surfaces with actionable guidance instead of a noisy
# git error under set -e.
if ! git rev-parse --verify --quiet "${base_ref}^{commit}" >/dev/null; then
  echo "error: --base-ref=$base_ref does not resolve to a commit." \
       "In CI, ensure the workflow does \`git fetch origin <base-ref>\` (or" \
       "\`actions/checkout\` with \`fetch-depth: 0\`)." >&2
  exit 1
fi

cd "$(dirname "$0")/.."

# Identify PR-changed dashboard files. `git -C <repo-root>` keeps the
# pathspec repo-rooted regardless of CWD (same pitfall called out in diff.sh).
# --diff-filter=ACMRT excludes deletions: `push` is upsert-only, so a deleted
# dashboard simply doesn't appear in the preview tree. Folder-only changes
# don't produce a preview either — the changed dashboards are what reviewers
# need to see live, and we only create preview folders for dashboards that
# land in them.
repo_root="$(git rev-parse --show-toplevel)"
changed_paths="$(git -C "$repo_root" diff --name-only --diff-filter=ACMRT \
  "${base_ref}...HEAD" \
  -- packages/observability/grafanactl/resources/dashboards/)"

if [[ -z "$changed_paths" ]]; then
  # No dashboard changes — nothing to preview. Empty stdout signals
  # "skip" to the caller.
  exit 0
fi

# Per-env substitution defaults mirror apply.sh exactly so the rendered
# preview matches what `apply.sh --env <env>` would push.
case "$env_name" in
  local)
    realm_server_url="${REALM_SERVER_URL:-http://localhost:4201/}"
    if [[ -n "${GRAFANA_SECRET:-}" ]]; then
      grafana_secret="$GRAFANA_SECRET"
    else
      grafana_secret="shhh! it's a secret"
    fi
    ;;
  staging | production)
    [[ -n "${REALM_SERVER_URL:-}" ]] \
      || { echo "error: REALM_SERVER_URL not set; required for --env=$env_name (CI fetches it from /${env_name}/boxel-grafana/realm_server_url)" >&2; exit 1; }
    [[ -n "${GRAFANA_SECRET:-}" ]] \
      || { echo "error: GRAFANA_SECRET not set; required for --env=$env_name" >&2; exit 1; }
    realm_server_url="$REALM_SERVER_URL"
    grafana_secret="$GRAFANA_SECRET"
    ;;
  *)
    usage_error "unknown env: $env_name (expected local|staging|production)" ;;
esac

rendered="$(mktemp -d -t grafanactl-preview.XXXXXX)"
# Intentionally NOT trapping rm on $rendered — the caller (apply-preview.sh,
# tests) consumes the path from stdout. Caller is responsible for cleanup.
cp -R ./grafanactl/resources/. "$rendered/"

# Step 1 — apply.sh-style template substitutions on every dashboard. Run
# before the preview rewrites so the changed-set walk below sees the
# substituted forms (matters in case any of the substituted fields ever
# overlap with the preview-rewrite jq paths in the future).
while IFS= read -r -d '' f; do
  jq --arg url "$realm_server_url" --arg secret "$grafana_secret" --arg envname "$env_name" '
    walk(
      if type == "object"
         and .name? == "realm_server"
         and .type? == "constant"
         and .query? == "__REALM_SERVER_URL__"
      then
        .query = $url
        | (if .current then .current.value = $url | .current.text = $url else . end)
      elif type == "object"
         and .name? == "grafana_secret"
         and .type? == "constant"
         and .query? == "REPLACE_AT_APPLY_TIME"
      then
        .query = $secret
        | (if .current then .current.value = $secret | .current.text = $secret else . end)
      elif type == "object"
         and .name? == "env"
         and .type? == "constant"
         and .query? == "__ENV__"
      then
        .query = $envname
        | (if .current then .current.value = $envname | .current.text = $envname else . end)
      else . end
    )
  ' "$f" > "$f.tmp"
  mv "$f.tmp" "$f"
done < <(find "$rendered/dashboards" -type f -name '*.json' -print0)

# Build a set of changed dashboard paths relative to grafanactl/resources/,
# stored as a newline-delimited string for bash 3.2 compatibility (same
# pattern diff.sh uses for filter_paths). Each entry looks like
# `dashboards/boxel-status/overview.json`.
changed_set=""
while IFS= read -r line; do
  rel="${line#packages/observability/grafanactl/resources/}"
  changed_set="${changed_set}${rel}"$'\n'
done <<< "$changed_paths"

# Grafana UIDs are at most 40 chars and must be alphanumeric / `-` / `_`.
# `pr<digits>-` adds 3 chars for a PR < 10, up to ~8 for a 5-digit PR.
# Truncate from the right (the original-uid tail) if combined exceeds 40.
# This is deterministic — same orig uid + same pr number = same new uid —
# so dashboard→folder pointers stay aligned even after truncation.
prefix_uid() {
  local pr="$1" orig="$2" combined
  combined="pr${pr}-${orig}"
  if [[ ${#combined} -gt 40 ]]; then
    combined="${combined:0:40}"
  fi
  echo "$combined"
}

# Step 2 — filter dashboards to the changed set, rewriting each kept file's
# UID + folder pointer + title. Collect referenced folder UIDs so we know
# which folder files to keep & rewrite in step 3.
referenced_folders=""
while IFS= read -r -d '' f; do
  rel="${f#"$rendered/"}"
  if [[ "$changed_set" != *"${rel}"$'\n'* ]]; then
    rm "$f"
    continue
  fi

  orig_folder="$(jq -r '(.metadata.annotations // {})["grafana.app/folder"] // ""' "$f")"
  orig_uid="$(jq -r '.metadata.name // ""' "$f")"
  if [[ -z "$orig_uid" ]]; then
    echo "error: $f has no metadata.name" >&2
    exit 1
  fi
  new_uid="$(prefix_uid "$pr_number" "$orig_uid")"
  new_folder=""
  if [[ -n "$orig_folder" ]]; then
    new_folder="$(prefix_uid "$pr_number" "$orig_folder")"
    referenced_folders="${referenced_folders}${orig_folder}"$'\n'
  fi

  jq --arg uid "$new_uid" \
     --arg folder "$new_folder" \
     --arg prefix "[PR #${pr_number}] " '
    .metadata.name = $uid
    | (if $folder != "" and (.metadata.annotations // {})["grafana.app/folder"]
       then .metadata.annotations["grafana.app/folder"] = $folder
       else . end)
    | (if .spec.title then .spec.title = ($prefix + .spec.title) else . end)
  ' "$f" > "$f.tmp"
  mv "$f.tmp" "$f"
done < <(find "$rendered/dashboards" -type f -name '*.json' -print0)

# Prune empty subdirectories under dashboards/ left by the filter above so
# `grafanactl resources push` doesn't recurse into stale empty trees.
find "$rendered/dashboards" -type d -empty -delete 2>/dev/null || true

# Step 3 — folders: keep only those referenced by a kept dashboard, rewrite
# UID + title. Drop the rest (so the push doesn't create unused per-PR
# folders for unchanged areas).
while IFS= read -r -d '' f; do
  orig_uid="$(jq -r '.metadata.name // ""' "$f")"
  if [[ -z "$orig_uid" ]] || [[ "$referenced_folders" != *"${orig_uid}"$'\n'* ]]; then
    rm "$f"
    continue
  fi
  new_uid="$(prefix_uid "$pr_number" "$orig_uid")"
  jq --arg uid "$new_uid" --arg prefix "Preview – PR #${pr_number}: " '
    .metadata.name = $uid
    | (if .spec.title then .spec.title = ($prefix + .spec.title) else . end)
  ' "$f" > "$f.tmp"
  mv "$f.tmp" "$f"
done < <(find "$rendered/folders" -type f -name '*.json' -print0)

# Final sanity: if everything got pruned (shouldn't happen given the
# changed_paths early-exit above, but the changed file could be e.g. a
# README under dashboards/ that's not a JSON manifest), bail cleanly so
# the caller can short-circuit instead of pushing an empty tree.
if [[ -z "$(find "$rendered/dashboards" -type f -name '*.json' 2>/dev/null)" ]]; then
  rm -rf "$rendered"
  exit 0
fi

echo "$rendered"
