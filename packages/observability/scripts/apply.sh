#!/usr/bin/env bash
# Apply grafanactl resource manifests to the local Grafana container.
#
# Usage:
#   ./scripts/apply.sh           # applies everything under ./grafanactl/resources/
#   ./scripts/apply.sh --dry-run # preview without making changes
#
# Multi-environment support (--env staging|production) lands in CS-10913,
# which adds the SSM-token helper. For now this script targets local only
# and authenticates to the docker-compose Grafana with admin/admin.
#
# Prereqs:
#   - grafanactl installed (brew install --formula grafanactl)
#   - local Grafana running (docker compose up -d grafana)
set -euo pipefail

cd "$(dirname "$0")/.."

# --config points at the in-repo config so contexts stay version-controlled
# and shared across the team, not in each dev's ~/.config/grafanactl/.
exec grafanactl \
  --config ./grafanactl/config.yaml \
  --context local \
  resources push \
  --path ./grafanactl/resources \
  "$@"
