// Exercise the "paste an Excel formula into BXL and have it work" story.
//
// Part 1 — Excel-idiom absorption. Five surface differences BXL now closes:
//   1. Leading `=` (cell-formula prefix) is stripped
//   2. `<>` is canonicalized to `!=`
//   3. `^` is rewritten to `POWER(a, b)`
//   4. `&` is rewritten to `((a|tostring) + (b|tostring))`
//   5. Unknown characters are caught by the linter (not thrown)
//
// Part 2 — Formula coverage. A curated sample of the formulajs unit-test
// suite (/Users/chris/Projects/formulajs/test/*.js), picked for breadth
// across math/trig, text, logical, information, engineering, statistical,
// and date-time. Every case below passes in BXL today. See
// `knownCoverageGaps` at the bottom for Excel formulas that don't yet
// evaluate the same way in BXL.

import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  bxlToJqExpression,
  evaluateBxl,
  lintBxlExpression,
  solidifyBxlExpression,
} from '../../src/index.js';
import { bxlExampleInput, bxlExampleSchema } from '../../examples/bxl-150-examples.js';

type Expected = number | string | boolean | null | unknown[];
type TestCase = {
  name: string;
  expression: string;
  expected: Expected;
  tolerance?: number;
  expectedSolid?: string;
  expectedJq?: string;
  expectedRewrites?: string[];
};

// Part 1 — Excel idioms the preprocessor absorbs.
const idiomCases: TestCase[] = [
  // 1. Leading `=`
  {
    name: 'leading = cell prefix is stripped',
    expression: '=ROUND(Subtotal * 0.1, 2)',
    expected: 8,
    expectedSolid: 'ROUND(Subtotal*0.1, 2)',
    expectedRewrites: ['excel-cell-prefix-stripped'],
  },
  {
    name: 'leading = with whitespace',
    expression: '  = ROUND(Subtotal * 0.1, 2)',
    expected: 8,
    expectedRewrites: ['excel-cell-prefix-stripped'],
  },
  // 2. `<>` inequality
  {
    name: '<> inequality single compare',
    expression: 'Subtotal <> 100',
    expected: true,
    expectedSolid: 'Subtotal <> 100',
  },
  {
    name: '<> inside IF',
    expression: 'IF(Subtotal <> 0, "yes", "no")',
    expected: 'yes',
    expectedSolid: 'IF(Subtotal <> 0, "yes", "no")',
  },
  // 3. `^` power
  {
    name: '^ simple literal power',
    expression: '2^8',
    expected: 256,
    expectedJq: 'POWER(2; 8)',
    expectedRewrites: ['excel-operator-rewritten'],
  },
  {
    name: '^ paren-lhs',
    expression: '(1+2)^3',
    expected: 27,
  },
  {
    name: '^ ident-lhs',
    expression: 'Subtotal ^ 2',
    expected: 6400,
    expectedJq: 'POWER(.subtotal; 2)',
  },
  // 4. `&` string concat
  {
    name: '& simple string concat',
    expression: '"Hello " & Customer.Name',
    expected: 'Hello Acme Legal',
  },
  {
    name: '& coerces numbers to strings (Excel semantics)',
    expression: 'Customer.Name & " #" & 42',
    expected: 'Acme Legal #42',
  },
  {
    name: '& inside IF branch',
    expression: 'IF(Subtotal > 0, "Invoice: " & "Invoice Number", "n/a")',
    expected: 'Invoice: INV-1001',
  },
  // Combined
  {
    name: 'combined: = prefix + <> + ^ + &',
    expression: '=IF(Subtotal <> 0, "x" & Status, 2^3)',
    expected: 'xopen',
  },
  // `&` / `^` absorb positional selector suffixes on their operands — regression
  // for the earlier "wrap each side in parens" workaround.
  {
    name: '& across [#first] and [#last]',
    expression: '"Line Item"[#first].SKU & " through " & "Line Item"[#last].SKU',
    expected: 'PAPER-01 through HARD-02',
  },
  {
    name: '^ across [#last]',
    expression: '"Line Item"[#last].Quantity ^ 2',
    expected: 4,
  },
  {
    name: '& chains past [#N] selectors',
    expression: '"Line Item"[#first].SKU & " then " & "Line Item"[#2].SKU',
    expected: 'PAPER-01 then BRAND-RED',
  },
  // Non-idioms: make sure regular expressions still work unchanged
  {
    name: 'regular expression unaffected',
    expression: 'ROUND(Subtotal * 0.1, 2)',
    expected: 8,
    expectedSolid: 'ROUND(Subtotal*0.1, 2)',
  },
  {
    name: '== NOT stripped (comparison expression)',
    expression: 'Subtotal == 80',
    expected: true,
  },
];

