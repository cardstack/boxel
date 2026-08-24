#!/usr/bin/env node
// Enforces the rendering-protocol spec's statement<->test bijection (RP-0.3).
//
// Direction 1 (always an error): a conformance test cites an RP id that does
// not exist in docs/boxel-rendering-protocol.md — the test is asserting a
// statement the spec no longer makes.
// Direction 2 (ratcheted): a spec statement has no citing conformance test.
// The uncovered count may never rise above the recorded ceiling below; when a
// suite lands coverage, lower the ceiling in the same commit. --strict is the
// NORMATIVE-status gate: zero uncovered outside the exempt statements below.
//
// Exempt statements (never require citations): all of RP-0, which is meta and
// enforced by this script and CI rather than by QUnit; and RP-17.1, the
// deferred list, whose statements become coverable only when un-deferred.
// Nothing else is exempt — notably RP-17.2, which is the excluded list and
// says in its own text that conformance tests assert each denial, and RP-17.3,
// whose carried-over gaps are behavior a test can pin. Exemption removes a
// statement from the uncovered set before both the ratchet and --strict, so an
// over-broad exemption buys a reported strict zero over untested statements.
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
const uncoveredCeiling = 109;
const exemptSections = new Set(['RP-0']);
const exemptStatements = new Set(['RP-17.1']);
const isExempt = (id) =>
  exemptSections.has(id.split('.')[0]) || exemptStatements.has(id);

const spec = readFileSync(specPath, 'utf8');
// A statement's bold run may carry a trailing marker word — `**RP-17.1
// DEFERRED**` — so the id is delimited by a word boundary, not by the closing
// `**`. Requiring the `**` would skip such a statement entirely, letting it
// land with no test while the ratchet reports itself satisfied.
const specIdList = [...spec.matchAll(/\*\*RP-(\d+\.\d+)\b/g)].map(
  (m) => `RP-${m[1]}`,
);
const specIds = new Set(specIdList);
if (specIds.size === 0) {
  console.error(`No RP ids found in ${specPath}; is the spec present?`);
  process.exit(1);
}
// Two statements sharing an id defeat the bijection rather than tripping it:
// the set collapses them, the statement count looks unchanged, and one citing
// test marks both covered. An id must name exactly one statement.
const duplicateIds = [
  ...new Set(specIdList.filter((id, i) => specIdList.indexOf(id) !== i)),
].sort();
if (duplicateIds.length > 0) {
  console.error(
    `Duplicate statement ids in ${specPath}: ${duplicateIds.join(', ')}. ` +
      `Each RP id must name exactly one normative statement.`,
  );
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

// A commented-out test enforces nothing, so its citation must not read as
// coverage — otherwise disabling the only test for a statement leaves the
// ratchet satisfied. Blank commented lines while preserving the line count so
// reported citation sites stay accurate. Only a line that is entirely a
// comment is blanked: a trailing `//` is left alone, because `//` inside a
// test title is ordinary text and treating it as a comment would truncate the
// title mid-citation.
function blankComments(source) {
  let out = [];
  let inBlock = false;
  for (let line of source.split('\n')) {
    if (inBlock) {
      let close = line.indexOf('*/');
      if (close === -1) {
        out.push('');
        continue;
      }
      inBlock = false;
      line = ' '.repeat(close + 2) + line.slice(close + 2);
    }
    let open = line.indexOf('/*');
    if (open !== -1 && line.indexOf('*/', open) === -1) {
      inBlock = true;
      line = line.slice(0, open);
    }
    out.push(/^\s*(\/\/|\*)/.test(line) ? '' : line);
  }
  return out.join('\n');
}

// Matched against the whole file, not line by line: a long title is routinely
// formatted onto the line after `test(`, and a line-at-a-time scan sees neither
// its coverage nor a bogus id it cites.
const TEST_DECLARATION = /\btest(\.skip)?\(\s*['"`]([^'"`]*)/g;

const citedIds = new Map(); // id -> [file:line], live tests only
const skippedIds = new Map(); // id -> [file:line], cited only by test.skip
let badCitations = [];
for (let root of testRoots) {
  for (let file of walk(root)) {
    let source = blankComments(readFileSync(file, 'utf8'));
    for (let title of source.matchAll(TEST_DECLARATION)) {
      let line = source.slice(0, title.index).split('\n').length;
      let skipped = Boolean(title[1]);
      let ids = [...title[2].matchAll(/RP-\d+\.\d+/g)].map((m) => m[0]);
      if (ids.length === 0) {
        badCitations.push(
          `${file}:${line} conformance test title cites no RP id: "${title[2]}"`,
        );
        continue;
      }
      for (let id of ids) {
        if (!specIds.has(id)) {
          badCitations.push(
            `${file}:${line} cites ${id}, which is not in the spec`,
          );
        } else {
          // A skipped test enforces nothing: it may keep its citation for
          // traceability, but it cannot count as coverage.
          let bucket = skipped ? skippedIds : citedIds;
          bucket.set(id, [...(bucket.get(id) ?? []), `${file}:${line}`]);
        }
      }
    }
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
