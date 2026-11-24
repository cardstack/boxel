#!/usr/bin/env node
/* eslint-env node */
'use strict';

// Which suite each realm-server test module runs in. Every module is in
// exactly one:
//
// - platform: on every pull request that runs the realm-server tests (the
//   `realm-server-test` shards in ci.yaml). The default: a module named in no
//   list below is a platform module.
// - engine: query-engine cases below the platform contract. They run in a job
//   of their own when the engine's paths change, and on every merge to main.
// - nightly: generated cases and races too slow for a pull request at full
//   size (query-tests-nightly.yml).
//
// The lists live in tests/test-suites.json. A name there must be a test module
// that exists, and in one list only; tests/test-suites-test.ts holds that.
//
//   node scripts/test-suites.cjs <suite>   prints the suite's modules, '|'-joined

const fs = require('node:fs'); // eslint-disable-line @typescript-eslint/no-var-requires
const path = require('node:path'); // eslint-disable-line @typescript-eslint/no-var-requires

const SUITES = ['platform', 'engine', 'nightly'];
const DEFAULT_SUITE = 'platform';
const manifestPath = path.resolve(__dirname, '..', 'tests', 'test-suites.json');

function loadManifest(file = manifestPath) {
  let raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  let manifest = {};
  for (let suite of SUITES) {
    if (suite === DEFAULT_SUITE) {
      continue;
    }
    manifest[suite] = Array.isArray(raw[suite]) ? raw[suite] : [];
  }
  for (let key of Object.keys(raw)) {
    if (!SUITES.includes(key) || key === DEFAULT_SUITE) {
      throw new Error(
        `test-suites.json: unknown suite "${key}" (lists: ${SUITES.filter((s) => s !== DEFAULT_SUITE).join(', ')}; unlisted modules are ${DEFAULT_SUITE})`,
      );
    }
  }
  return manifest;
}

// The suite `moduleName` runs in.
function suiteOf(moduleName, manifest = loadManifest()) {
  for (let [suite, modules] of Object.entries(manifest)) {
    if (modules.includes(moduleName)) {
      return suite;
    }
  }
  return DEFAULT_SUITE;
}

// The modules of `allModules` that run in `suite`, in their given order.
function modulesInSuite(suite, allModules, manifest = loadManifest()) {
  if (!SUITES.includes(suite)) {
    throw new Error(
      `unknown test suite "${suite}" (one of ${SUITES.join(', ')})`,
    );
  }
  return allModules.filter((m) => suiteOf(m, manifest) === suite);
}

// Problems with the manifest against the modules that exist: a name that is
// no module, or one listed in two suites.
function manifestProblems(allModules, manifest = loadManifest()) {
  let problems = [];
  let seen = new Map();
  for (let [suite, modules] of Object.entries(manifest)) {
    for (let m of modules) {
      if (!allModules.includes(m)) {
        problems.push(`${suite} lists ${m}, which is not a test module`);
      }
      if (seen.has(m)) {
        problems.push(`${m} is listed in both ${seen.get(m)} and ${suite}`);
      }
      seen.set(m, suite);
    }
  }
  return problems;
}

function main(argv) {
  let suite = argv[2];
  if (!SUITES.includes(suite)) {
    console.error(`Usage: test-suites.cjs <${SUITES.join('|')}>`);
    process.exit(1);
  }
  // Required here, not at the top, so the shard script can require this file.
  const { collectTestModules, testsDir } = require('./shard-test-modules.cjs'); // eslint-disable-line @typescript-eslint/no-var-requires
  let modules = modulesInSuite(suite, collectTestModules(testsDir, '').sort());
  if (modules.length === 0) {
    // An empty TEST_MODULES runs every module, so an empty suite must not
    // reach the runner as one.
    console.error(`The ${suite} suite has no test modules.`);
    process.exit(1);
  }
  process.stdout.write(modules.join('|'));
}

if (require.main === module) {
  main(process.argv);
}

module.exports = {
  DEFAULT_SUITE,
  SUITES,
  loadManifest,
  manifestPath,
  manifestProblems,
  modulesInSuite,
  suiteOf,
};
