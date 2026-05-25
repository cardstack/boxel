#!/usr/bin/env bash
# Source this script (don't execute it) to export GRAFANA_TOKEN for a given env.
#
# Usage:
#   source ./scripts/grafanactl-env.sh local
#   source ./scripts/grafanactl-env.sh staging
#   source ./scripts/grafanactl-env.sh production
#
# Local is a no-op (admin/admin in-config is sufficient).
# Staging and production fetch the token from SSM at /<env>/grafana/grafanactl_token,
# which is populated by the cardstack/infra Terraform.
#
# Requires AWS credentials with ssm:GetParameter on /<env>/grafana/* — the same
# creds devs already use for `/terraform-plan workspace=grafana/<env>`.
#
# CRITICAL: this script is meant to be SOURCED, so it deliberately does NOT
# use `set -euo pipefail`. If it did, any failing command would propagate
# `set -e` into the caller's shell and close the user's terminal. Errors
# are handled explicitly below.

_grafanactl_env_main() {
  local env_name="${1:-local}"
  local token_val=""
  local fetch_err=""

  case "$env_name" in
    local)
      # Local uses admin/admin from the rendered config. Actively clear any
      # GRAFANA_* env vars left over from a previous `source ... staging`
      # so grafanactl's env-var override doesn't replace local's basic auth
      # with a stale staging/prod token (would 401 against the local
      # admin/admin Grafana).
      unset GRAFANA_TOKEN GRAFANA_SERVER GRAFANA_ORG_ID GRAFANA_USER GRAFANA_PASSWORD GRAFANA_STACK_ID
      return 0
      ;;
    staging | production)
      # Capture stderr so we can show it on failure.
      if ! token_val="$(aws ssm get-parameter \
          --name "/${env_name}/grafana/grafanactl_token" \
          --with-decryption \
          --query 'Parameter.Value' \
          --output text 2>&1)"; then
        fetch_err="$token_val"
        printf 'error: failed to fetch /%s/grafana/grafanactl_token from SSM:\n' "$env_name" >&2
        printf '%s\n' "$fetch_err" >&2
        printf 'hint: confirm AWS creds active for the right account and ssm:GetParameter is granted.\n' >&2
        return 1
      fi
      GRAFANA_TOKEN="$token_val"
      export GRAFANA_TOKEN
      printf 'Sourced GRAFANA_TOKEN for %s (length: %d).\n' "$env_name" "${#GRAFANA_TOKEN}" >&2
      return 0
      ;;
    *)
      printf 'error: unknown env %q (expected: local | staging | production)\n' "$env_name" >&2
      return 2
      ;;
  esac
}

# Run the work in a function so `return` works for both source-and-execute paths
# without leaking flags.
_grafanactl_env_main "$@"
_grafanactl_env_rc=$?

# Clean up: don't leave helpers polluting the caller's shell namespace.
unset -f _grafanactl_env_main

# Mirror the function's return code, using `return` if sourced, `exit` if not.
# shellcheck disable=SC2317  # `return` works only when sourced; the `|| exit` fallback runs when executed.
return "$_grafanactl_env_rc" 2>/dev/null || exit "$_grafanactl_env_rc"
