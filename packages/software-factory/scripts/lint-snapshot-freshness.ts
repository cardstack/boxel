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

function printError(headline: string, detail: string): void {
  console.error('');
  console.error(`lint:snapshot-freshness — ERROR`);
  console.error('');
  console.error(`  ${headline}`);
  if (detail) {
    console.error('');
    for (let line of detail.split('\n')) {
      console.error(`  ${line}`);
    }
  }
  console.error('');
  console.error('  To fix this, run the following from the repo root:');
  console.error('');
  console.error(
    '    cd packages/software-factory && pnpm cache:prepare --update-snapshot',
  );
  console.error('');
  console.error(
    '  This rebuilds the Playwright test database snapshot (~10 min on first run).',
  );
  console.error(
    '  Then commit the updated files in packages/software-factory/db-snapshots/.',
  );
  console.error('');
  console.error(
    '  NOTE: This requires a running PostgreSQL instance on the port configured',
  );
  console.error(
    '  for software-factory tests (default: 127.0.0.1:55436). If you do not have',
  );
  console.error(
    '  the test database infrastructure set up, ask someone on the team who works',
  );
  console.error(
    '  on the software-factory package to regenerate the snapshot.',
  );
  console.error('');
}

function main(): void {
  if (!existsSync(DUMP_FILE) || !existsSync(FINGERPRINT_FILE)) {
    printError(
      'The software-factory database snapshot files are missing.',
      'This usually means the snapshot has not been generated yet.',
    );
    process.exitCode = 1;
    return;
  }

  let committed = readSnapshotFingerprint();
  if (!committed) {
    printError(
      'The software-factory snapshot fingerprint file is corrupt or unreadable.',
      'The file exists but could not be parsed as JSON.',
    );
    process.exitCode = 1;
    return;
  }

  let currentFingerprint = computeSnapshotFingerprint(
    DEFAULT_SNAPSHOT_FIXTURES,
  );

  if (committed.fingerprint !== currentFingerprint) {
    printError(
      'The software-factory database snapshot is out of date.',
      [
        'Files in one of these directories have changed since the snapshot was last built:',
        '  - packages/base/                                          (base realm)',
        '  - packages/software-factory/realm/                        (source realm)',
        '  - packages/software-factory/test-fixtures/                (test fixtures)',
        '',
        `  Current source fingerprint: ${currentFingerprint}`,
        `  Committed fingerprint:      ${committed.fingerprint}`,
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  if (committed.cacheVersion !== CACHE_VERSION) {
    printError(
      'The software-factory snapshot was built with an outdated schema version.',
      `Current CACHE_VERSION: ${CACHE_VERSION}, snapshot was built with: ${committed.cacheVersion}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log('snapshot-freshness: OK');
}

main();
