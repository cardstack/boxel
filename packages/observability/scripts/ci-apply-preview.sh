#!/usr/bin/env bash
# ci-apply-preview.sh — one environment's half of the PR preview.
#
# Called once per environment by observability-preview.yml.
#
# Fetches the apply-time secrets for $ENV_NAME from SSM, pushes the per-PR
# preview with apply-preview.sh, and reports the result back to the workflow
# on $GITHUB_OUTPUT:
#
#   out_file=<path>   structured `<KIND>:<uid>:<title>` summary (see
#                     apply-preview.sh); empty file when nothing was pushed
#   empty=true|false  whether this PR's HEAD changes any dashboards
#
# Lives here rather than inline in either workflow so staging and production
# run byte-identical logic — the environments differ only in $ENV_NAME and
# in which AWS credentials the caller configured before invoking this.
#
# Environment (all set by the workflow step):
#   ENV_NAME      staging | production
#   PR_NUMBER     the pull request number
#   PR_BASE_REF   the PR's base branch name (e.g. `main`), without `origin/`
#
# Prereqs: AWS credentials for $ENV_NAME already configured, grafanactl on
# PATH, CWD anywhere inside the repo.
set -eo pipefail

require_env() {
  [[ -n "${!1:-}" ]] || { echo "error: $1 is required" >&2; exit 2; }
}

require_env ENV_NAME
require_env PR_NUMBER
require_env PR_BASE_REF
require_env GITHUB_OUTPUT

case "$ENV_NAME" in
  staging | production) ;;
  *) echo "error: ENV_NAME must be staging or production (got: $ENV_NAME)" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."

# These two parameters are the whole grant of the boxel-observability-preview
# role, and the list is deliberately short: this script runs from the pull
# request's own checkout, so whatever it can read, a pull request can read.
# Adding an SSM read here means widening that role and handing the new value
# to unreviewed code — GRAFANA_SECRET and the Grafana database password are
# excluded for exactly that reason.
#
# GRAFANA_TOKEN is re-fetched by grafanactl-env.sh inside apply-preview.sh;
# fetching it here too is what registers the `::add-mask::`, so the value is
# redacted if grafanactl ever echoes it on a failure path.
ssm() {
  aws ssm get-parameter --name "$1" "${@:2}" \
    --query 'Parameter.Value' --output text
}

GRAFANA_TOKEN="$(ssm "/${ENV_NAME}/grafana/grafanactl_token" --with-decryption)"
echo "::add-mask::$GRAFANA_TOKEN"

REALM_SERVER_URL="$(ssm "/${ENV_NAME}/boxel-grafana/realm_server_url")"

export GRAFANA_TOKEN REALM_SERVER_URL

out_file="$(mktemp)"
echo "out_file=$out_file" >> "$GITHUB_OUTPUT"

./scripts/apply-preview.sh \
  --pr "$PR_NUMBER" \
  --base-ref "origin/${PR_BASE_REF}" \
  --env "$ENV_NAME" \
  > "$out_file"

if [[ -s "$out_file" ]]; then
  echo "empty=false" >> "$GITHUB_OUTPUT"
  echo "::group::Preview summary (${ENV_NAME})"
  cat "$out_file"
  echo "::endgroup::"
  exit 0
fi

echo "empty=true" >> "$GITHUB_OUTPUT"

# When the current head of the PR has no dashboard changes vs base,
# apply-preview emits empty output and pushes nothing. But a prior push to
# the same PR may have already applied a preview that's still live — revert /
# rebase scenarios. Run cleanup so the PR's footprint in this environment
# matches its current head; otherwise the daily sweep wouldn't catch this
# until PR close.
echo "no dashboard changes at this HEAD — clearing any preview left in ${ENV_NAME}"
./scripts/cleanup-preview.sh --pr "$PR_NUMBER" --env "$ENV_NAME"
