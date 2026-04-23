// Regression tests for the Tier-1 helpers added under the UPPERCASE/lowercase
// naming convention (see docs/formulas.md):
//
//   UPPERCASE — real Excel functions:     ISBLANK
//   lowercase — BXL-native contributions:  present, when, implies, words, nonempty
//
// Every UPPERCASE name here must correspond to a real Microsoft Excel
// function. Every lowercase name is a BXL-specific helper. The test
// validates:
//   - correct evaluation semantics
//   - case-insensitive resolution (ISBLANK / isblank / IsBlank all work)
//   - compile output uses the canonical jq form
import { strictEqual, deepStrictEqual } from 'node:assert';
import { evaluateBxl, compileReadableSyntax, type ReadableSchema } from '../../src/index.js';

const schema: ReadableSchema = {
  fields: [
    { key: 'campaign', label: 'Campaign' },
    { key: 'payment', label: 'Payment' },
    { key: 'donor', label: 'Donor' },
    { key: 'amount', label: 'Amount' },
    {
      key: 'billing', label: 'Bill To', kind: 'object',
      fields: [{ key: 'zip', label: 'Zip' }, { key: 'street', label: 'Street' }],
    },
  ],
};

const good = {
  campaign: 'Spring Drive',
  payment: 'Credit card',
  donor: 'Grace Lin',
  amount: 5000,
  billing: { zip: '94609', street: '742 Evergreen Terrace' },
};

const missing = {
  campaign: '',
  payment: 'Credit card',
  donor: 'Madonna',
  amount: 260,
  billing: { zip: null, street: '' },
};

const none = {
  campaign: null,
  payment: null,
  donor: null,
  amount: null,
  billing: null,
};

function evalOn(expr: string, input: unknown) {
  return evaluateBxl(expr, input, { schema }).value;
}

// ─────────────────────────────────────────────────────────────────────────
// ISBLANK — UPPERCASE (real Excel function)
// ─────────────────────────────────────────────────────────────────────────

// Excel-strict semantics: only null/undefined is blank; empty string is NOT.
// (Matches Excel's ISBLANK behavior — an empty formula result "" is not blank.)
strictEqual(evalOn('ISBLANK(Campaign)', good),    false, 'ISBLANK false on populated');
strictEqual(evalOn('ISBLANK(Campaign)', missing), false, 'ISBLANK false on "" (Excel-strict)');
strictEqual(evalOn('ISBLANK(Campaign)', none),    true,  'ISBLANK true on null');
strictEqual(evalOn('NOT ISBLANK(Campaign)', good), true, 'NOT ISBLANK pattern works');

// Case-insensitive resolution
strictEqual(evalOn('isblank(Campaign)', none),    true, 'lowercase isblank resolves');
strictEqual(evalOn('IsBlank(Campaign)', none),    true, 'mixed-case IsBlank resolves');

// ─────────────────────────────────────────────────────────────────────────
// present — lowercase (BXL shortcut for "not ISBLANK")
// ─────────────────────────────────────────────────────────────────────────

strictEqual(evalOn('present(Campaign)', good),    true,  'present true on populated');
strictEqual(evalOn('present(Campaign)', missing), false, 'present false on empty string');
strictEqual(evalOn('present(Campaign)', none),    false, 'present false on null');

// Nested paths
strictEqual(evalOn('present("Bill To".Zip)', good),    true);
strictEqual(evalOn('present("Bill To".Zip)', missing), false);
strictEqual(evalOn('present("Bill To".Zip)', none),    false);

// Case-insensitive resolution
strictEqual(evalOn('PRESENT(Campaign)', good), true,
  'uppercase PRESENT resolves (case-insensitive)');

// ─────────────────────────────────────────────────────────────────────────
// when / implies — lowercase (BXL implication)
// ─────────────────────────────────────────────────────────────────────────

