#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
source "${SCRIPT_DIR}/test-pg-config.sh"

compute_seed_fingerprint() {
  (
    cd "$ROOT_DIR"
    find packages/postgres/migrations -type f -print0 \
      | sort -z \
      | xargs -0 md5sum
    md5sum \
      packages/realm-server/tests/scripts/create_seeded_db.sh \
      packages/realm-server/tests/scripts/test-pg-config.sh
  ) | md5sum | awk '{ print $1 }'
}

mkdir -p "$TEST_PG_CACHE_DIR"

"${SCRIPT_DIR}/stop-test-pg.sh"

current_fingerprint="$(compute_seed_fingerprint)"
previous_fingerprint=""
if [ -f "$TEST_PG_SEED_FINGERPRINT" ]; then
  previous_fingerprint="$(cat "$TEST_PG_SEED_FINGERPRINT")"
fi

if [ ! -f "$TEST_PG_SEED_TAR" ] || [ "$current_fingerprint" != "$previous_fingerprint" ]; then
  if [ ! -f "$TEST_PG_SEED_TAR" ]; then
    echo "Building seeded test postgres tar (missing seed tar)"
  else
    echo "Rebuilding seeded test postgres tar (migration fingerprint changed)"
  fi
  "${SCRIPT_DIR}/create_seeded_db.sh"
  printf '%s\n' "$current_fingerprint" > "$TEST_PG_SEED_FINGERPRINT"
else
  echo "Seeded test postgres tar is up to date"
fi

"${SCRIPT_DIR}/start-test-pg.sh"
