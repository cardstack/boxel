#!/usr/bin/env -S node
// Enforces the rendering-protocol spec's statement<->test bijection (RP-0.3).
//
// Direction 1 (always an error): a conformance test cites an RP id that does
// not exist in docs/boxel-rendering-protocol.md — the test is asserting a
// statement the spec does not make. A test whose title cites nothing, or
// whose title is not a literal this script can read, is the same error: an
// unverifiable citation is not a citation.
// Direction 2 (exact): the number of coverable statements with no citing test
// must equal the recorded figure below, so that both a new uncovered
// statement and the removal of one are deliberate edits. Relaxing this to a
// ceiling would break it: deleting a statement mints slack that a later
// untested statement then spends silently. --strict additionally demands that
// figure be zero, which is the gate for NORMATIVE status.
//
// Exempt statements (never require citations) are enumerated, not matched by
// section, so a statement added to a mostly-exempt section has to be argued
// for rather than inheriting exemption. RP-0.x is meta, enforced by this
// script and CI rather than by QUnit. RP-17.1 is the deferred list, coverable
// only when un-deferred. Nothing else is exempt — notably RP-17.2, the
// excluded list, which says in its own text that conformance tests assert
// each denial, and RP-17.3, whose carried-over gaps are behavior a test can
// pin. Exemption removes a statement from the uncovered set before both
// direction 2 and --strict, so an over-broad exemption buys a reported strict
// zero over untested statements.
//
// A conformance test participates by citing one or more RP ids in its title,
// conventionally leading: test('RP-2.4, RP-2.6: unknown formats ...', ...).
// Only test files whose basename starts with "rp-" are scanned, so ordinary
// suites are not forced into the convention.
//
// What this cannot see, and does not claim to: a citation is not an
// assertion, so a test that cites a statement and asserts nothing about it
// still counts as coverage — the bijection proves a statement has an owner,
// not that the owner tests it. Comment detection is line-local (see
// blankComments), and a suite disabled at the module level still has its
// tests counted, since neither is decidable without parsing the file.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const specPath = join(repoRoot, 'docs', 'boxel-rendering-protocol.md');
const testRoots = [join(repoRoot, 'packages', 'host', 'tests')];
const strict = process.argv.includes('--strict');

// The count of coverable statements with no citing test. Direction 2 holds the
// real count equal to this, so it changes only in a commit that deliberately
// lands coverage or edits the statement inventory.
const expectedUncovered = 103;
const exemptStatements = new Set([
  'RP-0.1',
  'RP-0.2',
  'RP-0.3',
  'RP-0.4',
  'RP-0.5',
  'RP-17.1',
]);
const isExempt = (id: string): boolean => exemptStatements.has(id);

