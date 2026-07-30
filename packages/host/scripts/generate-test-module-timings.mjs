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
// coverage degrades shard balance, never correctness. If less than
// MIN_COVERAGE of the report's total time can be attributed, the script
// exits nonzero rather than write a degraded weights file.
//
// Test files absent from the report (a partial run, or a module whose
// junit output was lost) keep their values from the existing timings file,
// so a run that didn't observe a module never erases what is known about
// it. Files that no longer exist on disk are dropped.
//
// Usage:
//   gh run download <ci-host-run-id> --name host-test-report-merged -D /tmp/host-report
//   node scripts/generate-test-module-timings.mjs /tmp/host-report/host.xml
//
// Options:
//   --min-drift-seconds <n>  Only rewrite the timings file when doing so
//                            improves the predicted slowest-shard time by
//                            at least n seconds (default 0: always write).
//                            CI passes a threshold here so main runs don't
//                            commit churn for balance-equivalent jitter.
//   --shard-count <n>        Shard count used for the drift prediction
//                            (default 20, matching ci-host.yaml).

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_COVERAGE = 0.95;

const args = process.argv.slice(2);
let junitPath;
let minDriftSeconds = 0;
let shardCount = 20;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--min-drift-seconds') {
    minDriftSeconds = Number(args[++i]);
  } else if (args[i] === '--shard-count') {
    shardCount = Number(args[++i]);
  } else if (!junitPath) {
    junitPath = args[i];
  }
}

if (!junitPath || isNaN(minDriftSeconds) || isNaN(shardCount)) {
  console.error(
    'Usage: node scripts/generate-test-module-timings.mjs <merged-junit-xml> [--min-drift-seconds n] [--shard-count n]',
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

const observed = {};
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
    observed[key] = (observed[key] ?? 0) + time / candidates.length;
  }
  attributedTime += time;
}

const coverage = totalTime ? attributedTime / totalTime : 0;
if (unmatched.length) {
  console.warn(`\n${unmatched.length} modules could not be matched to a file:`);
  for (const { moduleName, time } of unmatched.sort(
    (a, b) => b.time - a.time,
  )) {
    console.warn(`  ${time.toFixed(1)}s  ${moduleName}`);
  }
}
if (coverage < MIN_COVERAGE) {
  console.error(
    `\nAttribution coverage ${(coverage * 100).toFixed(1)}% is below the ` +
      `${MIN_COVERAGE * 100}% floor — refusing to write a degraded weights ` +
      `file. Fix the unmatched module titles above (or the report) first.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Merge with the existing timings: observed values win; files the report
// didn't cover keep their prior values; deleted files drop out (the file
// walk above only yields files that exist).
// ---------------------------------------------------------------------------

let prior = {};
try {
  prior = JSON.parse(readFileSync(outputPath, 'utf8'));
} catch {
  // no existing timings file — first generation
}

const candidate = {};
for (const { key } of testFiles) {
  const value = observed[key] ?? prior[key];
  if (value != null) {
    candidate[key] = Math.round(value * 10) / 10;
  }
}

// ---------------------------------------------------------------------------
// Drift gate: mirror the greedy bin-pack in tests/helpers/shard-modules.ts
// to predict the slowest shard under the existing timings versus the
// candidate, both evaluated against the candidate (the best available
// estimate of true durations). Divergence from the helper only affects how
// often the file is rewritten, never which shard a test runs on.
// ---------------------------------------------------------------------------

function pack(moduleIds, timings) {
  const known = Object.values(timings).sort((a, b) => a - b);
  const defaultWeight = known.length ? known[Math.floor(known.length / 2)] : 1;
  const weightOf = (id) => timings[id] ?? defaultWeight;
  const ordered = [...moduleIds].sort((a, b) => {
    const diff = weightOf(b) - weightOf(a);
    if (diff !== 0) return diff;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const buckets = Array.from({ length: shardCount }, () => ({
    weight: 0,
    ids: [],
  }));
  for (const id of ordered) {
    let lightest = buckets[0];
    for (const bucket of buckets) {
      if (bucket.weight < lightest.weight) lightest = bucket;
    }
    lightest.ids.push(id);
    lightest.weight += weightOf(id);
  }
  return buckets.map((b) => b.ids);
}

function slowestShardSeconds(assignment, trueTimings) {
  const known = Object.values(trueTimings).sort((a, b) => a - b);
  const defaultWeight = known.length ? known[Math.floor(known.length / 2)] : 1;
  return Math.max(
    ...assignment.map((ids) =>
      ids.reduce((sum, id) => sum + (trueTimings[id] ?? defaultWeight), 0),
    ),
  );
}

const allKeys = testFiles.map(({ key }) => key);
const hasPrior = Object.keys(prior).length > 0;
if (hasPrior && minDriftSeconds > 0) {
  const staleCost = slowestShardSeconds(pack(allKeys, prior), candidate);
  const freshCost = slowestShardSeconds(pack(allKeys, candidate), candidate);
  const improvement = staleCost - freshCost;
  console.log(
    `Predicted slowest shard: ${staleCost.toFixed(0)}s with existing ` +
      `timings, ${freshCost.toFixed(0)}s with regenerated timings ` +
      `(improvement ${improvement.toFixed(0)}s, threshold ${minDriftSeconds}s).`,
  );
  if (improvement < minDriftSeconds) {
    console.log('Within threshold — leaving the timings file unchanged.');
    process.exit(0);
  }
}

const sorted = Object.fromEntries(
  Object.entries(candidate).sort(([a], [b]) => (a < b ? -1 : 1)),
);

writeFileSync(outputPath, JSON.stringify(sorted, null, 2) + '\n');

console.log(
  `Wrote ${outputPath}: ${Object.keys(sorted).length}/${testFiles.length} ` +
    `test files, ${(coverage * 100).toFixed(1)}% of ${Math.round(totalTime)}s attributed`,
);
