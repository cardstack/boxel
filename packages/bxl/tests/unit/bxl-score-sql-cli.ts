import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';
import {
  BXL_SCORE_FUNCTIONS,
  BxlScoreSqlError,
  compileBxlScoreToSql,
  type BxlScoreSqlUsage,
} from '../../src/index.ts';

// The score profile: a spreadsheet formula over a record's fields, lowered
// to a SQL number a database can rank every row by.

const fieldToSql = (parts: string[], usage: BxlScoreSqlUsage) =>
  `${usage}:${parts.join('.')}`;
const sql = (source: string) =>
  compileBxlScoreToSql(source, { fieldToSql }).sql;
let checks = 0;
const check = (fn: () => void) => {
  fn();
  checks++;
};

check(() => {
  let r = compileBxlScoreToSql('rating / LN(priceMin + 1)', { fieldToSql });
  deepStrictEqual(r.fields, ['rating', 'priceMin']);
  ok(r.sql.includes('number:rating'), 'bare names are fields');
  ok(r.sql.includes('NULLIF('), 'a division by zero is NULL, not an error');
  ok(
    r.sql.includes('> 0 THEN ln('),
    'the log of a non-positive number is NULL',
  );
});

check(() => {
  strictEqual(
    sql('.rating * 2'),
    '(number:rating * (2::double precision))',
    'jq paths are fields too',
  );
  ok(sql('brand.name').includes('number:brand.name'), 'dotted fields');
  ok(sql('rating^2').includes('power('), '^ is POWER');
});

check(() => {
  let s = sql('IF(discountPercent >= 20, rating * 1.2, rating)');
  ok(s.startsWith('(CASE WHEN (number:discountPercent >= '));
  ok(
    sql('IFERROR(reviewCount / views30d, 0)').startsWith('COALESCE('),
    'IFERROR catches the NULL an error became',
  );
  ok(
    sql('IF(AND(inStock, onSale), 2, 1)').includes(
      '(COALESCE(number:inStock, 0) <> 0) AND',
    ),
    'a number is true when non-zero',
  );
  ok(sql('MAX(rating, 3)').startsWith('GREATEST('), 'MAX skips blanks');
  ok(sql('ROUND(rating, 1)').includes('round(CAST('), 'ROUND keeps its digits');
});

check(() => {
  let s = sql('unitsSold30d / MAX(DAYS(NOW(), publishedAt), 7)');
  ok(s.includes('timestamp:publishedAt'), 'a field inside DAYS is a date');
  ok(s.includes('EXTRACT(EPOCH FROM (now() - '), 'DAYS counts days');
});

check(() => {
  let refused = (source: string, pattern: RegExp, why: string) =>
    throws(
      () => compileBxlScoreToSql(source, { fieldToSql }),
      (e: unknown) => e instanceof BxlScoreSqlError && pattern.test(e.message),
      why,
    );
  refused(
    'LEN(title)',
    /LEN is not part of the score profile/,
    'text functions',
  );
  refused('"x" + 1', /text values are not part/, 'strings');
  refused('NOW()', /use it inside DAYS/, 'a bare date');
  refused('.items[0]', /list positions/, 'list positions');
  refused('rating | . + 1', /not part of the score profile/, 'pipes');
  refused('ROUND(rating, x)', /digits are a whole number/, 'computed digits');
  refused('', /cannot be empty/, 'nothing');
  refused('IF(rating)', /IF takes 2 to 3 arguments/, 'arity');
});

check(() => {
  ok(BXL_SCORE_FUNCTIONS.includes('LN'));
  ok(!(BXL_SCORE_FUNCTIONS as readonly string[]).includes('XIRR'));
});

console.log(`BXL score profile SQL compiler: ${checks} checks passed`);
