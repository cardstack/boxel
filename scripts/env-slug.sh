#!/bin/sh
# Shared slug computation for environment names.
# Source this file and call compute_env_slug, or use resolve_env_slug
# which checks ENV_SLUG first (set by mise's env-vars.sh).
#
# Usage:
#   . "$(dirname "$0")/../../scripts/env-slug.sh"   # adjust path as needed
#   SLUG=$(resolve_env_slug)                          # uses ENV_SLUG or BOXEL_ENVIRONMENT
#   SLUG=$(compute_env_slug "my/Branch-Name")         # explicit input

compute_env_slug() {
  # Cap at 63 chars (DNS label limit) so the slug works as a hostname
  # label in `<service>.<slug>.localhost`. Chrome treats hostnames with
  # over-63-char labels as search queries instead of URLs. Strip any
  # leading/trailing hyphens after the cut so a truncate that lands on
  # a hyphen doesn't leave the slug ending in one.
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g' | cut -c -63 | sed 's|^-||; s|-$||'
}

# Use `${VAR:-}` so callers running under `set -u` (e.g.
# `mise-tasks/infra/ensure-dev-cert`) don't get killed by a bare
# reference to an unset env var — bash's nounset terminates the
# subshell before the surrounding `|| true` can run, so the parent
# script exits even though the substitution looks defensive.
resolve_env_slug() {
  if [ -n "${ENV_SLUG:-}" ]; then
    echo "${ENV_SLUG}"
  elif [ -n "${BOXEL_ENVIRONMENT:-}" ]; then
    compute_env_slug "${BOXEL_ENVIRONMENT}"
  fi
}
