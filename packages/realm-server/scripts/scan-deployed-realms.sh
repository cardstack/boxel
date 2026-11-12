#! /bin/sh
# Appends a `scan` event to the change journal for each realm the deploy's
# `setup:*-in-deployment` steps rsync into place, so realm-historian records
# what the rsync changed as one revision attributed to the deploy: by the
# realm's Matrix bot, naming the repository and the commit deployed. The start
# scripts run it after those steps, with their environment's Matrix server
# name:
#
#   sh scan-deployed-realms.sh <matrix-server-name>
#
# The realms are the ones the setup steps rsync, each named by the --path and
# --username the realm server mounts it with. A realm whose setup step only
# makes its directory isn't here: nothing outside the realm writes its files.
# tests/deploy-scan-realms-test.ts holds this list to both start scripts.
# The deployed commit is $BOXEL_COMMIT, which the image is built with, or else
# the checkout's HEAD.
#
# History must never hold up the realm server, so a failure is logged and the
# script still exits 0.

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
MATRIX_SERVER_NAME="$1"

if [ -z "$MATRIX_SERVER_NAME" ]; then
  echo "Usage: $0 <matrix-server-name>" >&2
  exit 1
fi

# The realm server's kill switch for history stops every journal write,
# these included.
if [ "$REALM_HISTORY_JOURNAL" = off ]; then
  echo "[scan-deployed-realms] REALM_HISTORY_JOURNAL=off, so no scan events are appended" >&2
  exit 0
fi

COMMIT="${BOXEL_COMMIT:-$(git -C "$SCRIPTS_DIR" rev-parse HEAD 2>/dev/null)}"
if [ -z "$COMMIT" ]; then
  echo "[scan-deployed-realms] the deployed commit is unknown, so the scan events name none" >&2
fi

NODE_NO_WARNINGS=1 node "$SCRIPTS_DIR/../../realm-historian/scripts/scan.ts" \
  --matrixServerName="$MATRIX_SERVER_NAME" \
  --source='cardstack/boxel' \
  --commit="$COMMIT" \
  --realm='/persistent/base:base_realm' \
  --realm='/persistent/experiments:experiments_realm' \
  --realm='/persistent/pretui:pretui_realm' \
  --realm='/persistent/software-factory:software_factory_realm' \
  --realm='/persistent/openrouter:openrouter_realm' \
  --realm='/persistent/choreo-gallery:choreo_gallery_realm' ||
  echo "[scan-deployed-realms] appending the scan events failed, so realm history may record this deploy's changes as unattributed" >&2

exit 0