strictEqual(evalOn('when(Payment = "Credit card"; present("Bill To".Zip))', good),    true,
  'when: cc + zip set → pass');
strictEqual(evalOn('when(Payment = "Credit card"; present("Bill To".Zip))', missing), false,
  'when: cc + no zip → fail');
strictEqual(evalOn('when(Payment = "Credit card"; present("Bill To".Zip))', none),    true,
  'when: not cc → vacuously pass');
strictEqual(
  evalOn('when(Payment = "Credit card", present("Bill To".Zip))', good),
  true,
  'when also accepts readable comma separators',
);
strictEqual(
  evalOn('implies(Payment = "Credit card", present("Bill To".Zip))', missing),
  false,
  'implies also accepts readable comma separators',
);

// implies is an alias
strictEqual(evalOn('implies(Payment = "Credit card"; present("Bill To".Zip))', good), true,
  'implies alias of when');

// when falls back to true on false condition — verify explicitly
strictEqual(evalOn('when(false; false)', {}), true, 'when(false; false) vacuous → true');
strictEqual(evalOn('when(true; false)', {}),  false, 'when(true; false) failed requirement');
strictEqual(evalOn('when(true; true)', {}),   true,  'when(true; true) satisfied');

// ─────────────────────────────────────────────────────────────────────────
// words — lowercase (BXL word count; no Excel equivalent)
// ─────────────────────────────────────────────────────────────────────────

strictEqual(evalOn('words(Donor)', good),    2, 'words: "Grace Lin" → 2');
strictEqual(evalOn('words(Donor)', missing), 1, 'words: "Madonna" → 1');
strictEqual(evalOn('words(Donor)', none),    0, 'words: null → 0');
strictEqual(evalOn('words(Donor) >= 2', good),    true,  'words ≥ 2 passes');
strictEqual(evalOn('words(Donor) >= 2', missing), false, 'words ≥ 2 fails on single');

// Graceful double-space handling
strictEqual(evalOn('words(.x)', { x: 'one  two' }), 2, 'words: double-space tolerated');
strictEqual(evalOn('words(.x)', { x: '   ' }),      0, 'words: whitespace-only → 0');
strictEqual(evalOn('words(.x)', { x: '' }),         0, 'words: empty → 0');

// ─────────────────────────────────────────────────────────────────────────
// nonempty — lowercase (BXL array cleaner)
// ─────────────────────────────────────────────────────────────────────────

deepStrictEqual(
  evalOn('nonempty(.tags)', { tags: ['a', '', 'b', null, 'c'] }),
  ['a', 'b', 'c'],
  'nonempty strips null and empty string',
);

// ─────────────────────────────────────────────────────────────────────────
// Compile-output sanity (canonical jq shape)
// ─────────────────────────────────────────────────────────────────────────

const isblankCompile = compileReadableSyntax('ISBLANK(Campaign)', { schema });
strictEqual(
  isblankCompile.source,
  'ISBLANK(.campaign)',
  'ISBLANK compiles to UPPERCASE jq call',
);

const presentCompile = compileReadableSyntax('present(Campaign)', { schema });
strictEqual(
  presentCompile.source,
  'present(.campaign)',
  'present compiles to lowercase jq call',
);

const whenCompile = compileReadableSyntax(
  'when(Payment = "Credit card"; present("Bill To".Zip))',
  { schema },
);
strictEqual(
  whenCompile.source,
  'when(.payment == "Credit card"; present(.billing.zip))',
  'when compiles with nested schema resolution',
);

const whenCommaCompile = compileReadableSyntax(
  'when(Payment = "Credit card", present("Bill To".Zip))',
  { schema },
);
strictEqual(
  whenCommaCompile.source,
  'when(.payment == "Credit card"; present(.billing.zip))',
  'when rewrites readable comma separators to jq semicolons',
);

console.log('BXL helpers (ISBLANK, present, when, implies, words, nonempty): all checks passed');
