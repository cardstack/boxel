#!/usr/bin/env bash
# diff.sh — Show the diff between this package's committed
# `grafanactl/resources/` state and the live state of a target Grafana
# environment. Used by CS-10933's PR comment workflow + ad-hoc by humans
# wanting a preview before a `./scripts/apply.sh` push.
#
# Usage:
#   ./scripts/diff.sh [--env local|staging|production]
#
# Output: human-readable diff on stdout. Empty output (and exit 0) means
# the committed state matches the live state.
#
# Scope: this only diffs the resources grafanactl manages — dashboards
# and folders. The `provisioning/` tree (data sources, alert rules) is
# delivered to Grafana via file mount at startup, not via API push, so
# there's no live "current state" to diff against from the outside. PR
# review of those YAMLs is the only check.
#
# CS-10933 chose this "Path B" implementation because grafanactl has
# no native `diff` subcommand — confirmed by `grafanactl resources --help`.
set -eo pipefail

usage_error() { echo "error: $1" >&2; exit 2; }

env_name=staging
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      [[ $# -ge 2 && "$2" != --* ]] || usage_error "missing value for --env"
      env_name="$2"
      shift 2
      ;;
    --env=*)
      env_name="${1#--env=}"
      [[ -n "$env_name" ]] || usage_error "missing value for --env"
      shift
      ;;
    *)
      usage_error "unknown option: $1"
      ;;
  esac
done

cd "$(dirname "$0")/.."

# shellcheck source=./grafanactl-env.sh
source ./scripts/grafanactl-env.sh "$env_name"

cfg="$(./scripts/render-config.sh "$env_name")"
remote="$(mktemp -d -t grafanactl-pull.XXXXXX)"
remote_norm="$(mktemp -d -t grafanactl-norm.XXXXXX)"
trap 'rm -rf "$cfg" "$remote" "$remote_norm"' EXIT

# Pull what's currently live into the tempdir. We pass explicit kind
# arguments (`dashboards folders`) instead of letting grafanactl
# enumerate everything because the default scan would also try to list
# `plugins.grafana.app` (the service-account token doesn't have
# permission — 403) and `features.grafana.app/noop` (404, doesn't exist
# on the Grafana version we run). Both warnings would fail the pull
# even though we don't actually want those kinds for the diff.
#
# Suppress stdout so the user sees only the diff at the end; stderr
# (errors) still surface.
grafanactl \
  --config "$cfg" \
  --context "$env_name" \
  resources pull \
  dashboards folders \
  --path "$remote" \
  >/dev/null

# Normalize the pulled tree so it has the same layout as the committed
# tree, matching by UID. Two reasons:
#
#   1. grafanactl pull writes `<remote>/Dashboard/<uid>.json` (and
#      `<remote>/Folder/<uid>.json`); the committed tree groups
#      dashboards under a folder name. Without normalization,
#      `git diff --no-index` would render every file as a full add+
#      delete pair even when the dashboard is unchanged.
#   2. `grafanactl resources push` is upsert-only — it does NOT delete
#      live resources missing from our manifest set. Pulled files with
#      no committed counterpart (UI-created dashboards, AMG-era
#      artefacts) would otherwise show as "deleted file" in the diff,
#      suggesting an action that doesn't actually happen.
#
# So: for each committed file, look up the matching pulled file by UID
# (`metadata.name` in the App Platform schema, falling back to legacy
# spec.uid) and copy it to the same relative path inside $remote_norm.
# Pulled files without a committed counterpart get dropped silently.
# Committed files without a pulled counterpart leave their slot empty
# in $remote_norm so the diff renders them as "new file" (apply would
# create).
extract_uid() {  # $1: path to a committed manifest
  jq -r '.metadata.name // .spec.uid // .uid // empty' "$1"
}

normalize() {  # $1: subdir under grafanactl/resources, $2: pulled-kind dirname
  local subdir="$1" kind="$2"
  shopt -s nullglob globstar
  for committed in ./grafanactl/resources/${subdir}/**/*.json ./grafanactl/resources/${subdir}/*.json; do
    [[ -f "$committed" ]] || continue
    local uid pulled rel target
    uid="$(extract_uid "$committed")"
    [[ -n "$uid" ]] || continue
    pulled="${remote}/${kind}/${uid}.json"
    [[ -f "$pulled" ]] || continue
    rel="${committed#./grafanactl/resources/}"
    target="${remote_norm}/${rel}"
    mkdir -p "$(dirname "$target")"
    cp "$pulled" "$target"
  done
}

normalize dashboards Dashboard
normalize folders Folder

# Diff: <remote-current-state, normalized> → <committed-target>. Reading
# top-to-bottom shows what would CHANGE on apply. Pulled resources that
# aren't in our committed set are deliberately absent from the normalized
# tree (push won't touch them).
#
# Color is disabled because the diff is consumed by GitHub Actions or
# piped to a PR comment (terminal escapes don't render in either).
#
# Exit codes from `git diff --no-index`:
#   0 — files identical (committed == live)
#   1 — files differ — the diff IS the output, treat as success here
#   2+ — real error (unreadable paths, internal git error, etc.) — propagate
set +e
git diff \
  --no-index \
  --no-color \
  "$remote_norm" \
  ./grafanactl/resources/
diff_exit=$?
set -e

if [[ "$diff_exit" -gt 1 ]]; then
  echo "git diff --no-index exited with $diff_exit (real error, not just a diff)" >&2
  exit "$diff_exit"
fi
