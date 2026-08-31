#!/usr/bin/env node

// Regenerates tests/spec-timings.json — the per-spec-file duration data that
// drives duration-weighted shard assignment (see
// support/shard-spec-files.ts) — from a merged Playwright JSON report of a
// full matrix CI run.
//
// Only first attempts count. A retry's time is real, but it lands on whichever
// file happened to flake in that run, so including it would move a file
// between shards on the strength of one bad run.
//
// Spec files absent from the report (a shard that failed before reporting)
// keep their values from the existing timings file, so a partial run never
// erases what is known about them. Files that no longer exist on disk are
// dropped.
//
// Usage:
//   gh run download <ci-run-id> --pattern 'blob-report-*' -D /tmp/matrix-blobs
//   pnpm exec playwright merge-reports --reporter json /tmp/matrix-blobs > /tmp/matrix-report.json
//   node scripts/generate-spec-timings.ts /tmp/matrix-report.json
//
// Options:
//   --min-drift-seconds <n>  Only rewrite the timings file when doing so
//                            improves the predicted slowest-shard time by at
//                            least n seconds (default 0: always write). CI
//                            passes a threshold here so main runs don't commit
//                            churn for balance-equivalent jitter.
//   --shard-count <n>        Shard count the drift prediction packs into.
//                            Required with --min-drift-seconds, and with no
//                            default: the prediction is a slowest-shard time,
//                            so a stale default would quietly answer for a
//                            shard count nobody runs. ci.yaml passes both and
//                            is the only place naming the number.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { discoverSpecFiles } from '../support/shard-spec-files.ts';

const args = process.argv.slice(2);
let reportPath: string | undefined;
let minDriftSeconds = 0;
let shardCount: number | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--min-drift-seconds') {
    minDriftSeconds = Number(args[++i]);
  } else if (args[i] === '--shard-count') {
    shardCount = Number(args[++i]);
  } else if (!reportPath) {
    reportPath = args[i];
  }
}

if (
  !reportPath ||
  isNaN(minDriftSeconds) ||
  (shardCount !== undefined && isNaN(shardCount))
) {
  console.error(
    'Usage: node scripts/generate-spec-timings.ts <merged-json-report> [--min-drift-seconds n] [--shard-count n]',
  );
  process.exit(1);
}

// Only the drift gate packs shards, so a plain regeneration needs no count. A
// gate run without one, though, would compare slowest-shard times for an
// invented shard count and decide whether to rewrite the file on that. Fail
// rather than guess.
if (minDriftSeconds > 0 && shardCount === undefined) {
  console.error(
    '--min-drift-seconds requires --shard-count: the drift prediction is a slowest-shard time, which depends on how many shards there are.',
  );
  process.exit(1);
}

const testsDir = join(import.meta.dirname, '..', 'tests');
const outputPath = join(testsDir, 'spec-timings.json');

// ---------------------------------------------------------------------------
// Sum first-attempt test durations per spec file.
// ---------------------------------------------------------------------------

const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
  suites?: JsonReportSuite[];
};
const observed: Record<string, number> = {};

interface JsonReportSuite {
  file?: string;
  specs?: {
    file?: string;
    tests?: { results?: { retry?: number; duration?: number }[] }[];
  }[];
  suites?: JsonReportSuite[];
}

function collect(suite: JsonReportSuite) {
  for (const spec of suite.specs ?? []) {
    const file = spec.file ?? suite.file;
    if (!file) {
      continue;
    }
    for (const test of spec.tests ?? []) {
      for (const result of test.results ?? []) {
        if (result.retry) {
          continue;
        }
        observed[file] = (observed[file] ?? 0) + (result.duration ?? 0) / 1000;
      }
    }
  }
  for (const child of suite.suites ?? []) {
    collect(child);
  }
}

for (const suite of report.suites ?? []) {
  collect(suite);
}

