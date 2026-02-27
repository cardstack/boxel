#! /bin/sh
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

# Branch-mode configuration
if [ -n "$BOXEL_BRANCH" ]; then
  BRANCH_SLUG=$(echo "$BOXEL_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g')
  PRERENDER_PORT=0
  DEFAULT_HOST_URL="http://host.${BRANCH_SLUG}.localdev.boxel.ai"
else
  PRERENDER_PORT=4221
  DEFAULT_HOST_URL="http://localhost:4200"
fi

# Environment for development prerender server
NODE_ENV=development \
  NODE_NO_WARNINGS=1 \
  BOXEL_HOST_URL="${HOST_URL:-$DEFAULT_HOST_URL}" \
  ts-node \
  --transpileOnly prerender/prerender-server \
  --port="${PRERENDER_PORT}"