// Part 2 — Formulajs-derived coverage. Each case is an Excel formula that
// would work verbatim in a spreadsheet and now works verbatim in BXL.
const coverageCases: TestCase[] = [
  // --- Math & Trig ---
  { name: 'math: ABS(-1)', expression: 'ABS(-1)', expected: 1 },
  { name: 'math: ABS(-3.14)', expression: 'ABS(-3.14)', expected: 3.14 },
  { name: 'math: POWER(2, 8)', expression: 'POWER(2, 8)', expected: 256 },
  { name: 'math: POWER(2, 10)', expression: 'POWER(2, 10)', expected: 1024 },
  { name: 'math: SQRT(16)', expression: 'SQRT(16)', expected: 4 },
  { name: 'math: SQRT(2)', expression: 'SQRT(2)', expected: 1.4142135623730951, tolerance: 1e-9 },
  { name: 'math: ROUND(3.14159, 2)', expression: 'ROUND(3.14159, 2)', expected: 3.14 },
  { name: 'math: ROUND(123.456, 1)', expression: 'ROUND(123.456, 1)', expected: 123.5 },
  { name: 'math: ROUNDUP(3.141, 2)', expression: 'ROUNDUP(3.141, 2)', expected: 3.15 },
  { name: 'math: ROUNDDOWN(3.149, 2)', expression: 'ROUNDDOWN(3.149, 2)', expected: 3.14 },
  { name: 'math: CEILING(12.1, 1)', expression: 'CEILING(12.1, 1)', expected: 13 },
  { name: 'math: FLOOR(12.9, 1)', expression: 'FLOOR(12.9, 1)', expected: 12 },
  { name: 'math: MOD(22, 5)', expression: 'MOD(22, 5)', expected: 2 },
  { name: 'math: MOD(17, 6)', expression: 'MOD(17, 6)', expected: 5 },
  { name: 'math: TRUNC(3.14159, 2)', expression: 'TRUNC(3.14159, 2)', expected: 3.14 },
  { name: 'math: INT(3.9)', expression: 'INT(3.9)', expected: 3 },
  { name: 'math: PI()', expression: 'PI()', expected: 3.141592653589793, tolerance: 1e-9 },
  { name: 'math: EXP(1)', expression: 'EXP(1)', expected: 2.718281828459045, tolerance: 1e-9 },
  { name: 'math: LN(EXP(1))', expression: 'LN(EXP(1))', expected: 1, tolerance: 1e-9 },
  { name: 'math: LOG10(100)', expression: 'LOG10(100)', expected: 2 },
  { name: 'math: LOG(8, 2)', expression: 'LOG(8, 2)', expected: 3 },
  { name: 'math: SIGN(-5)', expression: 'SIGN(-5)', expected: -1 },
  { name: 'math: SIGN(0)', expression: 'SIGN(0)', expected: 0 },
  { name: 'math: SIGN(10)', expression: 'SIGN(10)', expected: 1 },
  { name: 'math: FACT(5)', expression: 'FACT(5)', expected: 120 },
  { name: 'math: COMBIN(5, 2)', expression: 'COMBIN(5, 2)', expected: 10 },
  { name: 'math: PERMUT(5, 2)', expression: 'PERMUT(5, 2)', expected: 20 },
  { name: 'math: QUOTIENT(10, 3)', expression: 'QUOTIENT(10, 3)', expected: 3 },
  { name: 'math: ROMAN(4)', expression: 'ROMAN(4)', expected: 'IV' },
  { name: 'math: ARABIC("IV")', expression: 'ARABIC("IV")', expected: 4 },

  // --- Text ---
  { name: 'text: UPPER("hello")', expression: 'UPPER("hello")', expected: 'HELLO' },
  { name: 'text: LOWER("HELLO")', expression: 'LOWER("HELLO")', expected: 'hello' },
  { name: 'text: PROPER("hello world")', expression: 'PROPER("hello world")', expected: 'Hello World' },
  { name: 'text: LEN("hello")', expression: 'LEN("hello")', expected: 5 },
  { name: 'text: LEFT("Sale Price", 4)', expression: 'LEFT("Sale Price", 4)', expected: 'Sale' },
  { name: 'text: RIGHT("Sale Price", 5)', expression: 'RIGHT("Sale Price", 5)', expected: 'Price' },
  { name: 'text: MID("Fluid Flow", 1, 5)', expression: 'MID("Fluid Flow", 1, 5)', expected: 'Fluid' },
  { name: 'text: TRIM("  hello  ")', expression: 'TRIM("  hello  ")', expected: 'hello' },
  { name: 'text: REPT("ab", 3)', expression: 'REPT("ab", 3)', expected: 'ababab' },
  { name: 'text: REPLACE("Hello World", 7, 5, "BXL")', expression: 'REPLACE("Hello World", 7, 5, "BXL")', expected: 'Hello BXL' },
  { name: 'text: SUBSTITUTE("Copy Toner", "Toner", "Ink")', expression: 'SUBSTITUTE("Copy Toner", "Toner", "Ink")', expected: 'Copy Ink' },
  { name: 'text: FIND("b", "abc")', expression: 'FIND("b", "abc")', expected: 2 },
  { name: 'text: SEARCH("B", "abc")', expression: 'SEARCH("B", "abc")', expected: 2 },
  { name: 'text: EXACT("a", "a")', expression: 'EXACT("a", "a")', expected: true },
  { name: 'text: EXACT("a", "b")', expression: 'EXACT("a", "b")', expected: false },
  { name: 'text: T("text")', expression: 'T("text")', expected: 'text' },
  { name: 'text: CHAR(65)', expression: 'CHAR(65)', expected: 'A' },
  { name: 'text: CODE("A")', expression: 'CODE("A")', expected: 65 },
  { name: 'text: VALUE("42.5")', expression: 'VALUE("42.5")', expected: 42.5 },
  {
    name: 'text: CONCAT("A", "B", 3)',
    expression: 'CONCAT("A", "B", 3)',
    expected: 'AB3',
    expectedJq: 'CONCAT(["A", "B", 3])',
  },
  {
    name: 'text: TEXTJOIN(" — ", true, "Ada", "", "Lovelace")',
    expression: 'TEXTJOIN(" — ", true, "Ada", "", "Lovelace")',
    expected: 'Ada — Lovelace',
    expectedJq: 'TEXTJOIN(" — "; true; ["Ada", "", "Lovelace"])',
  },

  // --- Logical ---
  { name: 'logic: NOT(true)', expression: 'NOT(true)', expected: false },
  { name: 'logic: NOT(false)', expression: 'NOT(false)', expected: true },
  { name: 'logic: IF(true, "y", "n")', expression: 'IF(true, "yes", "no")', expected: 'yes' },
  { name: 'logic: IF(5 > 3, 1, 0)', expression: 'IF(5 > 3, 1, 0)', expected: 1 },
  { name: 'logic: IFS(...)', expression: 'IFS(1 > 2, "a", 3 > 2, "b")', expected: 'b' },
  { name: 'logic: AND(true, true)', expression: 'AND(true, true)', expected: true, expectedJq: 'AND ([true, true])' },
  { name: 'logic: AND([true, true])', expression: 'AND([true, true])', expected: true },
  { name: 'logic: AND([true, false])', expression: 'AND([true, false])', expected: false },
  { name: 'logic: OR([true, false])', expression: 'OR([true, false])', expected: true },
  { name: 'logic: OR([false, false])', expression: 'OR([false, false])', expected: false },
  { name: 'logic: XOR([true, false])', expression: 'XOR([true, false])', expected: true },
  {
    name: 'logic: SWITCH(2, 1, "one", 2, "two", "other")',
    expression: 'SWITCH(2, 1, "one", 2, "two", "other")',
    expected: 'two',
    expectedJq: 'SWITCH([2, 1, "one", 2, "two", "other"])',
  },
  {
    name: 'logic: CHOOSE(2, "bronze", "silver", "gold")',
    expression: 'CHOOSE(2, "bronze", "silver", "gold")',
    expected: 'silver',
    expectedJq: 'CHOOSE(2; ["bronze", "silver", "gold"])',
  },

  // --- Lookup ---
  { name: 'lookup: XLOOKUP exact', expression: 'XLOOKUP("B", ["A", "B"], [10, 20])', expected: 20 },
  { name: 'lookup: XLOOKUP fallback', expression: 'XLOOKUP("C", ["A", "B"], [10, 20], "missing")', expected: 'missing' },

  // --- Statistical ---
  { name: 'stat: SUM([1, 2, 3, 4, 5])', expression: 'SUM([1, 2, 3, 4, 5])', expected: 15 },
  { name: 'stat: AVERAGE([1, 2, 3, 4, 5])', expression: 'AVERAGE([1, 2, 3, 4, 5])', expected: 3 },
  { name: 'stat: MAX(1, 2, 3)', expression: 'MAX(1, 2, 3)', expected: 3, expectedJq: 'MAX([1, 2, 3])' },
  { name: 'stat: MAX([1, 2, 3])', expression: 'MAX([1, 2, 3])', expected: 3 },
  { name: 'stat: MIN([1, 2, 3])', expression: 'MIN([1, 2, 3])', expected: 1 },
  { name: 'stat: COUNT([1, 2, 3, "a", null])', expression: 'COUNT([1, 2, 3, "a", null])', expected: 3 },
  { name: 'stat: COUNTA([1, 2, 3, "a", null])', expression: 'COUNTA([1, 2, 3, "a", null])', expected: 4 },
  { name: 'stat: MEDIAN([1, 2, 3, 4, 5])', expression: 'MEDIAN([1, 2, 3, 4, 5])', expected: 3 },
  { name: 'stat: STDEV(known sample)', expression: 'STDEV([2, 4, 4, 4, 5, 5, 7, 9])', expected: 2.138089935299395, tolerance: 1e-9 },

  // --- Engineering ---
  { name: 'eng: DEC2BIN(10)', expression: 'DEC2BIN(10)', expected: '1010' },
  { name: 'eng: DEC2OCT(8)', expression: 'DEC2OCT(8)', expected: '10' },
  { name: 'eng: BIN2DEC("1010")', expression: 'BIN2DEC("1010")', expected: 10 },
  { name: 'eng: HEX2DEC("FF")', expression: 'HEX2DEC("FF")', expected: 255 },
  { name: 'eng: BITAND(5, 3)', expression: 'BITAND(5, 3)', expected: 1 },
  { name: 'eng: BITOR(5, 3)', expression: 'BITOR(5, 3)', expected: 7 },
  { name: 'eng: BITXOR(5, 3)', expression: 'BITXOR(5, 3)', expected: 6 },
  { name: 'eng: BITLSHIFT(1, 3)', expression: 'BITLSHIFT(1, 3)', expected: 8 },
  { name: 'eng: BITRSHIFT(8, 1)', expression: 'BITRSHIFT(8, 1)', expected: 4 },

  // --- Information ---
  { name: 'info: ISBLANK(null)', expression: 'ISBLANK(null)', expected: true },
  { name: 'info: ISBLANK("")', expression: 'ISBLANK("")', expected: false },
  { name: 'info: ISNUMBER(42)', expression: 'ISNUMBER(42)', expected: true },
  { name: 'info: ISTEXT("hello")', expression: 'ISTEXT("hello")', expected: true },
  { name: 'info: ISLOGICAL(true)', expression: 'ISLOGICAL(true)', expected: true },

  // --- Date & Time ---
  { name: 'date: YEAR(DATE(2026, 4, 22))', expression: 'YEAR(DATE(2026, 4, 22))', expected: 2026 },
  { name: 'date: MONTH(DATE(2026, 4, 22))', expression: 'MONTH(DATE(2026, 4, 22))', expected: 4 },
  { name: 'date: DAY(DATE(2026, 4, 22))', expression: 'DAY(DATE(2026, 4, 22))', expected: 22 },
  { name: 'date: DAYS(end, start)', expression: 'DAYS(DATE(2026, 4, 30), DATE(2026, 4, 22))', expected: 8 },
];

