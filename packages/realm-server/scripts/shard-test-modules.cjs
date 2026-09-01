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
// is packed as averagely-sized rather than free. If the timings file is
// missing entirely the old round-robin split is used, which keeps this working
// before the first weights are generated.
//
// Regenerate the weights with scripts/generate-test-module-timings.mjs.
//
// Usage:  node shard-test-modules.cjs <shard> <totalShards>
// Output: module names joined by "|", suitable for TEST_MODULES.

const fs = require('node:fs'); // eslint-disable-line @typescript-eslint/no-var-requires
const path = require('node:path'); // eslint-disable-line @typescript-eslint/no-var-requires

const shard = parseInt(process.argv[2], 10);
const totalShards = parseInt(process.argv[3], 10);

if (!shard || !totalShards || shard < 1 || shard > totalShards) {
  console.error(
    `Usage: shard-test-modules.cjs <shard> <totalShards>  (got shard=${process.argv[2]}, totalShards=${process.argv[3]})`,
  );
  process.exit(1);
}

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

const allModules = collectTestModules(testsDir, '').sort();

// Seconds. Roughly the median measured file — high enough that a new test is
// not treated as free, low enough that one unknown file cannot dominate a
// shard on its own.
const DEFAULT_WEIGHT = 5;

function loadTimings() {
  try {
    const raw = fs.readFileSync(
      path.join(testsDir, 'test-module-timings.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function assignRoundRobin(modules) {
  return modules.filter((_, index) => (index % totalShards) + 1 === shard);
}

function assignByWeight(modules, timings) {
  const weighted = modules
    .map((name) => ({
      name,
      weight:
        typeof timings[name] === 'number' && timings[name] > 0
          ? timings[name]
          : DEFAULT_WEIGHT,
    }))
    // Heaviest first, name as the tiebreak so the packing is deterministic
    // across machines and reruns — two shards disagreeing about who owns a
    // file would run it twice or not at all.
    .sort((a, b) => b.weight - a.weight || (a.name < b.name ? -1 : 1));

  const bins = Array.from({ length: totalShards }, () => ({
    load: 0,
    modules: [],
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

const timings = loadTimings();
const shardModules = timings
  ? assignByWeight(allModules, timings)
  : assignRoundRobin(allModules);

if (shardModules.length === 0) {
  console.error(`Shard ${shard}/${totalShards} has no test modules.`);
  process.exit(1);
}

process.stdout.write(shardModules.join('|'));
