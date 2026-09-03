#!/usr/bin/env node
/* eslint-env node */

// Regenerates tests/test-module-timings.json — the per-file duration data that
// drives duration-weighted shard assignment (see scripts/shard-test-modules.cjs)
// — from a merged junit report of a full realm-server CI run.
//
// Attribution is exact rather than inferred: the junit reporter records a
// test's outermost module as its testsuite name, and this suite names every
// top-level module after the file it lives in, so a suite name *is* a file
// name. (The host suite's equivalent has to match test titles against sources
// because its modules are not named after files.)
//
// Three shapes of that name are in use, and all three must resolve or a third
// of the runtime goes unattributed:
//
//   info-test.ts                      a file directly under tests/
//   realm-endpoints/info-test.ts      a nested file, path-qualified
//   node-realm-test.ts | file stat …  a file's second top-level module
//
// The times of a file's several suites are summed.
//
// Files absent from the report keep whatever the committed file already says,
// so a partial run degrades the weights rather than erasing them. Files that
// no longer exist on disk are dropped.
//
// Usage:
//   gh run download <ci-run-id> --name realm-server-test-report-merged -D /tmp/rs
//   node scripts/generate-test-module-timings.mjs /tmp/rs/realm-server.xml

import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  createResolver,
  discoverTestFiles,
  testsDir,
} from './test-module-names.mjs';

const timingsPath = join(testsDir, 'test-module-timings.json');

// A report whose suites are mostly unattributed means the reporter regressed
// (it emitted "default" for everything before it learned to read fullName).
// Writing those weights would quietly flatten the packing back to arbitrary,
// so refuse instead.
const MIN_ATTRIBUTED = 0.9;

const junitPath = process.argv[2];
if (!junitPath) {
  console.error(
    'Usage: node scripts/generate-test-module-timings.mjs <merged-junit-xml>',
  );
  process.exit(1);
}

const onDisk = discoverTestFiles();
const resolveFile = createResolver(onDisk);

const xml = readFileSync(junitPath, 'utf8');
const suites = [
  ...xml.matchAll(/<testsuite\s+name="([^"]*)"[^>]*\btime="([\d.]+)"/g),
];

let attributed = 0;
let total = 0;
const ambiguous = [];
const unmatched = [];
const timings = {};

for (const [, rawName, rawTime] of suites) {
  const name = rawName.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  const seconds = Number(rawTime);
  total += seconds;
  const file = resolveFile(name);
  if (file === null) {
    ambiguous.push(name);
    continue;
  }
  if (!file) {
    unmatched.push([name, seconds]);
    continue;
  }
  timings[file] = Number((timings[file] ?? 0) + seconds).toFixed(1) * 1;
  attributed += seconds;
}

if (total === 0) {
  console.error(`No testsuites with timings found in ${junitPath}.`);
  process.exit(1);
}

const coverage = attributed / total;
if (coverage < MIN_ATTRIBUTED) {
  console.error(
    `Only ${(coverage * 100).toFixed(1)}% of ${total.toFixed(0)}s could be attributed to a test file ` +
      `(floor is ${(MIN_ATTRIBUTED * 100).toFixed(0)}%). Unattributed suites:`,
  );
  for (const [name, seconds] of unmatched.slice(0, 10)) {
    console.error(`  ${seconds.toFixed(1)}s  ${name}`);
  }
  // The other way to fail: names that match several files. Without this the
  // list above is empty and the diagnosis below sends the reader to the
  // reporter, which is the wrong place to look.
  if (ambiguous.length) {
    console.error('Suite names matching more than one file:');
    for (const name of ambiguous.slice(0, 10)) {
      console.error(`  ${name}`);
    }
  }
  console.error(
    'A report where everything lands in one suite usually means the junit reporter ' +
      'is not recording fullName[0] — see scripts/junit-reporter.cjs. A scattering ' +
      'of free-form names instead means those top-level modules are not named after ' +
      'their file, which is what makes a suite name resolvable at all.',
  );
  process.exit(1);
}

let prior = {};
try {
  prior = JSON.parse(readFileSync(timingsPath, 'utf8'));
} catch {
  // First run: nothing to preserve.
}

const merged = {};
for (const file of onDisk) {
  const value = timings[file] ?? prior[file];
  if (value !== undefined) {
    merged[file] = value;
  }
}

writeFileSync(timingsPath, `${JSON.stringify(merged, null, 2)}\n`);

const fresh = onDisk.filter((f) => timings[f] !== undefined).length;
const kept = Object.keys(merged).length - fresh;
console.log(
  `Wrote ${relative(process.cwd(), timingsPath)}: ${fresh} files measured, ` +
    `${kept} kept from the previous file, ${(coverage * 100).toFixed(1)}% of ${total.toFixed(0)}s attributed.`,
);
if (ambiguous.length) {
  console.warn(
    `Skipped ${ambiguous.length} suite name(s) matching more than one file: ${ambiguous.join(', ')}`,
  );
}

// A file that no run has ever measured is packed at DEFAULT_WEIGHT, so a
// genuinely slow one distorts a shard for as long as it stays invisible. Above
// the coverage floor that is easy to miss, hence the list.
const unmeasured = onDisk.filter((file) => merged[file] === undefined);
if (unmeasured.length) {
  console.warn(
    `${unmeasured.length} file(s) have no recorded duration and will be packed at the ` +
      `default weight: ${unmeasured.sort().join(', ')}`,
  );
}
