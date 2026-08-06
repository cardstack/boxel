#!/usr/bin/env node
// Enforces the rendering-protocol spec's statement<->test bijection (RP-0.3).
//
// Direction 1 (always an error): a conformance test cites an RP id that does
// not exist in docs/boxel-rendering-protocol.md — the test is asserting a
// statement the spec no longer makes.
// Direction 2 (ratcheted): a spec statement has no citing conformance test.
// The uncovered count may never rise above the recorded ceiling below; when a
// suite lands coverage, lower the ceiling in the same commit. --strict is the
// NORMATIVE-status gate: zero uncovered outside the exempt sections.
//
// Exempt sections (never require citations): RP-0 is meta — its statements
// are enforced by this script and CI, not by QUnit tests; RP-17 states what
// is deferred — its statements become coverable only when un-deferred.
//
// A conformance test participates by starting its title with one or more RP
// ids: test('RP-2.4, RP-2.6: unknown formats fall back ...', ...). Only test
// files whose basename starts with "rp-" are scanned, so ordinary suites are
// not forced into the convention.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const specPath = join(repoRoot, 'docs', 'boxel-rendering-protocol.md');
const testRoots = [join(repoRoot, 'packages', 'host', 'tests')];
const strict = process.argv.includes('--strict');

// Coverage ratchet: the number of coverable statements still uncovered may
// not exceed this. Lower it in the same commit that lands new coverage; it
// only ever goes down.
const uncoveredCeiling = 26;
const exemptSections = new Set(['RP-0', 'RP-17']);
const isExempt = (id) => exemptSections.has(id.split('.')[0]);

const spec = readFileSync(specPath, 'utf8');
const specIds = new Set(
  [...spec.matchAll(/\*\*RP-(\d+\.\d+)\*\*/g)].map((m) => `RP-${m[1]}`),
);
if (specIds.size === 0) {
  console.error(`No RP ids found in ${specPath}; is the spec present?`);
  process.exit(1);
}

function* walk(dir) {
  for (let entry of readdirSync(dir)) {
    let full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (/^rp-.*-test\.(gts|ts)$/.test(entry)) {
      yield full;
    }
  }
}

const citedIds = new Map(); // id -> [file:line], live tests only
const skippedIds = new Map(); // id -> [file:line], cited only by test.skip
let badCitations = [];
for (let root of testRoots) {
  for (let file of walk(root)) {
    let lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      let title = line.match(/test(\.skip)?\(\s*['"`]([^'"`]*)/);
      if (!title) {
        return;
      }
      let skipped = Boolean(title[1]);
      let ids = [...title[2].matchAll(/RP-\d+\.\d+/g)].map((m) => m[0]);
      if (ids.length === 0) {
        badCitations.push(
          `${file}:${index + 1} conformance test title cites no RP id: "${title[2]}"`,
        );
        return;
      }
      for (let id of ids) {
        if (!specIds.has(id)) {
          badCitations.push(
            `${file}:${index + 1} cites ${id}, which is not in the spec`,
          );
        } else {
          // A skipped test enforces nothing: it may keep its citation for
          // traceability, but it cannot count as coverage.
          let bucket = skipped ? skippedIds : citedIds;
          bucket.set(id, [...(bucket.get(id) ?? []), `${file}:${index + 1}`]);
        }
      }
    });
  }
}

const uncovered = [...specIds]
  .filter((id) => !citedIds.has(id) && !isExempt(id))
  .sort();
const exemptCount = [...specIds].filter(isExempt).length;
const skippedOnly = [...skippedIds.keys()]
  .filter((id) => !citedIds.has(id))
  .sort();

console.log(
  `spec statements: ${specIds.size} (${exemptCount} exempt: meta/deferred); ` +
    `covered by conformance tests: ${citedIds.size}; ` +
    `uncovered: ${uncovered.length} (ceiling: ${uncoveredCeiling})` +
    (skippedOnly.length > 0
      ? ` (${skippedOnly.length} cited only by skipped tests)`
      : ''),
);
if (skippedOnly.length > 0) {
  console.log('\nCited only by skipped tests (not counted as coverage):');
  for (let id of skippedOnly) {
    for (let site of skippedIds.get(id)) {
      console.log(`  ${id} ${site}`);
    }
  }
}
if (badCitations.length > 0) {
  console.error('\nInvalid citations:');
  for (let line of badCitations) {
    console.error(`  ${line}`);
  }
}
if (uncovered.length > 0 && (strict || process.env.RP_BIJECTION_VERBOSE)) {
  console.log('\nUncovered statements:');
  for (let id of uncovered) {
    console.log(`  ${id}`);
  }
}

let ratchetBroken = uncovered.length > uncoveredCeiling;
if (ratchetBroken) {
  console.error(
    `\nCoverage ratchet broken: ${uncovered.length} uncovered exceeds the ` +
      `ceiling of ${uncoveredCeiling}. New or newly-uncited spec statements ` +
      `need conformance tests (or the spec change should carry them).`,
  );
} else if (uncovered.length < uncoveredCeiling) {
  console.log(
    `\nRatchet can tighten: uncovered is ${uncovered.length}, ceiling is ` +
      `${uncoveredCeiling}. Lower uncoveredCeiling in this script in the ` +
      `commit that landed the coverage.`,
  );
}

if (
  badCitations.length > 0 ||
  ratchetBroken ||
  (strict && uncovered.length > 0)
) {
  process.exit(1);
}
