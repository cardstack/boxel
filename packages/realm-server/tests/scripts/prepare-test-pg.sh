#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"

TEST_PG_SEED_TAR="${TEST_PG_SEED_TAR:-/tmp/boxel-realm-test-pgdata-seeded.tar}"
TEST_PG_SEED_FINGERPRINT="${TEST_PG_SEED_FINGERPRINT:-/tmp/boxel-realm-test-pgdata-seeded.fingerprint}"

compute_seed_fingerprint() {
  node - "$ROOT_DIR" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const rootDir = process.argv[2];
const hash = crypto.createHash('sha256');

function walk(dir) {
  let entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  let files = [];
  for (let entry of entries) {
    let fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

let files = [
  ...walk(path.join(rootDir, 'packages/postgres/migrations')),
  path.join(rootDir, 'packages/postgres/scripts/fix-migration-names.ts'),
  path.join(rootDir, 'packages/realm-server/tests/scripts/create_seeded_db.sh'),
  path.join(rootDir, 'packages/realm-server/tests/scripts/boot_preseeded.sh'),
];

for (let file of files) {
  let rel = path.relative(rootDir, file).replaceAll(path.sep, '/');
  hash.update(rel);
  hash.update('\0');
  hash.update(fs.readFileSync(file));
  hash.update('\0');
}

process.stdout.write(hash.digest('hex'));
NODE
}

mkdir -p "$(dirname "$TEST_PG_SEED_TAR")"
mkdir -p "$(dirname "$TEST_PG_SEED_FINGERPRINT")"

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
