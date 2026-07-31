import { strictEqual } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const runTsEntry = join('scripts', 'run-ts-entry.mjs');

const verification = spawnSync(
  process.execPath,
  [runTsEntry, join('scripts', 'verify-authorization-fixtures.ts')],
  { cwd: process.cwd(), encoding: 'utf8' },
);

strictEqual(verification.status, 0, verification.stderr || verification.stdout);
strictEqual(verification.stdout.includes('1227 total assertions'), true);
strictEqual(verification.stdout.includes('491 Check'), true);
strictEqual(verification.stdout.includes('348 ListObjects'), true);
strictEqual(verification.stdout.includes('388 ListUsers'), true);

const conformance = spawnSync(
  process.execPath,
  [runTsEntry, join('scripts', 'run-authorization-conformance.ts')],
  { cwd: process.cwd(), encoding: 'utf8' },
);

strictEqual(conformance.status, 0, conformance.stderr || conformance.stdout);
strictEqual(conformance.stdout.includes('discovered=1227 passed=1227'), true);
strictEqual(conformance.stdout.includes('failed=0'), true);
strictEqual(conformance.stdout.includes('importer_failures=0'), true);
strictEqual(conformance.stdout.includes('unsupported=0'), true);

console.log('Authorization fixtures: pinned hashes and executable 1,227-case zero-skip accounting verified');
