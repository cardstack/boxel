import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import { evaluateBxl } from '@cardstack/bxl';
import { prepareSpreadsheetFormula } from '@cardstack/bxl/sql';
import { exprSortSql } from '@cardstack/runtime-common/query-v2/formula-sql';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
} from './helpers/index.ts';

// One formula, two places to run it: as SQL (a `formula` placed in the
// database) and in JavaScript (the same formula over the top window). Both
// follow Excel's rules for blanks and errors, so every formula in the score
// profile gives every record the same value, or no value, in both.

const RECORDS: Record<string, unknown>[] = [
  {},
  { rating: null, priceMin: null },
  {
    rating: 4,
    priceMin: 0,
    inStock: true,
    onSale: false,
    price: '12.5',
    title: 'Brass lamp',
    tags: [1, 2],
    publishedAt: '2026-01-01T00:00:00Z',
    lastSeenAt: '2026-03-15T12:00:00Z',
  },
  { rating: -2.5, priceMin: 3, inStock: false, onSale: true },
  { rating: 0, priceMin: -1, price: 'n/a' },
  { rating: 'n/a', priceMin: 7.25 },
  { rating: 1e200, priceMin: 1e200 },
];

const FORMULAS = [
  // blanks in arithmetic and comparisons
  'rating',
  'rating + 1',
  'rating * 2',
  '-rating',
  'rating - priceMin',
  'rating / priceMin',
  '2 / rating',
  'rating % 3',
  'rating % priceMin',
  '0.3 % 0.1',
  'priceMin % 0.7',
  '-7.5 % 2',
  'rating * priceMin',
  'rating = 0',
  'rating <> 0',
  'rating > priceMin',
  'price * 2',
  'price > 100',
  'title * 2',
  'tags + 1',
  // conditions
  'IF(rating, 1, 2)',
  'IF(rating = 0, 1, 2)',
  'IF(rating > 3, rating * 2)',
  'IF(rating > 3, 1, IF(priceMin < 0, 2, 3))',
  'IF(1/0 > 1, 1, 2)',
  'AND(rating, inStock)',
  'AND(missing, other)',
  'OR(rating > 3, onSale)',
  'rating > 3 and inStock',
  'rating > 3 or onSale',
  'NOT(rating)',
  'NOT(inStock)',
  'NOT(1/0)',
  // errors, caught and not
  'IFERROR(rating / priceMin, -1)',
  'IFERROR(rating, 5)',
  'IFERROR(title * 2, 9)',
  'IFERROR(price, 5)',
  'IFERROR(title, 5)',
  'IFERROR((1/0) * 0, 4)',
  'IFNA(rating / priceMin, 3)',
  'ISBLANK(rating)',
  'ISBLANK(rating / priceMin)',
  // aggregates skip blanks
  'MIN(rating, 3)',
  'MAX(rating, priceMin)',
  'MAX(price, 1)',
  'MIN(inStock, 5)',
  'AVERAGE(rating, priceMin)',
  'MIN(missing)',
  'AVERAGE(missing)',
  'MAX(rating / priceMin, 1)',
  'MIN(rating * 2, 10)',
  // rounding and maths
  'ROUND(rating * 1.005, 2)',
  'ROUND(2.675, 2)',
  'ROUND(-2.5)',
  // a value or a result whose decimal form has an exponent
  'ROUND(rating * 0.0000001, 2)',
  'ROUND(rating * 0.00000012345, 9)',
  'ROUND(rating * 1000000, 15)',
  'ROUND(rating / 3, 1)',
  'ROUNDUP(rating / 3, 1)',
  'ROUNDDOWN(-rating / 3, 1)',
  'ABS(rating)',
  'SIGN(priceMin)',
  'SQRT(rating)',
  'POWER(rating, 2)',
  'POWER(priceMin, 0.5)',
  'POWER(priceMin, -1)',
  'POWER(priceMin, 0)',
  'rating ^ 0.5',
  'EXP(rating)',
  'EXP(1000)',
  'LN(rating)',
  'LN(priceMin + 1)',
  'LOG(rating, 2)',
  'LOG(rating, 1)',
  'LOG10(priceMin)',
  'FLOOR(rating)',
  'CEILING(rating, 2)',
  'FLOOR(rating, 0)',
  'DAYS(lastSeenAt, publishedAt)',
  'DAYS(publishedAt, missing)',
  // the shapes rankings use
  'rating / LN(priceMin + 1)',
  'IF(onSale, rating * 1.2, rating)',
  'IFERROR(rating / priceMin, 0) + MAX(rating, 0)',
];

