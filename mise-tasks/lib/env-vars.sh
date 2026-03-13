#!/bin/sh
# Shared environment computation for mise tasks.
# Sourced via .mise.toml [env] _.source — every mise task gets these variables automatically.
#
# NOTE: Service URLs, ports, and paths are NOT exported here yet. The existing
# shell scripts in packages/realm-server/scripts/ compute those themselves.
# Exporting them here would conflict because mise evaluates _.source at shell
# activation time (before BOXEL_ENVIRONMENT is set), and the cached values
# would shadow the scripts' own env-mode computation.
#
# These exports will be added when mise tasks replace the shell scripts.

compute_env_slug() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's|/|-|g; s|[^a-z0-9-]||g; s|-\+|-|g; s|^-\|-$||g'
}

export PGPORT="${PGPORT:-5435}"

if [ -n "${BOXEL_ENVIRONMENT:-}" ]; then
  ENV_SLUG=$(compute_env_slug "$BOXEL_ENVIRONMENT")
  export ENV_SLUG
  export ENV_MODE=true
else
  export ENV_SLUG=""
  export ENV_MODE=""
fi
