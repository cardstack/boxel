#!/usr/bin/env node
/* eslint-env node */
'use strict';

// Discovers all *-test.ts files under tests/ and outputs the subset assigned
// to the requested shard (1-based).
//
// Assignment is duration-weighted: files are packed heaviest-first into
// whichever shard is currently lightest, using the measured durations in
// tests/test-module-timings.json. Round-robin over an alphabetical list
// balances file *count*, which is not what the job waits on — measured across
// four main runs it produced a 5x spread (266s to 1544s), and because the
// order shifts when a file is added or renamed, the slow shard moved from 1 to
// 2 between two consecutive days. Weighting by time removes both.
//
// A file with no recorded duration gets DEFAULT_WEIGHT, so a newly added test
// is packed as averagely-sized rather than free. If the timings file is absent
// the old round-robin split is used, which is what bootstraps a checkout that
// has none. A timings file that exists but does not parse is a different thing
// and throws: reverting to round-robin over a corrupted file would put CI back
// to a 5x spread with a green tick and nothing on stderr.
//
// Regenerate the weights with scripts/generate-test-module-timings.mjs.
//
// Usage:  node shard-test-modules.cjs <shard> <totalShards>
// Output: module names joined by "|", suitable for TEST_MODULES.
//
// Exports its parts for tests/shard-assignment-test.ts, which pins the
// property CI depends on: the shards partition the files.

const fs = require('node:fs'); // eslint-disable-line @typescript-eslint/no-var-requires
const path = require('node:path'); // eslint-disable-line @typescript-eslint/no-var-requires

const testsDir = path.resolve(__dirname, '..', 'tests');

function collectTestModules(dir, prefix) {
  let modules = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      modules = modules.concat(
        collectTestModules(path.join(dir, entry.name), relative),
      );
    } else if (entry.isFile() && entry.name.endsWith('-test.ts')) {
      modules.push(relative);
    }
  }
  return modules;
}

// Seconds, for a file no run has measured yet. Deliberately above the measured
// median of 1.1s — around the 60th percentile — because an unmeasured file is
// unknown rather than small, and the cost of guessing low is that a slow new
// test lands on an already-full shard. Low enough that one unknown file cannot
// dominate a shard on its own.
const DEFAULT_WEIGHT = 5;

// Seconds. The weights are recorded to one decimal and the run that seeded
// them could only resolve whole seconds, so a measured 0 means "under the
// resolution of the clock", not "free". It also stands in for the per-file
// import and hook cost that a sum of per-test runtimes cannot see. Without a
// floor, zero-weight files never change a bin's running load, so every one of
// them lands in whichever bin is lightest — and that bin stays lightest, so
// they all collect together.
const MIN_WEIGHT = 1;

// Null when the file is absent — bootstrap on round-robin. Throws when it is
// present and unparseable, which is a broken file rather than a missing one.
function loadTimings(dir = testsDir) {
  const timingsPath = path.join(dir, 'test-module-timings.json');
  let raw;
  try {
    raw = fs.readFileSync(timingsPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${timingsPath} does not contain a JSON object`);
  }
  return parsed;
}

// `== null` on the raw value, not `??` on a floored one: a file measured at 0
// takes the floor, and only a file with no measurement at all takes the
// default. Conflating them charges 54 of today's files five seconds each — 270s
// of load that does not exist — and packs a genuinely instant file as if it
// were an unknown one.
function weightFor(name, timings) {
  const measured = timings[name];
  return typeof measured === 'number' && Number.isFinite(measured)
    ? Math.max(measured, MIN_WEIGHT)
    : DEFAULT_WEIGHT;
}

function assignRoundRobin(modules, shard, totalShards) {
  return modules.filter((_, index) => (index % totalShards) + 1 === shard);
}

function assignByWeight(modules, timings, shard, totalShards) {
  const weighted = modules
    .map((name) => ({ name, weight: weightFor(name, timings) }))
    // Heaviest first, name as the tiebreak so the packing is deterministic
    // across machines and reruns — two shards disagreeing about who owns a
    // file would run it twice or not at all.
    .sort((a, b) => b.weight - a.weight || (a.name < b.name ? -1 : 1));

  const bins = Array.from({ length: totalShards }, () => ({
    load: 0,
    modules: /** @type {string[]} */ ([]),
  }));
  for (const { name, weight } of weighted) {
    let lightest = 0;
    for (let i = 1; i < bins.length; i++) {
      if (bins[i].load < bins[lightest].load) {
        lightest = i;
      }
    }
    bins[lightest].load += weight;
    bins[lightest].modules.push(name);
  }
  // Sorted so TEST_MODULES reads in file order regardless of packing order.
  return bins[shard - 1].modules.sort();
}

// The load of the heaviest shard when `modules` are packed by `packingTimings`
// but actually cost what `actualTimings` says. The drift gate in
// scripts/generate-test-module-timings.mjs asks this twice — packed with the
// committed weights and packed with the fresh ones, both costed with the fresh
// ones — and only rewrites the committed file when the gap is worth a commit.
// It packs with assignByWeight itself rather than a copy of it, so the
// prediction cannot describe an assignment CI does not perform.
function slowestShardSeconds(
  modules,
  packingTimings,
  actualTimings,
  totalShards,
) {
  let slowest = 0;
  for (let shard = 1; shard <= totalShards; shard++) {
    const load = assignByWeight(
      modules,
      packingTimings,
      shard,
      totalShards,
    ).reduce((sum, name) => sum + weightFor(name, actualTimings), 0);
    slowest = Math.max(slowest, load);
  }
  return slowest;
}

function modulesForShard(shard, totalShards, dir = testsDir) {
  const allModules = collectTestModules(dir, '').sort();
  const timings = loadTimings(dir);
  return timings
    ? assignByWeight(allModules, timings, shard, totalShards)
    : assignRoundRobin(allModules, shard, totalShards);
}

function main(argv) {
  const shard = parseInt(argv[2], 10);
  const totalShards = parseInt(argv[3], 10);

  if (!shard || !totalShards || shard < 1 || shard > totalShards) {
    console.error(
      `Usage: shard-test-modules.cjs <shard> <totalShards>  (got shard=${argv[2]}, totalShards=${argv[3]})`,
    );
    process.exit(1);
  }

  const shardModules = modulesForShard(shard, totalShards);
  if (shardModules.length === 0) {
    console.error(`Shard ${shard}/${totalShards} has no test modules.`);
    process.exit(1);
  }

  process.stdout.write(shardModules.join('|'));
}

if (require.main === module) {
  main(process.argv);
}

module.exports = {
  DEFAULT_WEIGHT,
  MIN_WEIGHT,
  assignByWeight,
  assignRoundRobin,
  collectTestModules,
  loadTimings,
  modulesForShard,
  slowestShardSeconds,
  testsDir,
  weightFor,
};