if (Object.keys(observed).length === 0) {
  console.error(
    `No test durations found in ${reportPath} — refusing to rewrite the timings file from an empty report.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Merge with the existing timings: observed values win; files the report
// didn't cover keep their prior values; deleted files drop out (the discovery
// walk only yields files that exist).
// ---------------------------------------------------------------------------

let prior: Record<string, number> = {};
try {
  prior = JSON.parse(readFileSync(outputPath, 'utf8'));
} catch {
  // no existing timings file — first generation
}

const specFiles = discoverSpecFiles(testsDir);
const unknownToDisk = Object.keys(observed).filter(
  (file) => !specFiles.includes(file),
);
if (unknownToDisk.length) {
  console.warn(
    `Report names ${unknownToDisk.length} spec file(s) not on disk (dropped): ${unknownToDisk.join(', ')}`,
  );
}

const candidate: Record<string, number> = {};
for (const file of specFiles) {
  const value = observed[file] ?? prior[file];
  if (value != null) {
    candidate[file] = Math.round(value * 10) / 10;
  }
}

// ---------------------------------------------------------------------------
// Drift gate: mirror the greedy bin-pack in support/shard-spec-files.ts to
// predict the slowest shard under the existing timings versus the candidate,
// both evaluated against the candidate (the best available estimate of true
// durations). Divergence from the helper only affects how often the file is
// rewritten, never which shard a spec runs on.
// ---------------------------------------------------------------------------

// Keep in step with MIN_SPEC_WEIGHT_SECONDS in support/shard-spec-files.ts,
// which explains why a floor is needed at all. Predicting with unfloored
// weights would model a packing that helper no longer performs.
const MIN_SPEC_WEIGHT_SECONDS = 1;

function weightLookup(timings: Record<string, number>) {
  const known = Object.values(timings)
    .map((weight) => Math.max(weight, MIN_SPEC_WEIGHT_SECONDS))
    .sort((a, b) => a - b);
  const defaultWeight = known.length
    ? known[Math.floor(known.length / 2)]
    : MIN_SPEC_WEIGHT_SECONDS;
  return (file: string) => {
    const measured = timings[file];
    return measured == null
      ? defaultWeight
      : Math.max(measured, MIN_SPEC_WEIGHT_SECONDS);
  };
}

function pack(files: string[], timings: Record<string, number>) {
  const weightOf = weightLookup(timings);
  const ordered = [...files].sort((a, b) => {
    const diff = weightOf(b) - weightOf(a);
    if (diff !== 0) return diff;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const buckets: { weight: number; files: string[] }[] = Array.from(
    { length: shardCount as number },
    () => ({ weight: 0, files: [] }),
  );
  for (const file of ordered) {
    let lightest = buckets[0];
    for (const bucket of buckets) {
      if (bucket.weight < lightest.weight) lightest = bucket;
    }
    lightest.files.push(file);
    lightest.weight += weightOf(file);
  }
  return buckets.map((b) => b.files);
}

function slowestShardSeconds(
  assignment: string[][],
  trueTimings: Record<string, number>,
) {
  const weightOf = weightLookup(trueTimings);
  return Math.max(
    ...assignment.map((files) =>
      files.reduce((sum, file) => sum + weightOf(file), 0),
    ),
  );
}

const hasPrior = Object.keys(prior).length > 0;
if (hasPrior && minDriftSeconds > 0) {
  const staleCost = slowestShardSeconds(pack(specFiles, prior), candidate);
  const freshCost = slowestShardSeconds(pack(specFiles, candidate), candidate);
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

const totalSeconds = Object.values(sorted).reduce((sum, v) => sum + v, 0);
console.log(
  `Wrote ${outputPath}: ${Object.keys(sorted).length}/${specFiles.length} ` +
    `spec files, ${Math.round(totalSeconds)}s of test time ` +
    `(${Object.keys(observed).length} file(s) measured this run)`,
);
