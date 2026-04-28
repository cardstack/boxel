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
trap 'rm -rf "$cfg" "$remote"' EXIT

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

# Diff: <remote-current-state> → <committed-target>. Reading top-to-bottom
# in the diff shows what would CHANGE if we applied the committed state.
# Color is disabled because the diff is consumed by GitHub Actions or piped
# to a PR comment (terminal escapes don't render in either).
#
# Exit codes from `git diff --no-index`:
#   0 — files identical (committed == live)
#   1 — files differ — the diff IS the output, treat as success here
#   2+ — real error (unreadable paths, internal git error, etc.) — propagate
#
# Disable -e around the diff call so exit 1 doesn't kill the script, then
# explicitly check for 2+ and re-raise.
set +e
git diff \
  --no-index \
  --no-color \
  "$remote" \
  ./grafanactl/resources/
diff_exit=$?
set -e

if [[ "$diff_exit" -gt 1 ]]; then
  echo "git diff --no-index exited with $diff_exit (real error, not just a diff)" >&2
  exit "$diff_exit"
fi