const spec = readFileSync(specPath, 'utf8');
// A statement's bold run may carry a trailing marker word — `**RP-17.1
// DEFERRED**` — so the id is delimited by a word boundary, not by the closing
// `**`. Requiring the `**` would skip such a statement entirely, letting it
// land with no test while direction 2 reports itself satisfied.
const specIdList: string[] = [...spec.matchAll(/\*\*RP-(\d+\.\d+)\b/g)].map(
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
const staleExemptions = [...exemptStatements].filter((id) => !specIds.has(id));
if (staleExemptions.length > 0) {
  console.error(
    `Exempt ids absent from ${specPath}: ${staleExemptions.join(', ')}. ` +
      `An exemption must name a statement that exists.`,
  );
  process.exit(1);
}

function* walk(dir: string): Generator<string> {
  for (let entry of readdirSync(dir)) {
    let full = join(dir, entry);
    // A broken symlink stats as nothing; skip it rather than dying on ENOENT.
    let stat = statSync(full, { throwIfNoEntry: false });
    if (!stat) {
      continue;
    }
    if (stat.isDirectory()) {
      yield* walk(full);
    } else if (/^rp-.*-test\.(gts|ts)$/.test(entry)) {
      yield full;
    }
  }
}

// A commented-out test enforces nothing, so its citation must not read as
// coverage — otherwise disabling the only test for a statement leaves
// direction 2 satisfied.
//
// Deliberately line-local, with no state carried between lines. Tracking an
// open block comment across lines requires deciding whether a `/*` is real
// code, and `/*` occurs inside ordinary strings and URLs (`Accept: '*/*'`, a
// path ending `/Person/*`) and inside `//` comments. Guessing wrong there is
// far worse than the case cross-line tracking would catch: one spurious
// opener blanks every remaining line of the file, so that file's coverage and
// its bogus citations both vanish and the check exits 0 regardless.
//
// What this does catch: a line that is entirely a comment (`//`, a `*`
// continuation line, a `/*` opener, or a handlebars `{{!`), and a `/* ... */`
// span opened and closed on one line. A block comment whose body lines carry
// no leading `*` is not caught; prettier writes the leading `*`, and the
// residual risk is one miscredited statement rather than a blind file.
function blankComments(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      let withoutSpans = line.replace(/\/\*.*?\*\//g, ' ');
      return /^\s*(\/\/|\*|\/\*|\{\{!)/.test(withoutSpans) ? '' : withoutSpans;
    })
    .join('\n');
}

// Matched against the whole file, not line by line: a long title is routinely
// formatted onto the line after `test(`, and a line-at-a-time scan sees
// neither its coverage nor a bogus id it cites.
//
// Every QUnit declaration form counts, including the bare `skip` and `todo`
// this suite imports and calls directly, plus a `.only` / `.skip` / `.todo`
// modifier on any of them. Recognizing only `test(` and `test.skip(` would
// leave the rest of the forms invisible: a bogus citation inside one escapes
// direction 1, and a live test inside one earns no coverage.
//
// The lookbehind is what keeps `.test(` from matching, so
// `assert.ok(/^rp-/.test('rp-x.gts'))` reads as code rather than a
// declaration citing nothing. `QUnit.test(` is admitted explicitly, being the
// one dotted prefix that does introduce a declaration.
const DECLARATION =
  '(?:\\bQUnit\\.(?<qualified>test|skip|todo)' +
  '|(?<![.\\w$])(?<bare>test|skip|todo))' +
  '(?:\\.(?<modifier>skip|only|todo|each))?\\(\\s*';
const LITERAL_TITLE = new RegExp(
  `${DECLARATION}(?<quote>['"\`])(?<title>[^'"\`]*)`,
  'g',
);
// A title this script cannot read is an unverifiable citation, not an absent
// declaration — without this, `test(SOME_TITLE_CONST, ...)` is an escape
// hatch from the must-cite rule.
const COMPUTED_TITLE = new RegExp(`${DECLARATION}(?!['"\`])(?=\\S)`, 'g');

const lineOf = (source: string, index: number): number =>
  source.slice(0, index).split('\n').length;

const citedIds = new Map<string, string[]>(); // id -> sites, live tests only
const skippedIds = new Map<string, string[]>(); // id -> sites, disabled tests
let badCitations: string[] = [];
for (let root of testRoots) {
  if (!existsSync(root)) {
    console.error(`Configured test root does not exist: ${root}`);
    process.exit(1);
  }
  for (let file of walk(root)) {
    let source = blankComments(readFileSync(file, 'utf8'));
    for (let match of source.matchAll(COMPUTED_TITLE)) {
      badCitations.push(
        `${file}:${lineOf(source, match.index ?? 0)} test title is not a ` +
          `literal, so its citation cannot be verified`,
      );
    }
    for (let match of source.matchAll(LITERAL_TITLE)) {
      let { qualified, bare, modifier, title } = match.groups!;
      let line = lineOf(source, match.index ?? 0);
      // `skip`/`todo` in either position mean the test does not run.
      let disabled = [qualified, bare, modifier].some(
        (part) => part === 'skip' || part === 'todo',
      );
      let ids = [...title.matchAll(/RP-\d+\.\d+/g)].map((m) => m[0]);
      if (ids.length === 0) {
        badCitations.push(
          `${file}:${line} conformance test title cites no RP id: "${title}"`,
        );
        continue;
      }
      for (let id of ids) {
        if (!specIds.has(id)) {
          badCitations.push(
            `${file}:${line} cites ${id}, which is not in the spec`,
          );
        } else {
          // A disabled test enforces nothing: it may keep its citation for
          // traceability, but it cannot count as coverage.
          let bucket = disabled ? skippedIds : citedIds;
          bucket.set(id, [...(bucket.get(id) ?? []), `${file}:${line}`]);
        }
      }
    }
  }
}

const uncovered = [...specIds]
  .filter((id) => !citedIds.has(id) && !isExempt(id))
  .sort();
const skippedOnly = [...skippedIds.keys()]
  .filter((id) => !citedIds.has(id))
  .sort();

console.log(
  `spec statements: ${specIds.size} (${exemptStatements.size} exempt: ` +
    `meta/deferred); covered by conformance tests: ${citedIds.size}; ` +
    `uncovered: ${uncovered.length} (recorded: ${expectedUncovered})` +
    (skippedOnly.length > 0
      ? ` (${skippedOnly.length} cited only by disabled tests)`
      : ''),
);
if (skippedOnly.length > 0) {
  console.log('\nCited only by disabled tests (not counted as coverage):');
  for (let id of skippedOnly) {
    for (let site of skippedIds.get(id)!) {
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

let countMismatch = uncovered.length !== expectedUncovered;
if (countMismatch) {
  let direction = uncovered.length > expectedUncovered ? 'rose to' : 'fell to';
  console.error(
    `\nUncovered count ${direction} ${uncovered.length}, but this script ` +
      `records ${expectedUncovered}. Landing coverage or editing the ` +
      `statement inventory means updating expectedUncovered in the same ` +
      `commit; a new statement without a conformance test means writing one.`,
  );
}

if (
  badCitations.length > 0 ||
  countMismatch ||
  (strict && uncovered.length > 0)
) {
  process.exit(1);
}
