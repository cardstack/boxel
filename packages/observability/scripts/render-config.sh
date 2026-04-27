#!/usr/bin/env bash
# Renders ./grafanactl/config.yaml to a tempfile with ${GRAFANA_TOKEN}
# substituted and current-context set to the requested env. Prints the
# absolute path of the rendered tempfile on stdout.
#
# Usage: cfg="$(./scripts/render-config.sh staging)"
#
# Why this exists: grafanactl's env-var override of GRAFANA_TOKEN only takes
# effect on the file's current-context, NOT on whatever --context flag is
# passed at invocation time. So passing the token via env var while the file
# names a different current-context silently fails with 401. Solution: render
# a per-invocation tempfile that has the token literal in the right context
# and current-context pointing at it.
set -euo pipefail

if ! command -v envsubst >/dev/null 2>&1; then
  echo "error: envsubst not found on PATH (part of the gettext package)." >&2
  echo "  macOS:        brew install gettext   # then: brew link --force gettext" >&2
  echo "  Ubuntu/Debian: apt-get install -y gettext-base" >&2
  echo "  Alpine:        apk add --no-cache gettext" >&2
  exit 1
fi

target_env="${1:-local}"
script_dir="$(cd "$(dirname "$0")" && pwd)"
src="$script_dir/../grafanactl/config.yaml"
out="$(mktemp -t grafanactl-config.XXXXXX)"

# Substitute ONLY ${GRAFANA_TOKEN}; everything else passes through literally.
# (Important — Grafana template syntax inside dashboard JSON also uses ${...}.)
GRAFANA_TOKEN="${GRAFANA_TOKEN:-}" envsubst '${GRAFANA_TOKEN}' < "$src" \
  | grep -v '^current-context:' \
  > "$out"

printf '\ncurrent-context: %s\n' "$target_env" >> "$out"

echo "$out"
