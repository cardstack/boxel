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

set -euo pipefail

env_name="${1:-local}"

case "$env_name" in
  local)
    # Nothing to source — admin/admin is in the committed config.yaml.
    ;;
  staging | production)
    GRAFANA_TOKEN="$(aws ssm get-parameter \
      --name "/${env_name}/grafana/grafanactl_token" \
      --with-decryption \
      --query 'Parameter.Value' \
      --output text)"
    export GRAFANA_TOKEN
    echo "Sourced GRAFANA_TOKEN for ${env_name} (length: ${#GRAFANA_TOKEN})." >&2
    ;;
  *)
    echo "error: unknown env '${env_name}' (expected: local | staging | production)" >&2
    return 2 2>/dev/null || exit 2
    ;;
esac
