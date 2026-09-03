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
//
// Options:
//   --min-drift-seconds <n>  Only rewrite the weights when doing so improves
//                            the predicted slowest shard by at least n
//                            seconds. Without it every run rewrites the file,
//                            which on a per-push CI job means a commit per
//                            push recording nothing but jitter.
//   --shard-count <n>        The shard count that prediction packs into.
//                            Required with --min-drift-seconds and with no
//                            default: "the slowest shard" is meaningless until
//                            you say how many there are. Keep it equal to the
//                            realm-server matrix in .github/workflows/ci.yaml.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import shardTestModules from './shard-test-modules.cjs';
import {
  createResolver,
  discoverTestFiles,
  testsDir,
} from './test-module-names.mjs';

const { assignByWeight, weightFor } = shardTestModules;

const timingsPath = join(testsDir, 'test-module-timings.json');

// A report whose suites are mostly unattributed means the reporter regressed
// (it emitted "default" for everything before it learned to read fullName).
// Writing those weights would quietly flatten the packing back to arbitrary,
// so refuse instead.
const MIN_ATTRIBUTED = 0.9;

const args = process.argv.slice(2);
let junitPath;
let minDriftSeconds = 0;
let shardCount;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--min-drift-seconds') {
    minDriftSeconds = Number(args[++i]);
  } else if (args[i] === '--shard-count') {
    shardCount = Number(args[++i]);
  } else if (!junitPath) {
    junitPath = args[i];
  } else {
    console.error(`Unexpected argument: ${args[i]}`);
    process.exit(1);
  }
}

if (
  !junitPath ||
  !Number.isFinite(minDriftSeconds) ||
  minDriftSeconds < 0 ||
  (shardCount !== undefined &&
    !(Number.isInteger(shardCount) && shardCount > 0))
) {
  console.error(
    'Usage: node scripts/generate-test-module-timings.mjs <merged-junit-xml> ' +
      '[--min-drift-seconds n] [--shard-count n]',
  );
  process.exit(1);
}

// Silently defaulting the shard count would compare slowest-shard times for a
// suite nobody runs, and the gate would open and close on that fiction.
if (minDriftSeconds > 0 && shardCount === undefined) {
  console.error(
    '--min-drift-seconds requires --shard-count: the prediction is a ' +
      'slowest-shard time, which depends on how many shards there are.',
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

// Absent is the first run and means there is nothing to preserve. Present but
// unparseable is a broken file, and swallowing it would drop every weight the
// current report does not cover — quietly, since the result still looks like a
// well-formed refresh. shard-test-modules.cjs draws the same distinction.
let prior = {};
try {
  prior = JSON.parse(readFileSync(timingsPath, 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') {
    console.error(`${timingsPath} exists but could not be read as JSON.`);
    throw err;
  }
}

const merged = {};
for (const file of onDisk) {
  const value = timings[file] ?? prior[file];
  if (value !== undefined) {
    merged[file] = value;
  }
}

// ---------------------------------------------------------------------------
// Drift gate. Predict the slowest shard under the committed weights and under
// the regenerated ones, both scored against the regenerated ones as the better
// estimate of true duration, and only rewrite if the difference is worth a
// commit. The packing comes from shard-test-modules.cjs itself rather than a
// copy of it, so the prediction cannot drift from the assignment it predicts.
// ---------------------------------------------------------------------------

function slowestShardSeconds(packWeights, trueWeights) {
  let slowest = 0;
  for (let shard = 1; shard <= shardCount; shard++) {
    const load = assignByWeight(onDisk, packWeights, shard, shardCount).reduce(
      (sum, file) => sum + weightFor(file, trueWeights),
      0,
    );
    slowest = Math.max(slowest, load);
  }
  return slowest;
}

if (minDriftSeconds > 0 && Object.keys(prior).length > 0) {
  const staleCost = slowestShardSeconds(prior, merged);
  const freshCost = slowestShardSeconds(merged, merged);
  const improvement = staleCost - freshCost;
  console.log(
    `Predicted slowest shard of ${shardCount}: ${staleCost.toFixed(0)}s with the ` +
      `committed weights, ${freshCost.toFixed(0)}s with the regenerated ones ` +
      `(improvement ${improvement.toFixed(0)}s, threshold ${minDriftSeconds}s).`,
  );
  if (improvement < minDriftSeconds) {
    console.log('Within the threshold — leaving the weights unchanged.');
    process.exit(0);
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
