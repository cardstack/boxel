#!/usr/bin/env node

// Regenerates tests/test-module-timings.json — the per-test-file duration
// data that drives duration-weighted shard assignment (see
// tests/helpers/shard-modules.ts) — from a merged junit report of a full
// host CI run.
//
// The junit report identifies tests by QUnit module name, but shard
// assignment operates on test *files* (the keys of the `import.meta.glob`
// map in tests/index.html), so this script attributes each top-level QUnit
// module's total time to the test file that declares it by searching the
// test sources for the module title. Modules whose title can't be found
// (e.g. fully dynamic titles) are reported and their time is dropped; the
// affected files fall back to the default weight at runtime, so imperfect
// coverage degrades shard balance, never correctness.
//
// Usage:
//   gh run download <ci-host-run-id> --name host-test-report-merged -D /tmp/host-report
//   node scripts/generate-test-module-timings.mjs /tmp/host-report/host.xml
//
// Timings staleness also only degrades balance, so regeneration is only
// worthwhile when shard durations drift noticeably apart.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [junitPath] = process.argv.slice(2);

if (!junitPath) {
  console.error(
    'Usage: node scripts/generate-test-module-timings.mjs <merged-junit-xml>',
  );
  process.exit(1);
}

const testsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests');
const outputPath = join(testsDir, 'test-module-timings.json');

// ---------------------------------------------------------------------------
// Collect test files, keyed the same way as `import.meta.glob('./**/*-test.…')`
// in tests/index.html: './'-prefixed paths relative to tests/.
// ---------------------------------------------------------------------------

function walk(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walk(full));
    } else if (/-test\.(js|ts|gjs|gts)$/.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

const testFiles = walk(testsDir).map((full) => ({
  key: `./${relative(testsDir, full)}`,
  source: readFileSync(full, 'utf8'),
}));

// ---------------------------------------------------------------------------
// Sum junit testcase times per top-level QUnit module name.
// ---------------------------------------------------------------------------

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const xml = readFileSync(junitPath, 'utf8');
const timeByModule = new Map();
let totalTime = 0;

for (const match of xml.matchAll(
  /<testcase [^>]*name="([^"]*)"[^>]*time="([^"]*)"/g,
)) {
  const name = decodeEntities(match[1]);
  const time = parseFloat(match[2]);
  if (isNaN(time)) continue;

  // testcase names are "<module chain>: <test name>", with nested modules
  // joined by " > ". Attribution is per top-level module because that's
  // what appears verbatim in a `module(…)` call in a test file.
  const colonIdx = name.indexOf(':');
  if (colonIdx === -1) continue;
  const topModule = name.slice(0, colonIdx).split(' > ')[0].trim();

  // The warmup module is registered by the test harness itself
  // (tests/helpers/shard-warmup.ts), not a test file, and runs on every
  // shard regardless of assignment.
  if (topModule === '__shard_warmup__') continue;

  timeByModule.set(topModule, (timeByModule.get(topModule) ?? 0) + time);
  totalTime += time;
}

// ---------------------------------------------------------------------------
// Attribute each module's time to the test file declaring it.
// ---------------------------------------------------------------------------

const timings = {};
const unmatched = [];
let attributedTime = 0;

for (const [moduleName, time] of timeByModule) {
  // Prefer an exact quoted/backticked occurrence of the title; fall back to
  // a bare substring match, which catches titles that are a static prefix
  // of a longer (partially dynamic) module() argument.
  const quoted = testFiles.filter(({ source }) =>
    ["'", '"', '`'].some((q) => source.includes(`${q}${moduleName}`)),
  );
  const candidates = quoted.length
    ? quoted
    : testFiles.filter(({ source }) => source.includes(moduleName));

  if (candidates.length === 0) {
    unmatched.push({ moduleName, time });
    continue;
  }
  if (candidates.length > 1) {
    // Several files declare (or mention) this module name; the junit data
    // can't apportion the time between them, so split it evenly.
    console.warn(
      `ambiguous: "${moduleName}" appears in ${candidates.length} files; splitting evenly`,
    );
  }
  for (const { key } of candidates) {
    timings[key] = (timings[key] ?? 0) + time / candidates.length;
  }
  attributedTime += time;
}

const sorted = Object.fromEntries(
  Object.entries(timings)
    .map(([key, time]) => [key, Math.round(time * 10) / 10])
    .sort(([a], [b]) => (a < b ? -1 : 1)),
);

writeFileSync(outputPath, JSON.stringify(sorted, null, 2) + '\n');

const coverage = totalTime
  ? ((attributedTime / totalTime) * 100).toFixed(1)
  : 0;
const filesWithTimings = Object.keys(sorted).length;
console.log(
  `Wrote ${outputPath}: ${filesWithTimings}/${testFiles.length} test files, ` +
    `${coverage}% of ${Math.round(totalTime)}s attributed`,
);
if (unmatched.length) {
  console.warn(`\n${unmatched.length} modules could not be matched to a file:`);
  for (const { moduleName, time } of unmatched.sort(
    (a, b) => b.time - a.time,
  )) {
    console.warn(`  ${time.toFixed(1)}s  ${moduleName}`);
  }
}