// An aggregate over a field: every number, nested lists flattened, and every
// text that is a number throughout, in SQL, in the spreadsheet interpreter
// and in BXL's runtime alike. Booleans, nulls, other text and objects are
// skipped.
const AGGREGATE_RECORDS: Record<string, unknown>[] = [
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

const AGGREGATES = [
  'SUM(.v)',
  'COUNT(.v)',
  'MIN(.v)',
  'MAX(.v)',
  'AVERAGE(.v)',
  'MEDIAN(.v)',
  'MAX(.v, 1)',
  'SUM(.v, 1)',
];

// BXL's runtime: a number, or null where it raises an Excel error.
function inRuntime(formula: string, record: Record<string, unknown>) {
  try {
    let [value] = evaluateBxl(formula, record).outputs;
    return typeof value === 'number' ? value : null;
  } catch (e) {
    if (/^#/.test(String((e as Error).message))) return null;
    throw e;
  }
}

const close = (a: number | null, b: number | null) =>
  a === null || b === null
    ? a === b
    : a === b ||
      Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
  });
  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  test('a formula gives every record the same value in SQL and in JavaScript', async function (assert) {
    let mismatches: string[] = [];
    for (let formula of FORMULAS) {
      let sql = exprSortSql(formula);
      let js = prepareSpreadsheetFormula(formula);
      for (let record of RECORDS) {
        let inJs = js.evaluate(record);
        let inSql: number | null;
        try {
          let [row] = await adapter.execute(
            `SELECT ${sql} AS v FROM (SELECT $1::jsonb AS search_doc) AS i`,
            { bind: [JSON.stringify(record)] },
          );
          inSql = row.v == null ? null : Number(row.v);
        } catch (e) {
          // a double out of range: the engine runs the formula in
          // JavaScript instead, where the value is #NUM!
          if (/out of range/.test(String((e as Error).message))) {
            if (inJs !== null) {
              mismatches.push(
                `${formula} on ${JSON.stringify(record)}: SQL overflows, JavaScript ${inJs}`,
              );
            }
            continue;
          }
          throw e;
        }
        if (!close(inSql, inJs)) {
          mismatches.push(
            `${formula} on ${JSON.stringify(record)}: SQL ${inSql}, JavaScript ${inJs}`,
          );
        }
      }
    }
    assert.deepEqual(mismatches, [], 'no formula differs');
  });

  test('an aggregate over a field reads the same numbers in SQL, the interpreter and BXL', async function (assert) {
    let mismatches: string[] = [];
    for (let formula of AGGREGATES) {
      let sql = exprSortSql(formula);
      // MEDIAN is computed by the caller of the interpreter, not by it
      let js = /^MEDIAN/.test(formula)
        ? undefined
        : prepareSpreadsheetFormula(formula);
      for (let record of AGGREGATE_RECORDS) {
        let [row] = await adapter.execute(
          `SELECT ${sql} AS v FROM (SELECT $1::jsonb AS search_doc) AS i`,
          { bind: [JSON.stringify(record)] },
        );
        let inSql = row.v == null ? null : Number(row.v);
        let native = inRuntime(formula, record);
        if (!close(inSql, native)) {
          mismatches.push(
            `${formula} on ${JSON.stringify(record)}: SQL ${inSql}, BXL ${native}`,
          );
        }
        if (js && !close(js.evaluate(record), native)) {
          mismatches.push(
            `${formula} on ${JSON.stringify(record)}: JavaScript ${js.evaluate(record)}, BXL ${native}`,
          );
        }
      }
    }
    assert.deepEqual(mismatches, [], 'no aggregate differs');
  });

  test("blanks and errors follow Excel's rules", function (assert) {
    let value = (formula: string, record: Record<string, unknown> = {}) =>
      prepareSpreadsheetFormula(formula).evaluate(record);
    assert.strictEqual(value('rating * 2'), 0, 'a blank is 0 in arithmetic');
    assert.strictEqual(value('IF(rating = 0, 1, 2)'), 1, 'and in a comparison');
    assert.strictEqual(value('IF(rating, 1, 2)'), 2, 'IF on a blank is false');
    assert.strictEqual(value('IFERROR(1/0, 7)'), 7, 'IFERROR catches #DIV/0!');
    assert.strictEqual(
      value('IFERROR(rating, 5)'),
      null,
      'IFERROR passes a blank through',
    );
    assert.strictEqual(value('IFNA(1/0, 3)'), null, 'IFNA catches #N/A only');
    assert.strictEqual(value('MIN(rating, 3)'), 3, 'MIN skips a blank');
    assert.strictEqual(
      value('IF(1/0 > 1, 1, 2)'),
      null,
      "an error in IF's condition is the result",
    );
    assert.strictEqual(value('NOT(rating)'), 1, 'NOT of a blank is true');
    assert.strictEqual(value('ROUND(2.675, 2)'), 2.68, 'ROUND is half away');
  });
});
