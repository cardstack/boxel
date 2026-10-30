#!/bin/sh
# Run the unit tests of the Synapse modules in support/synapse/modules inside
# the pinned Synapse image, where the synapse.* imports the modules need are
# available. module_api is mocked, so there is no Synapse boot, DB, or network
# — just each module's decision logic, such as the invite check's handling of
# service users and its reading of the realm server's answer.
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
  "${SYNAPSE_IMAGE:-matrixdotorg/synapse:v1.163.0}" \
  -m unittest discover -p 'test_*.py' -v
