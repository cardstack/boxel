#!/usr/bin/env bash
# Activate the dynamic-pool / priority-aware-tiered prerender pool by
# setting the operational SSM values on a deployed environment. This
# is the script-form of the operational rollout step — running it
# flips the prerender server's PagePool from legacy fixed-size to
# the dynamic envelope.
#
# CRITICAL PRE-REQUISITE — without this the script is a no-op at
# runtime: the deployed prerender server image must include the
# code that READS these env vars (the dynamic-pool block in
# `packages/realm-server/prerender/page-pool.ts`'s constructor that
# calls `parsePositiveInt(process.env.PRERENDER_PAGE_POOL_MIN)`
# etc.). On any older image those env vars are simply ignored and
# capacity stays driven by the legacy `PRERENDER_PAGE_POOL_SIZE`.
# Concretely: PR 8, PR 9, and PR 11 from the CS-10976 stack must
# be merged AND the latest image rolled out before this script
# does anything operationally.
#
# Pre-requisites:
#   - Code-side PRs deployed (PR 8 / PR 9 / PR 11 in boxel) and the
#     prerender server image rebuilt + rolled out from a commit
#     containing them.
#   - Infra-side PRs deployed: PR 7 (SSM secret pass-through that
#     creates the parameters this script overwrites) and PR 10
#     (ECS task resize to 2 vCPU / 16 GB, required for the
#     recommended HP_MAX=8 to fit memory).
#   - AWS profile with `ssm:PutParameter` on the target prefix.
#     The default `claude-staging` / `claude-prod` profiles from
#     the aws-access claude skill are read-only and will not work;
#     use a profile with write access.
#
# Idempotent: the script overwrites the SSM parameter values
# created by infra PR 7 (which seeded them with `value = "0"` to
# satisfy the SSM API minimum-length constraint while keeping the
# code in legacy fixed-pool mode). Re-running the script is safe.

set -euo pipefail

ENV="${1:-}"
if [[ "$ENV" != "staging" && "$ENV" != "production" ]]; then
  echo "usage: $0 <staging|production>" >&2
  echo >&2
  echo "CRITICAL: read the script header before running. The deployed" >&2
  echo "prerender server image must include the dynamic-pool code" >&2
  echo "(CS-10976 PR 8 + PR 9 + PR 11) or this script is a no-op at" >&2
  echo "runtime — env vars get set in SSM but the running code ignores" >&2
  echo "them and capacity stays driven by PRERENDER_PAGE_POOL_SIZE." >&2
  exit 1
fi

PROFILE="${AWS_PROFILE:-cardstack-${ENV}}"
PREFIX="/${ENV}/boxel"

# Surface the deployed image so the operator can sanity-check that
# the running code reads these env vars before we set them. Not
# airtight — image tags / digests don't disclose source revision —
# but catches the obvious "ran against the wrong cluster" mistake.
echo "Deployed prerender server image:"
TASK_ARN=$(aws --profile "$PROFILE" ecs list-tasks \
  --cluster "$ENV" --service-name "boxel-prerender-server-${ENV}" \
  --query 'taskArns[0]' --output text 2>/dev/null || echo "")
if [[ -n "$TASK_ARN" && "$TASK_ARN" != "None" ]]; then
  IMAGE=$(aws --profile "$PROFILE" ecs describe-tasks \
    --cluster "$ENV" --tasks "$TASK_ARN" \
    --query 'tasks[0].containers[?name==`boxel-prerender-server`].image | [0]' \
    --output text 2>/dev/null || echo "")
  echo "  $IMAGE"
else
  echo "  (couldn't list tasks — service may not be deployed yet)"
fi
echo "  Manual verification: confirm this image was built from a commit"
echo "  containing the CS-10976 dynamic-pool code in"
echo "  packages/realm-server/prerender/page-pool.ts (look for"
echo "  parsePositiveInt + PRERENDER_PAGE_POOL_MIN in the file)."
echo

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
