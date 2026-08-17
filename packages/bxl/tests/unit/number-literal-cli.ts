// Numeric literals, asserted through both syntaxes.
//
// Readable syntax and canonical jq tokenize numbers separately, so every form
// is checked twice: a literal accepted by one and not the other would break
// authored expressions only after compilation, where it is hardest to read.
// Scientific notation matters most — it is the only form whose tokenization
// can collide with an identifier, since `e` is a letter.
import { ok, strictEqual, throws } from 'node:assert';
import { evaluateBxl } from '../../src/index.ts';

interface LiteralCase {
  /** Program, written so that it means the same thing in both syntaxes. */
  source: string;
  expected: unknown;
}

const cases: LiteralCase[] = [
  { source: '1', expected: 1 },
  { source: '1.5', expected: 1.5 },
  { source: '1e3', expected: 1000 },
  { source: '1E3', expected: 1000 },
  { source: '1e-3', expected: 0.001 },
  { source: '2e+3', expected: 2000 },
  { source: '1.5e2', expected: 150 },
  { source: '1.5E-2', expected: 0.015 },
  // The smallest positive double is subnormal and has no decimal spelling
  // short enough to write, so an exponent is the only way to name it.
  { source: '5e-324', expected: 5e-324 },
  // An exponent binds tighter than any operator around it.
  { source: '1e3 + 1', expected: 1001 },
  { source: '2 * 1e2', expected: 200 },
];

let checks = 0;
for (const { source, expected } of cases) {
  for (const readableSyntax of [true, false]) {
    const { value } = evaluateBxl(source, null, { readableSyntax });
    strictEqual(
      value,
      expected,
      `${source} under ${readableSyntax ? 'readable' : 'jq'} syntax`,
    );
    checks++;
  }
}

// An `e` with no digits after it is not an exponent, so the tokenizer leaves
// it to be read as a name — which is what makes `1e` a failure rather than a
// literal that quietly evaluates to NaN.
for (const readableSyntax of [true, false]) {
  throws(
    () => evaluateBxl('1e', null, { readableSyntax }),
    /Cannot index number with string/,
    `1e is not a number under ${readableSyntax ? 'readable' : 'jq'} syntax`,
  );
  checks++;
}

// A name may open with the exponent letter without being read as one.
const named = evaluateBxl('.e5 + .e', { e5: 2, e: 3 }, {
  readableSyntax: false,
});
strictEqual(named.value, 5, 'a field name starting with e survives');
checks++;

ok(checks > 0);
console.log(`BXL number literals: ${checks} checks passed`);
