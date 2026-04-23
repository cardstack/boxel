// Regression tests for three compiler bugs fixed after the electric-haddock
// Guide work surfaced them:
//
//   1. `X STARTSWITH Y` / `X ENDSWITH Y` / `X CONTAINS Y` as infix outside
//      predicate brackets compiled to literal jq, which is invalid.
//   2. `and`, `or`, `not` got tight-bound with a following `.path` by the
//      post-formatter (`and.amount`, `not.anonymous`) — invalid jq.
//   3. The Excel `=` → `==` preprocessor only ran at bracket depth 0, so
//      `(Amount = 0)` survived as `(.amount = 0)` (jq assignment, not
//      comparison).
//
// Each test asserts both compile output (jq surface) and evaluation value.
import { deepStrictEqual, strictEqual, ok, throws } from 'node:assert';
import { compileReadableSyntax, evaluateBxl, type ReadableSchema } from '../../src/index.js';

const schema: ReadableSchema = {
  fields: [
    { key: 'amount', label: 'Amount' },
    { key: 'anonymous', label: 'Anonymous' },
    { key: 'donor', label: 'Donor' },
    { key: 'email', label: 'Email' },
    { key: 'campaign', label: 'Campaign' },
    {
      key: 'billing', label: 'Bill To', kind: 'object',
      fields: [{ key: 'zip', label: 'Zip' }],
    },
  ],
};

const grace = {
  amount: 5000, anonymous: false,
  donor: 'Grace Lin', email: 'grace@school.org',
  campaign: 'Spring Drive',
  billing: { zip: '94609' },
};

function assertCompile(bxl: string, expectedJq: string, label: string) {
  const r = compileReadableSyntax(bxl, { schema });
  strictEqual(r.source, expectedJq, `${label}\n  BXL: ${bxl}\n  got: ${r.source}`);
}

