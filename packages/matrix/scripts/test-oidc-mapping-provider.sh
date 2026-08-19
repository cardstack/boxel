#!/bin/sh
# Run the BoxelOidcMappingProvider unit tests inside the pinned Synapse image,
# where the synapse.* imports the module needs are available. module_api is
# mocked, so there is no Synapse boot, DB, or network — just the provider's
# email-match / ambiguity / no-match-collision decision logic.
#
# The image tag must match packages/matrix/support/synapse/index.ts.
set -eu
MODULES_DIR="$(cd "$(dirname "$0")/../support/synapse/modules" && pwd)"
exec docker run --rm \
  -v "$MODULES_DIR:/custom/modules:ro" \
  -w /custom/modules \
  -e PYTHONPATH=/custom/modules \
  -e PYTHONDONTWRITEBYTECODE=1 \
  --entrypoint python \
  matrixdotorg/synapse:v1.126.0 \
  -m unittest discover -p 'test_*.py' -v
