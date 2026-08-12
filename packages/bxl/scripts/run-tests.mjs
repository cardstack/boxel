#!/usr/bin/env node
/**
 * Run every test suite under tests/unit/ and tests/smoke/ through Node's
 * tsx loader hook, not the tsx CLI.
 * Prints a summary line from each and a final pass/fail count.
 * Exits non-zero if any suite fails.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// Optional filter: `npm run test -- tests/boxel` runs only that
// subdirectory. With no argument we run every suite under
// tests/unit, tests/smoke, and tests/boxel.
const filterArg = process.argv[2];
const allRoots = ['tests/unit', 'tests/smoke', 'tests/boxel'];
const roots = filterArg ? [filterArg.replace(/\/$/, '')] : allRoots;

const suites = roots.flatMap((root) =>
  readdirSync(join(repoRoot, root))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(root, f)),
);

let failures = 0;
for (const suite of suites) {
  const result = spawnSync(process.execPath, [join(repoRoot, 'scripts/run-ts-entry.mjs'), suite], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const summary = (result.stdout || '').trim().split('\n').pop() || '';
  const label = suite.padEnd(36);
  if (result.status === 0) {
    console.log(`OK   ${label} ${summary}`);
  } else {
    failures++;
    console.log(`FAIL ${label}`);
    if (result.stderr) console.log(result.stderr.trim().split('\n').slice(-5).join('\n'));
    if (result.stdout) console.log(result.stdout.trim().split('\n').slice(-5).join('\n'));
  }
}

console.log('');
console.log(
  `${suites.length - failures} / ${suites.length} suites passed`,
);
process.exit(failures);