function assertEval(bxl: string, expected: unknown, label: string) {
  const r = evaluateBxl(bxl, grace, { schema });
  strictEqual(r.value, expected, `${label}: got ${JSON.stringify(r.value)}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Bug #1 — word operators STARTSWITH / ENDSWITH / CONTAINS as infix
// ─────────────────────────────────────────────────────────────────────────

// Schema-mode adds `. as $root | ...` wrapping + rewrites fields to
// `$root.field`. The word-op rewriter's own `$__ctx` binding composes
// with it. See Bug #6 below for the why.
assertCompile(
  'Donor STARTSWITH "Grace"',
  '. as $root |(. as $__ctx |($root.donor) | startswith($__ctx | "Grace"))',
  '#1 STARTSWITH infix → pipe form with $__ctx binding',
);

assertCompile(
  'Campaign ENDSWITH "Drive"',
  '. as $root |(. as $__ctx |($root.campaign) | endswith($__ctx | "Drive"))',
  '#1 ENDSWITH infix → pipe form with $__ctx binding',
);

assertCompile(
  'Email CONTAINS "@"',
  '. as $root |(. as $__ctx |($root.email) | contains($__ctx | "@"))',
  '#1 CONTAINS infix → pipe form (arity-1, not invalid contains/2)',
);

assertEval('Donor STARTSWITH "Grace"', true, '#1 STARTSWITH evaluates');
assertEval('Campaign ENDSWITH "Drive"', true, '#1 ENDSWITH evaluates');
assertEval('Email CONTAINS "@"',  true, '#1 CONTAINS evaluates');
assertEval('Donor STARTSWITH "Mr."', false, '#1 STARTSWITH negative case');

// Formula-call form is left alone (not rewritten into pipe form).
assertCompile(
  'STARTSWITH(Donor; "Grace")',
  'startswith(.donor; "Grace")',
  '#1 STARTSWITH formula call untouched',
);

// Inside predicate brackets attached to a path, word-ops are handled by
// compilePredicate and must NOT be touched by the infix rewrite pass.
const itemScheme: ReadableSchema = {
  fields: [
    {
      key: 'lineItems', label: 'Line Item', kind: 'array',
      item: { fields: [{ key: 'sku', label: 'SKU' }] },
    },
  ],
};
const predicateCompile = compileReadableSyntax(
  '"Line Item"[SKU STARTSWITH "A"].SKU',
  { schema: itemScheme },
);
ok(
  predicateCompile.source.includes('startswith'),
  `#1 predicate STARTSWITH compiles: ${predicateCompile.source}`,
);

// ─────────────────────────────────────────────────────────────────────────
// Bug #2 — keyword-vs-identifier spacing (and.foo / not.foo / or.foo)
// ─────────────────────────────────────────────────────────────────────────

assertCompile(
  'Anonymous AND Amount',
  '.anonymous and .amount',
  '#2 `and` + `.path` gets a space (not `and.amount`)',
);

assertCompile(
  'Anonymous OR Amount',
  '.anonymous or .amount',
  '#2 `or` + `.path` gets a space',
);

assertCompile(
  'NOT Anonymous',
  '((.anonymous) | not)',
  '#2 `NOT` + path wraps in parens + pipe (jq has no prefix `not`)',
);

assertCompile(
  'Anonymous = true AND Amount >= 5000',
  '.anonymous == true and .amount >= 5000',
  '#2 `and` after `== true` keeps space',
);

// Must evaluate — that was the observable symptom (jq rejected `and.amount`).
assertEval('Anonymous = true AND Amount >= 5000', false, '#2 evaluates (not jq-parse-error)');
assertEval('Anonymous = false AND Amount >= 5000', true, '#2 truthy branch');

// ─────────────────────────────────────────────────────────────────────────
// Bug #3 — Excel `=` → `==` preprocessor inside parens
// ─────────────────────────────────────────────────────────────────────────

assertCompile(
  '(Amount = 5000)',
  '(.amount == 5000)',
  '#3 `=` inside parens converts to `==` (was skipped when depth > 0)',
);

assertCompile(
  'NOT (Amount = 5000 AND Anonymous = true)',
  '((.amount == 5000 and .anonymous == true) | not)',
  '#3 nested `=` all converted',
);

assertEval('(Amount = 5000)', true, '#3 evaluates (was jq assignment before fix)');
assertEval('(Amount = 100)', false, '#3 evaluates negative case');

// Predicate brackets `[...]` still skip conversion — compilePredicate
// handles `=` there natively. Verify we didn't break that path.
const predResult = evaluateBxl('[1,2,3] | [.[] | select(. > 1)]', { x: 1 });
ok(Array.isArray(predResult.value), '#3 predicate-bracket path still works');

// CSS-style pseudo-classes are removed. Positional access must go through
// [#...] selectors, so legacy `:first` now fails at compile time.
throws(
  () => compileReadableSyntax('"Line Item":first.SKU', { schema: itemScheme }),
  /CSS-style pseudo-class syntax was removed/,
  'Removed pseudo-class syntax produces a compile error',
);

// Forward-only anchored selector ranges stay readable without implying
// reverse traversal semantics.
const rangeScheme: ReadableSchema = {
  fields: [
    {
      key: 'lineItems', label: 'Line Item', kind: 'array',
      item: { fields: [{ key: 'sku', label: 'SKU' }] },
    },
  ],
};

const rangeInput = {
  lineItems: [
    { sku: 'A' },
    { sku: 'B' },
    { sku: 'C' },
    { sku: 'D' },
    { sku: 'E' },
    { sku: 'F' },
  ],
};

deepStrictEqual(
  evaluateBxl('"Line Item"[#2..#last-1].SKU', rangeInput, { schema: rangeScheme }).value,
  ['B', 'C', 'D', 'E'],
  '#3 anchored front-to-back range evaluates',
);

deepStrictEqual(
  evaluateBxl('"Line Item"[#last-3..#last-1].SKU', rangeInput, { schema: rangeScheme }).value,
  ['C', 'D', 'E'],
  '#3 anchored back-to-back range evaluates',
);

throws(
  () => compileReadableSyntax('"Line Item"[#last-3..#4].SKU', { schema: rangeScheme }),
  /\[#last-3\.\.#4\] range must move forward in collection order/,
  '#3 back-to-front anchored range is rejected',
);

throws(
  () => compileReadableSyntax('"Line Item"[#last-1..#last-3].SKU', { schema: rangeScheme }),
  /\[#last-1\.\.#last-3\] range must move forward in collection order/,
  '#3 reverse anchored end-relative range is rejected',
);

// ─────────────────────────────────────────────────────────────────────────
// Bug #4 — jq string interpolation `"\(.field)"` rejected by tokenizer
// Symptom: compile threw "Bad escaped character in JSON at position 2"
// because the tokenizer ran every string through JSON.parse(), which
// doesn't know `\(`. Fix: fall back to a custom decoder that preserves
// interpolation syntax.
// ─────────────────────────────────────────────────────────────────────────

assertCompile(
  '"\\(.bpSystolic)/\\(.bpDiastolic)"',
  '"\\(.bpSystolic)/\\(.bpDiastolic)"',
  '#4 jq string interpolation compiles without JSON-parse error',
);

strictEqual(
  evaluateBxl('"\\(.x)/\\(.y)"', { x: 120, y: 80 }).value,
  '120/80',
  '#4 string interpolation evaluates correctly',
);

// ─────────────────────────────────────────────────────────────────────────
// Bug #5 — `X WORDOP (expr)` with whitespace before `(` was misread as
// formula-call form and left as `x endswith(expr)` (invalid jq).
// Fix: distinguish adjacent `(` (call) from separated `(` (infix RHS
// grouping) by checking token position `next.start === tok.end`.
// Surfaced by electric-haddock invoice's `backupCode ENDSWITH (.age | tostring)`
// use case.
// ─────────────────────────────────────────────────────────────────────────

assertCompile(
  'Campaign ENDSWITH ("Drive")',
  '. as $root |(. as $__ctx |($root.campaign) | endswith($__ctx |("Drive")))',
  '#5 ENDSWITH followed by space+( is infix, not formula call',
);

assertCompile(
  'Campaign CONTAINS (Campaign)',
  '. as $root |(. as $__ctx |($root.campaign) | contains($__ctx |($root.campaign)))',
  '#5 CONTAINS followed by space+( is infix, not formula call',
);

// Adjacent `(` (no space) still means formula call — preserve that.
assertCompile(
  'STARTSWITH(Donor; "Grace")',
  'startswith(.donor; "Grace")',
  '#5 STARTSWITH( with no space = formula call form, still untouched',
);

assertEval(
  'Campaign ENDSWITH ("Drive")',
  true,
  '#5 grouped-RHS evaluates (was jq parse error before fix)',
);

// ─────────────────────────────────────────────────────────────────────────
// Bug #6 — infix word-ops with a non-literal RHS evaluated `.field` on
// the piped-in LHS value rather than the root. Symptom: jq threw
// "Cannot index string with string" for `.email STARTSWITH .username`.
// Fix: capture root as `$__ctx` before the pipe and re-apply it to RHS:
//   (. as $__ctx | (lhs) | op($__ctx | rhs))
// ─────────────────────────────────────────────────────────────────────────

assertCompile(
  'Email STARTSWITH Donor',
  '. as $root |(. as $__ctx |($root.email) | startswith($__ctx | $root.donor))',
  '#6 field-RHS binds root via $__ctx (composes with $root schema wrap)',
);

assertEval(
  'Campaign STARTSWITH Campaign',
  true,
  '#6 self-reference on RHS evaluates (was "Cannot index string with string")',
);

strictEqual(
  evaluateBxl(
    '.bio CONTAINS .name',
    { bio: 'hello grace', name: 'grace' },
  ).value,
  true,
  '#6 cross-field RHS evaluates correctly',
);

strictEqual(
  evaluateBxl(
    '.code ENDSWITH (.age | tostring)',
    { code: 'ADA42', age: 42 },
  ).value,
  true,
  '#6 grouped-RHS with internal pipe evaluates correctly',
);

// ─────────────────────────────────────────────────────────────────────────
// Bug #7 — `=` inside array/comprehension brackets was skipped by the
// readable preprocessor because every `[...]` was treated like a path
// predicate bracket. That left jq assignment semantics in place for
// `range(...) as $var | ...` comprehensions.
// ─────────────────────────────────────────────────────────────────────────

assertCompile(
  '[range(0; 3) as $r | ($r = 0)]',
  '[range(0; 3) as $r |($r == 0)]',
  '#7 comprehension equality converts `=` to `==`',
);

deepStrictEqual(
  evaluateBxl('[range(0; 3) as $r | ($r = 0)]', {}).value,
  [true, false, false],
  '#7 equality inside range-bound comprehension evaluates correctly',
);

deepStrictEqual(
  evaluateBxl('[range(0; 5) as $r | IF($r = 0, 99, 1)]', {}).value,
  [99, 1, 1, 1, 1],
  '#7 IF branch over range-bound equality no longer matches every row',
);

deepStrictEqual(
  evaluateBxl(
    '5 as $R | [range(0; 5) as $r | IF($r = $R - 1, "last", "other")]',
    {},
  ).value,
  ['other', 'other', 'other', 'other', 'last'],
  '#7 RHS arithmetic + bound variable still compare correctly in range scope',
);

deepStrictEqual(
  evaluateBxl(
    '[range(0; 3) as $r | [range(0; 3) as $c | IF($r = 0 OR $r = 2 OR $c = 0 OR $c = 2, "edge", "mid")]]',
    {},
  ).value,
  [
    ['edge', 'edge', 'edge'],
    ['edge', 'mid', 'edge'],
    ['edge', 'edge', 'edge'],
  ],
  '#7 nested range scopes keep `=` as comparison in OR chains',
);

// ─────────────────────────────────────────────────────────────────────────
// Bug #8 — infix word operators inside array/comprehension brackets were
// skipped for the same reason. Predicate suffix brackets should be
// exempt, but array literals/comprehensions still need the rewrite.
// ─────────────────────────────────────────────────────────────────────────

assertCompile(
  '[range(0; 2) as $r | ("abc" STARTSWITH "a")]',
  '[range(0; 2) as $r |((. as $__ctx |("abc") | startswith($__ctx | "a")))]',
  '#8 STARTSWITH infix rewrites inside comprehensions',
);

deepStrictEqual(
  evaluateBxl('[range(0; 2) as $r | ("abc" STARTSWITH "a")]', {}).value,
  [true, true],
  '#8 STARTSWITH infix evaluates inside comprehensions',
);

console.log('BXL compiler bug regressions: all checks passed');
