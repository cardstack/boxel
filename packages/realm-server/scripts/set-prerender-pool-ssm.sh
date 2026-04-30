#!/usr/bin/env bash
# Activate the dynamic-pool / priority-aware-tiered prerender pool by
# setting the operational SSM values on a deployed environment. This
# is the script-form of the operational rollout step — running it
# flips the prerender server's PagePool from legacy fixed-size to
# the dynamic envelope.
#
# Pre-requisites:
#   - Both code-side PRs and Terraform-side PRs from the CS-10976
#     stack must be deployed: PR 8 (PagePool expansion), PR 9
#     (high-priority tier), PR 11 (drop deadlock-safety reservation)
#     in boxel; PR 7 (SSM secret pass-through) and PR 10 (ECS task
#     resize to 2 vCPU / 16 GB) in infra.
#   - AWS profile with `boxel-claude-readonly`-equivalent (or the
#     ssm:PutParameter equivalent) credentials. The default profile
#     `claude-staging` / `claude-prod` from the aws-access claude
#     skill will work for read-only verification but NOT for setting
#     parameters; use a profile with write access.
#
# Idempotent: the script overwrites the SSM parameter values
# created by infra PR 7 (which seeded them with `value = "0"` to
# satisfy the SSM API minimum-length constraint while keeping the
# code in legacy fixed-pool mode). Re-running the script is safe.

set -euo pipefail

ENV="${1:-}"
if [[ "$ENV" != "staging" && "$ENV" != "production" ]]; then
  echo "usage: $0 <staging|production>" >&2
  exit 1
fi

PROFILE="${AWS_PROFILE:-cardstack-${ENV}}"
PREFIX="/${ENV}/boxel"

# Default values per the CS-10976 plan, validated against staging
# telemetry captured 2026-04-30. See PR description for the
# derivation. Override via env vars to adjust per-environment.
MIN="${PRERENDER_PAGE_POOL_MIN_VALUE:-2}"
MAX="${PRERENDER_PAGE_POOL_MAX_VALUE:-6}"
HP_MAX="${PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX_VALUE:-8}"
THRESHOLD="${PRERENDER_HIGH_PRIORITY_THRESHOLD_VALUE:-5}"
IDLE_MS="${PRERENDER_POOL_IDLE_CONTRACTION_MS_VALUE:-60000}"
SHARED_CAP="${PRERENDER_SHARED_CONTEXT_CAP_VALUE:-12}"

echo "Setting prerender pool SSM values on ${ENV}:"
printf '  %-42s = %s\n' \
  "PRERENDER_PAGE_POOL_MIN" "$MIN" \
  "PRERENDER_PAGE_POOL_MAX" "$MAX" \
  "PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX" "$HP_MAX" \
  "PRERENDER_HIGH_PRIORITY_THRESHOLD" "$THRESHOLD" \
  "PRERENDER_POOL_IDLE_CONTRACTION_MS" "$IDLE_MS" \
  "PRERENDER_SHARED_CONTEXT_CAP" "$SHARED_CAP"
echo

put() {
  local name="$1"
  local value="$2"
  aws --profile "$PROFILE" ssm put-parameter \
    --name "${PREFIX}/${name}" \
    --value "$value" \
    --overwrite \
    --query 'Version' --output text
}

put PRERENDER_PAGE_POOL_MIN              "$MIN"
put PRERENDER_PAGE_POOL_MAX              "$MAX"
put PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX "$HP_MAX"
put PRERENDER_HIGH_PRIORITY_THRESHOLD    "$THRESHOLD"
put PRERENDER_POOL_IDLE_CONTRACTION_MS   "$IDLE_MS"
put PRERENDER_SHARED_CONTEXT_CAP         "$SHARED_CAP"

echo
echo "Done. ECS task definition does NOT auto-restart on SSM-value"
echo "changes — to pick up the new values, force a new deployment of"
echo "boxel-prerender-server-${ENV}:"
echo
echo "  aws --profile $PROFILE ecs update-service \\"
echo "    --cluster ${ENV} \\"
echo "    --service boxel-prerender-server-${ENV} \\"
echo "    --force-new-deployment"
