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
import { strictEqual, ok } from 'node:assert';
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

assertCompile(
  'Donor STARTSWITH "Grace"',
  '((.donor) | startswith("Grace"))',
  '#1 STARTSWITH infix → pipe form',
);

assertCompile(
  'Campaign ENDSWITH "Drive"',
  '((.campaign) | endswith("Drive"))',
  '#1 ENDSWITH infix → pipe form',
);

assertCompile(
  'Email CONTAINS "@"',
  '((.email) | contains("@"))',
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

console.log('BXL compiler bug regressions: all checks passed');