// Known gaps that formulajs covers but BXL doesn't match today. Kept for
// visibility; not asserted. Future work to close:
//   - GCD, LCM not implemented
//   - MODE not implemented
//   - DEC2HEX returns lowercase; Excel returns uppercase

function valuesMatch(actual: unknown, expected: Expected, tolerance?: number): boolean {
  if (
    typeof tolerance === 'number' &&
    typeof actual === 'number' &&
    typeof expected === 'number'
  ) {
    return Math.abs(actual - expected) <= tolerance;
  }
  try {
    deepStrictEqual(actual, expected);
    return true;
  } catch {
    return false;
  }
}

function runCase(c: TestCase): string | undefined {
  try {
    const value = evaluateBxl(c.expression, bxlExampleInput, {
      schema: bxlExampleSchema,
    }).value;
    if (!valuesMatch(value, c.expected, c.tolerance)) {
      return `value mismatch: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(value)}`;
    }
    if (c.expectedSolid !== undefined) {
      const solid = solidifyBxlExpression(c.expression, { schema: bxlExampleSchema });
      if (solid.source !== c.expectedSolid) {
        return `solid mismatch: expected ${JSON.stringify(c.expectedSolid)}, got ${JSON.stringify(solid.source)}`;
      }
    }
    if (c.expectedJq !== undefined) {
      const jq = bxlToJqExpression(c.expression, { schema: bxlExampleSchema });
      if (jq.source !== c.expectedJq) {
        return `jq mismatch: expected ${JSON.stringify(c.expectedJq)}, got ${JSON.stringify(jq.source)}`;
      }
    }
    if (c.expectedRewrites !== undefined) {
      const solid = solidifyBxlExpression(c.expression, { schema: bxlExampleSchema });
      const codes = solid.rewrites.map((r) => r.code);
      for (const expected of c.expectedRewrites) {
        if (!codes.includes(expected)) {
          return `rewrite missing: expected ${expected}, got ${JSON.stringify(codes)}`;
        }
      }
    }
    return undefined;
  } catch (error) {
    return `threw: ${(error as Error).message.slice(0, 140)}`;
  }
}

