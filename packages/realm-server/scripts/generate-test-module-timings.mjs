#!/usr/bin/env node

// Regenerates tests/test-module-timings.json — the per-file duration data that
// drives duration-weighted shard assignment (see scripts/shard-test-modules.cjs)
// — from a merged junit report of a full realm-server CI run.
//
// Attribution is exact rather than inferred: every test file opens with
// `module(basename(import.meta.filename), …)`, and the junit reporter records
// that outermost module as the testsuite name, so a suite name *is* a file
// name. (The host suite's equivalent has to match test titles against sources
// because its modules are not named after files.)
//
// Files absent from the report keep whatever the committed file already says,
// so a partial run degrades the weights rather than erasing them. Files that
// no longer exist on disk are dropped.
//
// Usage:
//   gh run download <ci-run-id> --name realm-server-test-report-merged -D /tmp/rs
//   node scripts/generate-test-module-timings.mjs /tmp/rs/realm-server.xml

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const testsDir = join(scriptDir, '..', 'tests');
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

function collectTestFiles(dir, prefix) {
  let files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files = files.concat(collectTestFiles(join(dir, entry.name), rel));
    } else if (entry.isFile() && entry.name.endsWith('-test.ts')) {
      files.push(rel);
    }
  }
  return files;
}

const onDisk = collectTestFiles(testsDir, '');
// Suite names are basenames; shard assignment works in paths relative to
// tests/. Map one to the other, and report a basename that matches two files
// rather than silently attributing both to whichever sorted first.
const byBasename = new Map();
for (const file of onDisk) {
  const base = file.split('/').pop();
  if (byBasename.has(base)) {
    byBasename.set(base, null);
  } else {
    byBasename.set(base, file);
  }
}

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
  const file = byBasename.get(name);
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
  console.error(
    'A report where everything lands in one suite usually means the junit reporter ' +
      'is not recording fullName[0] — see scripts/junit-reporter.cjs.',
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
for (const file of onDisk.sort()) {
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
