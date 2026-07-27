// Regression tests for three compiler bugs fixed after guide work surfaced
// them:
//
//   1. Removed readable string word operators reject clearly; lowercase jq
//      pipe forms remain valid.
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
// Bug #1 — removed string word operators reject clearly
// ─────────────────────────────────────────────────────────────────────────

for (const expr of [
  'Donor STARTSWITH "Grace"',
  'Campaign ENDSWITH "Drive"',
  'Email CONTAINS "@"',
  'STARTSWITH(Donor; "Grace")',
]) {
  throws(
    () => compileReadableSyntax(expr, { schema }),
    /Readable string operator/,
    `#1 removed string operator rejects: ${expr}`,
  );
}

assertEval('Donor | startswith("Grace")', true, '#1 jq startswith pipe evaluates');
assertEval('Campaign | endswith("Drive")', true, '#1 jq endswith pipe evaluates');
assertEval('Email | contains("@")', true, '#1 jq contains pipe evaluates');
assertEval('Donor | startswith("Mr.")', false, '#1 jq startswith negative case');

// Inside predicate brackets, removed word-ops reject and jq pipe form works.
const itemScheme: ReadableSchema = {
  fields: [
    {
      key: 'lineItems', label: 'Line Item', kind: 'array',
      item: { fields: [{ key: 'sku', label: 'SKU' }] },
    },
  ],
};
throws(
  () => compileReadableSyntax('"Line Item"[SKU STARTSWITH "A"].SKU', { schema: itemScheme }),
  /Readable string operator/,
  '#1 predicate STARTSWITH rejects',
);
for (const expr of [
  '"Line Item"[SKU ^= "A"].SKU',
  '"Line Item"[SKU $= "A"].SKU',
  '"Line Item"[SKU *= "A"].SKU',
]) {
  throws(
    () => compileReadableSyntax(expr, { schema: itemScheme }),
    /Readable string operator/,
    `#1 predicate string alias rejects: ${expr}`,
  );
}
const predicateCompile = compileReadableSyntax(
  '"Line Item"[SKU | startswith("A")].SKU',
  { schema: itemScheme },
);
ok(predicateCompile.source.includes('startswith'), `#1 predicate jq pipe compiles: ${predicateCompile.source}`);

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
// Bug #5 — removed string operators reject whether they are followed by
// grouped RHS syntax or adjacent function-call syntax.
// ─────────────────────────────────────────────────────────────────────────

for (const expr of [
  'Campaign ENDSWITH ("Drive")',
  'Campaign CONTAINS (Campaign)',
  'STARTSWITH(Donor; "Grace")',
]) {
  throws(
    () => compileReadableSyntax(expr, { schema }),
    /Readable string operator/,
    `#5 removed grouped/call string operator rejects: ${expr}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Bug #6 — jq pipe string helpers with non-literal RHS evaluate against root.
// ─────────────────────────────────────────────────────────────────────────

assertCompile(
  'Email | startswith(Donor)',
  '. as $root | .email | startswith($root.donor)',
  '#6 field-RHS jq pipe compiles',
);

assertEval(
  'Campaign | startswith(Campaign)',
  true,
  '#6 self-reference on RHS evaluates',
);

strictEqual(
  evaluateBxl(
    '. as $root | .bio | contains($root.name)',
    { bio: 'hello grace', name: 'grace' },
  ).value,
  true,
  '#6 cross-field RHS evaluates correctly',
);

strictEqual(
  evaluateBxl(
    '. as $root | .code | endswith($root.age | tostring)',
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
// Bug #8 — removed string word operators inside array/comprehension brackets
// reject, while jq pipe string helpers still work.
// ─────────────────────────────────────────────────────────────────────────

throws(
  () => compileReadableSyntax('[range(0; 2) as $r | ("abc" STARTSWITH "a")]'),
  /Readable string operator/,
  '#8 removed STARTSWITH rejects inside comprehensions',
);

deepStrictEqual(
  evaluateBxl('[range(0; 2) as $r | ("abc" | startswith("a"))]', {}).value,
  [true, true],
  '#8 jq startswith pipe evaluates inside comprehensions',
);

// ─────────────────────────────────────────────────────────────────────────
// Bug #9 — nested readable scopes lost access to the root envelope.
// Item fields now resolve first, with unresolved readable labels falling
// back to a captured `$root`. Schema-known invalid members fail at compile
// time instead of quietly producing nulls.
// ─────────────────────────────────────────────────────────────────────────

const rootAwareSchema: ReadableSchema = {
  fields: [
    {
      key: 'books', label: 'Book', kind: 'array',
      item: { fields: [{ key: 'bidder', label: 'Bidder' }] },
    },
    {
      key: 'intent', label: 'Intent', kind: 'object',
      fields: [{ key: 'bidder', label: 'Bidder' }],
    },
  ],
};

const rootAwareInput = {
  books: [{ bidder: 'Ada' }, { bidder: 'Bob' }],
  intent: { bidder: 'Bob' },
};

strictEqual(
  compileReadableSyntax('Book[Bidder = Intent.Bidder]', {
    schema: rootAwareSchema,
  }).source,
  '. as $root | first(.books[] | select(.bidder == $root.intent.bidder))',
  '#9 predicate captures root while keeping item field local',
);

deepStrictEqual(
  evaluateBxl('Book[Bidder = Intent.Bidder]', rootAwareInput, {
    schema: rootAwareSchema,
  }).value,
  { bidder: 'Bob' },
  '#9 root-aware predicate evaluates',
);

deepStrictEqual(
  evaluateBxl(
    'Book[all] | map({ bidder: Bidder, requested: Intent.Bidder })',
    rootAwareInput,
    { schema: rootAwareSchema },
  ).value,
  [
    { bidder: 'Ada', requested: 'Bob' },
    { bidder: 'Bob', requested: 'Bob' },
  ],
  '#9 map/object scope resolves item first and root second',
);

throws(
  () => compileReadableSyntax('Book."Standing Count"', {
    schema: rootAwareSchema,
  }),
  /Unknown field 'Standing Count' in schema-aware path/,
  '#9 invalid array-item member is a compiler diagnostic',
);

strictEqual(
  evaluateBxl('present(Book[Bidder = "Nobody"])', rootAwareInput, {
    schema: rootAwareSchema,
  }).value,
  false,
  '#9 present(no-match) is Boolean false, not an empty-stream null',
);

const casingResult = evaluateBxl(
  'Book',
  { Books: rootAwareInput.books, intent: rootAwareInput.intent },
  { schema: rootAwareSchema },
);
ok(
  casingResult.warnings.some(
    (warning) => warning.code === 'input-key-casing-mismatch',
  ),
  '#9 casing mismatch produces a structured runtime warning',
);

console.log('BXL compiler bug regressions: all checks passed');
