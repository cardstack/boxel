#!/usr/bin/env node
/* eslint-env node */
'use strict';

// Discovers all *-test.ts files under tests/ and outputs the subset assigned
// to the requested shard (1-based).  Files are sorted alphabetically and
// distributed round-robin so every shard gets a roughly equal share.
//
// Usage:  node shard-test-modules.js <shard> <totalShards>
// Output: module names joined by "|", suitable for TEST_MODULES.

const fs = require('node:fs'); // eslint-disable-line @typescript-eslint/no-var-requires
const path = require('node:path'); // eslint-disable-line @typescript-eslint/no-var-requires

const shard = parseInt(process.argv[2], 10);
const totalShards = parseInt(process.argv[3], 10);

if (!shard || !totalShards || shard < 1 || shard > totalShards) {
  console.error(
    `Usage: shard-test-modules.js <shard> <totalShards>  (got shard=${process.argv[2]}, totalShards=${process.argv[3]})`,
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

const shardModules = allModules.filter(
  (_, index) => (index % totalShards) + 1 === shard,
);

if (shardModules.length === 0) {
  console.error(`Shard ${shard}/${totalShards} has no test modules.`);
  process.exit(1);
}

process.stdout.write(shardModules.join('|'));
