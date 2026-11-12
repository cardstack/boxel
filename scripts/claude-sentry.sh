#!/usr/bin/env bash
#
# claude-sentry.sh — call the Sentry REST API (cardstack.sentry.io) with the
# read-only token that the boxel-claude-readonly AWS role can read.
#
# The token belongs to a Sentry internal integration with only the
# org:read, project:read and event:read scopes. It is kept in SSM Parameter
# Store at /<env>/sentry/claude_readonly_token in the staging and production
# accounts, so any valid `mise run claude-aws <env> <MFA>` session can read
# it. There is no per-developer Sentry setup.
#
# The token is never printed and never put on a command line: it goes to
# curl as a header read from stdin.
#
# Usage:
#   claude-sentry.sh [--env staging|prod] <api-path> [extra curl args...]
#
#   <api-path> is relative to https://sentry.io/api/0/, for example
#   organizations/cardstack/issues/123/tags/
#
# Without --env, the script uses the claude-staging session and falls back
# to claude-prod. The Sentry org is the same in both accounts, so either one
# reads events from every Sentry environment.

set -euo pipefail

SENTRY_API_BASE="https://sentry.io/api/0"

fail() {
  echo "claude-sentry: $*" >&2
  exit 1
}

envs=(staging prod)
if [[ "${1:-}" == "--env" ]]; then
  [[ $# -ge 2 ]] || fail "--env needs a value (staging or prod)"
  case "$2" in
    staging | prod) envs=("$2") ;;
    production) envs=(prod) ;;
    *) fail "unknown env '$2' (expected staging or prod)" ;;
  esac
  shift 2
fi

[[ $# -ge 1 ]] || fail "usage: claude-sentry.sh [--env staging|prod] <api-path> [extra curl args...]"
api_path="${1#/}"
shift

command -v aws >/dev/null || fail "aws CLI not found"
command -v curl >/dev/null || fail "curl not found"

token=""
for env in "${envs[@]}"; do
  ssm_env="$env"
  [[ "$env" == "prod" ]] && ssm_env="production"
  if token="$(aws --profile "claude-${env}" ssm get-parameter \
    --name "/${ssm_env}/sentry/claude_readonly_token" \
    --with-decryption --query Parameter.Value --output text 2>/dev/null)"; then
    break
  fi
  token=""
done

[[ -n "$token" ]] ||
  fail "couldn't read the Sentry token from SSM with the claude-${envs[*]} profile(s). The AWS session may have expired: ask the user to run 'mise run claude-aws <env> <MFA_TOKEN>'."
[[ "$token" != "unset" ]] ||
  fail "the SSM parameter still holds its placeholder. A Sentry org owner must create the internal integration and store its token (see configs/boxel-claude-access in the infra repo)."

curl --silent --show-error --fail-with-body \
  -H @- \
  "$@" \
  "${SENTRY_API_BASE}/${api_path}" <<<"Authorization: Bearer ${token}"
