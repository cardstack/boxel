#!/bin/sh
# Pulls latest boxel-catalog into contents/.
#
# Tries `git pull` first so non-conflicting local edits (the documented
# local-dev workflow in ../README.md) are preserved in place. If the pull
# is rejected specifically because local/untracked files would be
# overwritten, stashes those (with a UTC-timestamped label) and retries.
# Any other failure — network, auth, diverged branch — is surfaced with
# git's original message.
set -e

# CI / sync-managed checkouts opt out: the caller has already placed the
# exact commit they want at contents/, so a `git pull` would either fail
# (detached HEAD) or silently move HEAD off the intended ref.
if [ -n "${SKIP_CATALOG_UPDATE:-}" ]; then
  echo "catalog: SKIP_CATALOG_UPDATE set, skipping update"
  exit 0
fi

# Anchor to packages/catalog/ so the script works regardless of CWD
# (e.g. `sh packages/catalog/scripts/catalog-update.sh` from repo root).
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPTS_DIR/.."

pnpm catalog:setup
cd contents

# Force English error messages so the detection grep below is locale-safe.
export LANG=C
export LC_ALL=C

if PULL_OUT=$(git pull 2>&1); then
  echo "$PULL_OUT"
  exit 0
fi

if echo "$PULL_OUT" | grep -qE 'untracked working tree files would be overwritten|Your local changes to the following files would be overwritten'; then
  STASH_LABEL="catalog:update autostash $(date -u +%Y%m%dT%H%M%SZ)"
  echo "catalog: pull blocked by local changes, stashing as '${STASH_LABEL}' and retrying..."
  git stash push --include-untracked -m "${STASH_LABEL}"
  git pull
  echo "catalog: updated. Stashed changes saved — review with:"
  echo "  (cd packages/catalog/contents && git stash list)"
  echo "Reapply with:"
  echo "  (cd packages/catalog/contents && git stash pop)"
  exit 0
fi

# Surface the original failure (network/auth/diverged/etc.)
echo "$PULL_OUT" >&2
exit 1
