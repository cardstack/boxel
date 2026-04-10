import '../src/setup-logger';
import { existsSync } from 'node:fs';
import {
  computeSnapshotFingerprint,
  readSnapshotFingerprint,
  DEFAULT_SNAPSHOT_FIXTURES,
  DUMP_FILE,
  FINGERPRINT_FILE,
} from '../src/harness/db-snapshot';
import { CACHE_VERSION } from '../src/harness/shared';

function main(): void {
  if (!existsSync(DUMP_FILE)) {
    console.error(`ERROR: Missing snapshot dump file at ${DUMP_FILE}`);
    console.error('Run "pnpm cache:prepare" to create the snapshot.');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(FINGERPRINT_FILE)) {
    console.error(`ERROR: Missing fingerprint file at ${FINGERPRINT_FILE}`);
    console.error('Run "pnpm cache:prepare" to create the fingerprint.');
    process.exitCode = 1;
    return;
  }

  let committed = readSnapshotFingerprint();
  if (!committed) {
    console.error(`ERROR: Unable to parse ${FINGERPRINT_FILE}`);
    process.exitCode = 1;
    return;
  }

  let currentFingerprint = computeSnapshotFingerprint(DEFAULT_SNAPSHOT_FIXTURES);

  if (committed.fingerprint !== currentFingerprint) {
    console.error('ERROR: Database snapshot is stale.');
    console.error(`  Current source fingerprint: ${currentFingerprint}`);
    console.error(`  Committed fingerprint:      ${committed.fingerprint}`);
    console.error('');
    console.error(
      'The test fixtures, base realm, or source realm have changed.',
    );
    console.error(
      'Run "pnpm cache:prepare" to regenerate, then commit db-snapshots/.',
    );
    process.exitCode = 1;
    return;
  }

  if (committed.cacheVersion !== CACHE_VERSION) {
    console.error('ERROR: Snapshot uses outdated CACHE_VERSION.');
    console.error(
      `  Current: ${CACHE_VERSION}, Committed: ${committed.cacheVersion}`,
    );
    console.error('Run "pnpm cache:prepare" to rebuild.');
    process.exitCode = 1;
    return;
  }

  console.log('snapshot-freshness: OK');
}

main();