let failing = 0;

for (const test of [...idiomCases, ...coverageCases]) {
  const failure = runCase(test);
  if (failure) {
    failing++;
    console.error(`  ✗ ${test.name}`);
    console.error(`    expr: ${test.expression}`);
    console.error(`    ${failure}`);
  }
}

// Graceful unknown-character handling — no crashes allowed.
const hostileInputs = [
  'foo£bar',
  'A ~ B',
  '\u203c!',
];
for (const source of hostileInputs) {
  try {
    const solid = solidifyBxlExpression(source, { schema: bxlExampleSchema });
    strictEqual(typeof solid.source, 'string');
    const lint = lintBxlExpression(source, { schema: bxlExampleSchema });
    strictEqual(lint.ok, false, `hostile input should lint as error: ${source}`);
    const codes = lint.issues.map((issue) => issue.code);
    if (!codes.includes('untokenizable-character') && !codes.includes('tokenize-error')) {
      throw new Error(
        `hostile input ${JSON.stringify(source)} should surface 'untokenizable-character' lint, got ${JSON.stringify(codes)}`,
      );
    }
  } catch (error) {
    failing++;
    console.error(`  ✗ hostile input crashed: ${JSON.stringify(source)}`);
    console.error(`    ${(error as Error).message}`);
  }
}

if (failing > 0) {
  throw new Error(
    `Excel paste suite: ${failing} of ${idiomCases.length + coverageCases.length + hostileInputs.length} cases failed`,
  );
}

console.log(
  `BXL Excel paste: ${idiomCases.length} idiom + ${coverageCases.length} formulajs-derived + ${hostileInputs.length} hostile = ${idiomCases.length + coverageCases.length + hostileInputs.length} cases passed`,
);
