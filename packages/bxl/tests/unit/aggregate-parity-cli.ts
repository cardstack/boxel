import { deepStrictEqual } from 'node:assert';
import { evaluateBxl } from '../../src/index.ts';
import { prepareSpreadsheetFormula } from '../../src/sql.ts';

// An aggregate over a field reads the same numbers in BXL's runtime and in
// the spreadsheet interpreter (which agrees with the score profile's SQL;
// realm-server's formula-parity-test.ts runs all three): each number, nested
// lists flattened, and each text that is a number throughout. Booleans,
// nulls, other text and objects are skipped.

let checks = 0;

const RECORDS: Record<string, unknown>[] = [
  { v: ['12', 3] },
  { v: [' 1.5e1 ', '-2'] },
  { v: ['12abc', 3] },
  { v: ['', 'abc', 3] },
  { v: [true, false, null, 2] },
  { v: [[1, '2'], [[3, '4x']], '5'] },
  { v: ['12', '12abc', '', 'abc', true, [1, '2']] },
  { v: [{ amount: 5 }, 1] },
  { v: '7' },
  { v: '7x' },
  { v: 4 },
  { v: true },
  { v: [] },
  { v: ['abc'] },
  {},
];

// Each value, or null where the runtime raises an Excel error.
const FORMULAS: Record<string, (number | null)[]> = {
  'SUM(.v)': [15, 13, 3, 3, 2, 11, 15, 1, 7, 0, 4, 0, 0, 0, 0],
  'COUNT(.v)': [2, 2, 1, 1, 1, 4, 3, 1, 1, 0, 1, 0, 0, 0, 0],
  'MIN(.v)': [3, -2, 3, 3, 2, 1, 1, 1, 7, 0, 4, 0, 0, 0, 0],
  'MAX(.v)': [12, 15, 3, 3, 2, 5, 12, 1, 7, 0, 4, 0, 0, 0, 0],
  'AVERAGE(.v)': [
    7.5,
    6.5,
    3,
    3,
    2,
    11 / 4,
    5,
    1,
    7,
    null,
    4,
    null,
    null,
    null,
    null,
  ],
};

function native(formula: string, record: Record<string, unknown>) {
  try {
    let [value] = evaluateBxl(formula, record).outputs;
    return typeof value === 'number' ? value : null;
  } catch (e) {
    if (/^#/.test(String((e as Error).message))) return null;
    throw e;
  }
}

for (let [formula, expected] of Object.entries(FORMULAS)) {
  let interpreter = prepareSpreadsheetFormula(formula);
  deepStrictEqual(
    RECORDS.map((r) => native(formula, r)),
    expected,
    `${formula} in BXL's runtime`,
  );
  deepStrictEqual(
    RECORDS.map((r) => interpreter.evaluate(r)),
    expected,
    `${formula} in the spreadsheet interpreter`,
  );
  checks++;
}

console.log(`aggregate parity: ${checks} formulas agree`);
