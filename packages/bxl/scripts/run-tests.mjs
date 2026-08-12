#!/usr/bin/env node
/**
 * Run every BXL test suite.
 *
 * Each suite is a standalone `.ts` entry point that asserts with
 * `node:assert` and prints one summary line. Node runs them directly
 * — the package is erasable TypeScript with `.ts` import specifiers,
 * so no loader hook or transpile step is involved.
 *
 * Pass a directory to run a subset: `pnpm test tests/boxel`.
 * Exits non-zero if any suite fails.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const packageRoot = join(import.meta.dirname, '..');

const filterArg = process.argv[2];
const allRoots = ['tests/unit', 'tests/smoke', 'tests/boxel'];
const roots = filterArg ? [filterArg.replace(/\/$/, '')] : allRoots;

const suites = roots.flatMap((root) =>
  readdirSync(join(packageRoot, root))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(root, f)),
);

let failures = 0;
for (const suite of suites) {
  const result = spawnSync(process.execPath, [join(packageRoot, suite)], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  const summary = (result.stdout || '').trim().split('\n').pop() || '';
  const label = suite.padEnd(36);
  if (result.status === 0) {
    console.log(`OK   ${label} ${summary}`);
  } else {
    failures++;
    console.log(`FAIL ${label}`);
    if (result.stderr)
      console.log(result.stderr.trim().split('\n').slice(-5).join('\n'));
    if (result.stdout)
      console.log(result.stdout.trim().split('\n').slice(-5).join('\n'));
  }
}

console.log('');
console.log(`${suites.length - failures} / ${suites.length} suites passed`);
process.exit(failures);
