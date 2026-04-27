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

# Pull what's currently live into the tempdir. Suppress stdout so the
# user sees only the diff at the end; stderr (errors) still surface.
grafanactl \
  --config "$cfg" \
  --context "$env_name" \
  resources pull \
  --path "$remote" \
  >/dev/null

# Diff: <remote-current-state> → <committed-target>. Reading top-to-bottom
# in the diff shows what would CHANGE if we applied the committed state.
# Color is disabled because the diff is consumed by GitHub Actions or piped
# to a PR comment (terminal escapes don't render in either).
#
# `|| true`: git diff --no-index returns 1 when there's any diff. We treat
# that as expected output, not an error — the diff IS the output.
git diff \
  --no-index \
  --no-color \
  "$remote" \
  ./grafanactl/resources/ \
  || true
